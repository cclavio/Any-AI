/**
 * BridgeManager — per-user bridge state for Claude Code ↔ Mentra glasses.
 *
 * Uses a park-and-wait model: when the user can't respond immediately,
 * the HTTP connection stays open while the glasses return to normal mode.
 * The user responds at their own pace — "I'm ready" triggers replay.
 * Only falls back to DB-based deferral when the full timeout expires.
 */

import type { User } from "../session/User";
import type { BridgeNotifyResponse, ParkedRequest } from "./types";
import { classifyBridgeDeferral, classifyBridgeAcceptance } from "./bridge-commands";
import { db } from "../db/client";
import { bridgeRequests } from "../db/schema";

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const WARNING_BEFORE_TIMEOUT_MS = 60_000; // warn 60s before timeout
const WARM_CONVERSATION_MS = 30_000; // skip announcement if last response was within 30s

export class BridgeManager {
  /** The currently parked request (in-memory only) */
  private parkedRequest: ParkedRequest | null = null;

  /** Active bridge conversation ID */
  private conversationId: string | null = null;

  /** Temporary timeout timer ref for the initial phase (before park) */
  private _pendingTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  /** Timestamp of the last successful user response — used to detect warm conversations */
  private lastResponseTime: number = 0;

  constructor(private user: User) {}

  /**
   * Handle a notify request from Claude Code.
   *
   * Two-stage flow:
   *   1. ANNOUNCE: "You have a message from Claude Code" → listen for accept/defer
   *   2. DELIVER:  Speak the full message → listen for the user's actual response
   *
   * Parks if the user defers or stays silent at either stage.
   * Returns a Promise that resolves when the user responds or timeout expires.
   */
  handleNotify(
    message: string,
    requestId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<BridgeNotifyResponse> {
    const session = this.user.appSession;
    if (!session) {
      return Promise.reject(new Error("Glasses offline"));
    }

    if (this.parkedRequest) {
      return Promise.reject(new Error("A request is already parked. Wait for it to resolve or timeout."));
    }

    // Generate or reuse conversation ID
    if (!this.conversationId) {
      this.conversationId = crypto.randomUUID();
    }
    const conversationId = this.conversationId;

    return new Promise<BridgeNotifyResponse>((resolve, reject) => {
      // Warm conversation: skip announcement if user responded recently
      const isWarmConversation =
        this.conversationId === conversationId &&
        this.lastResponseTime > 0 &&
        (Date.now() - this.lastResponseTime) < WARM_CONVERSATION_MS;

      // --- Stage 2: Deliver the full message and collect the response ---
      const deliverMessage = () => {
        console.log(`📬 [BRIDGE] Delivering message for ${this.user.userId}`);
        session.layouts.showTextWall(message, { durationMs: 10000 });

        const setupResponseListening = () => {
          this.user.transcription.bridgeResponseCallback = (transcript: string) => {
            const deferral = classifyBridgeDeferral(transcript);

            if (!transcript || deferral) {
              // User deferred after hearing the message — park
              this.parkRequest(requestId, message, conversationId, resolve, reject, timeoutMs);
              session.audio.speak("Ok, say 'I'm ready' when you want to respond.").catch(() => {});
            } else {
              // Got the actual response — resolve
              if (this._pendingTimeoutTimer) {
                clearTimeout(this._pendingTimeoutTimer);
                this._pendingTimeoutTimer = null;
              }
              this.lastResponseTime = Date.now();
              this.logRequest(requestId, message, transcript, conversationId, "responded");
              resolve({
                status: "responded",
                requestId,
                transcript,
                conversationId,
              });
            }
          };
          this.user.transcription.activateListening();
        };

        // Speak the full message, then listen for the response
        this.speakSafe(session, `Claude says: ${message}`, setupResponseListening);
      };

      // --- Stage 1: Announce that a message has arrived ---
      const setupAnnouncementListening = () => {
        this.user.transcription.bridgeResponseCallback = (transcript: string) => {
          const deferral = classifyBridgeDeferral(transcript);
          const acceptance = classifyBridgeAcceptance(transcript);

          if (!transcript || deferral) {
            // User is busy or silent — park without delivering the message
            this.parkRequest(requestId, message, conversationId, resolve, reject, timeoutMs);
            session.audio.speak("Ok, say 'I'm ready' when you want to hear it.").catch(() => {});
          } else if (acceptance) {
            // User wants to hear it — deliver the full message
            deliverMessage();
          } else {
            // Unrecognized response — treat as acceptance (benefit of the doubt)
            deliverMessage();
          }
        };
        this.user.transcription.activateListening();
      };

      if (isWarmConversation) {
        // Active back-and-forth — skip announcement, deliver directly
        console.log(`📬 [BRIDGE] Warm conversation (${Date.now() - this.lastResponseTime}ms since last response) — delivering directly`);
        deliverMessage();
      } else {
        // Cold start — announce first, then deliver on acceptance
        this.speakSafe(session, "You have a message from Claude Code.", setupAnnouncementListening);
      }

      // Full timeout timer (backstop — covers both stages)
      this._pendingTimeoutTimer = setTimeout(() => {
        this._pendingTimeoutTimer = null;
        this.handleFullTimeout(requestId, message, conversationId, resolve);
      }, timeoutMs);
    });
  }

  /**
   * Speak a message safely — handles void returns, rejections, and throws.
   * Calls `next` when speech completes (or fails).
   */
  private speakSafe(session: NonNullable<User["appSession"]>, text: string, next: () => void): void {
    try {
      const result = session.audio.speak(text);
      if (result && typeof result.then === "function") {
        result.then(() => next()).catch((err: unknown) => {
          console.warn(`📬 [BRIDGE] TTS failed (continuing):`, err);
          next();
        });
      } else {
        next();
      }
    } catch (err) {
      console.warn(`📬 [BRIDGE] TTS threw (continuing):`, err);
      next();
    }
  }

  /**
   * Park the request — user is busy, keep HTTP connection open.
   * Glasses return to normal mode; user can use AI assistant freely.
   */
  private parkRequest(
    requestId: string,
    message: string,
    conversationId: string,
    resolve: (response: BridgeNotifyResponse) => void,
    reject: (error: Error) => void,
    timeoutMs: number,
  ): void {
    // Clear the pending timeout and create a fresh one
    if (this._pendingTimeoutTimer) {
      clearTimeout(this._pendingTimeoutTimer);
      this._pendingTimeoutTimer = null;
    }

    const timeoutTimer = setTimeout(() => {
      this.handleFullTimeout(requestId, message, conversationId, resolve);
    }, timeoutMs);

    // Warning timer — fires 60s before timeout
    let warningTimer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs > WARNING_BEFORE_TIMEOUT_MS * 2) {
      warningTimer = setTimeout(() => {
        const session = this.user.appSession;
        if (session && this.parkedRequest) {
          session.audio.speak("Claude's message expires in one minute. Say 'I'm ready' to respond now.").catch(() => {});
          session.layouts.showTextWall("Claude's message expires soon", { durationMs: 5000 });
        }
      }, timeoutMs - WARNING_BEFORE_TIMEOUT_MS);
    }

    this.parkedRequest = {
      requestId,
      message,
      conversationId,
      resolve,
      reject,
      timeoutTimer,
      warningTimer,
    };

    console.log(`📬 [BRIDGE] Request ${requestId} parked for ${this.user.userId}`);
  }

  /** Check if there's a parked request (in-memory, fast) */
  hasParkedRequest(): boolean {
    return this.parkedRequest !== null;
  }

  /**
   * Replay the parked message — called when user says "I'm ready" / "check messages".
   * Delivers the full message directly (user already opted in by saying "I'm ready").
   */
  async replayParkedMessage(): Promise<void> {
    const parked = this.parkedRequest;
    if (!parked) return;

    const session = this.user.appSession;
    if (!session) return;

    console.log(`📬 [BRIDGE] Replaying parked message for ${this.user.userId}`);

    // Display and speak the original message
    session.layouts.showTextWall(parked.message, { durationMs: 10000 });

    this.speakSafe(session, `Claude says: ${parked.message}`, () => {
      // Set up replay callback
      this.user.transcription.bridgeResponseCallback = (transcript: string) => {
        const deferral = classifyBridgeDeferral(transcript);

        if (!transcript || deferral) {
          // Still not ready — re-park, keep waiting
          session.audio.speak("Ok, still waiting.").catch(() => {});
          // parkedRequest stays intact, timeout timer still running
        } else {
          // Got the response — resolve original Promise
          const p = this.parkedRequest!;
          this.parkedRequest = null;
          clearTimeout(p.timeoutTimer);
          if (p.warningTimer) clearTimeout(p.warningTimer);

          this.lastResponseTime = Date.now();
          this.logRequest(p.requestId, p.message, transcript, p.conversationId, "responded");
          p.resolve({
            status: "responded",
            requestId: p.requestId,
            transcript,
            conversationId: p.conversationId,
          });
        }
      };

      // Activate listening to collect the response
      this.user.transcription.activateListening();
    });
  }

  /**
   * Handle a speak request (fire-and-forget, no response collection).
   */
  async handleSpeak(message: string): Promise<void> {
    const session = this.user.appSession;
    if (!session) throw new Error("Glasses offline");

    session.layouts.showTextWall(message, { durationMs: 10000 });
    try {
      const speakResult = session.audio.speak(message);
      if (speakResult && typeof speakResult.then === "function") {
        await speakResult;
      }
    } catch (err) {
      console.warn(`📬 [BRIDGE] TTS failed in handleSpeak:`, err);
    }
  }

  /**
   * End the bridge conversation — optional farewell message.
   * Returns true if farewell was delivered, false if it failed.
   */
  async handleEnd(farewell?: string): Promise<boolean> {
    // Clear any active bridge listening state to avoid interference with farewell TTS
    this.user.transcription.bridgeResponseCallback = null;

    let delivered = false;
    if (farewell) {
      try {
        await this.handleSpeak(farewell);
        delivered = true;
      } catch (err) {
        console.warn(`📬 [BRIDGE] Farewell delivery failed:`, err);
      }
    }
    this.conversationId = null;
    this.lastResponseTime = 0;
    return delivered;
  }

  /**
   * Full timeout handler (last resort) — parked request timed out.
   */
  private handleFullTimeout(
    requestId: string,
    message: string,
    conversationId: string,
    resolve: (response: BridgeNotifyResponse) => void,
  ): void {
    const parked = this.parkedRequest;
    if (parked && parked.requestId === requestId) {
      if (parked.warningTimer) clearTimeout(parked.warningTimer);
      this.parkedRequest = null;
    }

    // Clear pending timer if still set
    if (this._pendingTimeoutTimer) {
      clearTimeout(this._pendingTimeoutTimer);
      this._pendingTimeoutTimer = null;
    }

    // Store to DB as timeout
    this.logRequest(requestId, message, undefined, conversationId, "timeout");

    // Notify user on glasses
    this.user.appSession?.audio.speak("Claude's request has timed out.").catch(() => {});

    resolve({
      status: "timeout",
      requestId,
      conversationId,
      message: "Response timeout — message saved. Use check_pending if you need the answer later.",
    });

    console.log(`📬 [BRIDGE] Request ${requestId} timed out for ${this.user.userId}`);
  }

  /**
   * Log a bridge request to the database (audit trail + deferred store).
   */
  private logRequest(
    requestId: string,
    message: string,
    response: string | undefined,
    conversationId: string,
    status: string,
  ): void {
    db.insert(bridgeRequests)
      .values({
        id: requestId,
        apiKeyHash: "", // enriched by route handler
        mentraUserId: this.user.userId,
        conversationId,
        message,
        response: response ?? null,
        status,
        respondedAt: response ? new Date() : null,
      })
      .catch((err) => {
        console.warn(`📬 [BRIDGE] Failed to log request ${requestId}:`, err);
      });
  }

  /**
   * Cleanup — called on user disconnect.
   */
  destroy(): void {
    if (this.parkedRequest) {
      const p = this.parkedRequest;
      clearTimeout(p.timeoutTimer);
      if (p.warningTimer) clearTimeout(p.warningTimer);

      this.logRequest(p.requestId, p.message, undefined, p.conversationId, "timeout");
      p.resolve({
        status: "timeout",
        requestId: p.requestId,
        conversationId: p.conversationId,
        message: "Session disconnected — message saved.",
      });

      this.parkedRequest = null;
    }

    if (this._pendingTimeoutTimer) {
      clearTimeout(this._pendingTimeoutTimer);
      this._pendingTimeoutTimer = null;
    }

    this.conversationId = null;
  }
}
