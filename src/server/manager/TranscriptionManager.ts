import type { AppSession, TranscriptionData } from "@mentra/sdk";
import type { User } from "../session/User";
import type { StoredPhoto } from "./PhotoManager";
import type { QueryResult } from "./QueryProcessor";
import { detectWakeWord, removeWakeWord } from "../utils/wake-word";
import { isVisualQuery } from "../agent/visual-classifier";
import { classifyDeviceCommand, type DeviceCommand } from "../agent/device-commands";
import { classifyCloser } from "../agent/conversational-closers";
import { classifyBridgeCommand } from "../bridge/bridge-commands";
import { isComprehensionFailure } from "../agent/comprehension-failure";
import { getDefaultSoundUrl, COMPREHENSION_SETTINGS } from "../constants/config";

interface SSEWriter {
  write: (data: string) => void;
  userId: string;
  close: () => void;
}

/**
 * Callback signature for when a query is ready to be processed.
 * Includes pre-captured photo (taken at wake word time) and visual classification.
 */
export type OnQueryReadyCallback = (query: string, speakerId?: string, prePhoto?: StoredPhoto | null, isVisual?: boolean) => Promise<QueryResult>;

/**
 * Callback for when a device command (e.g. "take a photo") is detected.
 * Called instead of onQueryReady — short-circuits the AI pipeline.
 */
export type OnDeviceCommandCallback = (command: DeviceCommand) => Promise<void>;

/**
 * TranscriptionManager — handles speech-to-text, wake word detection,
 * speaker locking, and SSE broadcasting for a single user.
 *
 * Simplified architecture:
 * - Auto follow-up after AI response (no wake word needed for follow-ups)
 * - No head position tracking
 * - No cancellation phrases
 * - State machine: IDLE -> LISTENING -> (callback) -> FOLLOW_UP -> IDLE
 *                                                   -> LISTENING (if speech detected in follow-up)
 */
export class TranscriptionManager {
  private sseClients: Set<SSEWriter> = new Set();
  private unsubscribe: (() => void) | null = null;

  // State
  private isListening: boolean = false;
  private isProcessing: boolean = false;
  private isSpeaking: boolean = false;
  private interruptedTTS: boolean = false;
  private failedComprehensionCount: number = 0;
  private activeSpeakerId: string | undefined = undefined;

  // Transcript accumulation
  private currentTranscript: string = '';
  private transcriptionStartTime: number = 0;

  // Pre-captured photo (taken at wake word time, before query is ready)
  private pendingPhoto: Promise<StoredPhoto | null> | null = null;

  // Duplicate detection: store first few words of last processed query
  private lastProcessedWords: string[] = [];
  private lastProcessedTime: number = 0;
  private readonly DUPLICATE_WINDOW_MS = 10000;  // 10s window to detect duplicates
  private readonly DUPLICATE_WORD_COUNT = 3;     // Compare first 3 words

  // Follow-up mode: auto-listen after AI response
  private isFollowUpMode = false;
  private followUpTimeout: NodeJS.Timeout | undefined;

  // Timers
  private silenceTimeout: NodeJS.Timeout | undefined;
  private maxListeningTimeout: NodeJS.Timeout | undefined;

  // Config
  private readonly SILENCE_TIMEOUT_MS = 3000;  // 3s silence = query complete
  private readonly MAX_LISTENING_MS = 15000;   // 15s max listening time
  private readonly FOLLOW_UP_WINDOW_MS = 10000; // 10s window for follow-up questions

  // Callback for when query is ready
  private onQueryReady: OnQueryReadyCallback | null = null;

  // Callback for device commands (short-circuits AI pipeline)
  private onDeviceCommand: OnDeviceCommandCallback | null = null;

  /** One-shot callback for bridge response collection. Set by BridgeManager, cleared after use. */
  bridgeResponseCallback: ((transcript: string) => void) | null = null;

  // Session disconnect safety — prevents zombie query processing
  private destroyed = false;

  // Diagnostic: track whether any STT events have arrived since setup
  private sttEventCount = 0;

  constructor(private user: User) {}

  /**
   * Set the callback to be invoked when a query is ready
   */
  setOnQueryReady(callback: OnQueryReadyCallback): void {
    this.onQueryReady = callback;
  }

  /**
   * Set the callback for device commands (e.g. "take a photo").
   * When a device command is detected, this fires instead of onQueryReady.
   */
  setOnDeviceCommand(callback: OnDeviceCommandCallback): void {
    this.onDeviceCommand = callback;
  }

  /**
   * Wire up the transcription listener on the glasses session
   */
  setup(session: AppSession): void {
    // Reset destroyed flag — critical for reconnect scenarios where
    // destroy() was called during clearAppSession() before re-setup
    this.destroyed = false;

    this.unsubscribe = session.events.onTranscription(
      (data: TranscriptionData) => {
        this.handleTranscription(data);
      },
    );

    this.sttEventCount = 0;

    const wakeWord = this.user.aiConfig?.wakeWord ?? 'Hey Jarvis';
    console.log(`🎤 TranscriptionManager ready for ${this.user.userId} (wake word: "${wakeWord}")`);
  }

  /**
   * Handle incoming transcription data
   */
  private async handleTranscription(data: TranscriptionData): Promise<void> {
    const { text, isFinal, speakerId } = data as TranscriptionData & { speakerId?: string };

    // Diagnostic: confirm STT stream is alive (log first event + every 100th)
    this.sttEventCount++;
    if (this.sttEventCount === 1 || this.sttEventCount % 100 === 0) {
      console.log(`🎤 [STT-ALIVE] Event #${this.sttEventCount} for ${this.user.userId}: "${text.slice(0, 40)}" (final=${isFinal})`);
    }

    // Log final transcription events for debugging
    if (isFinal) {
      console.log(`🎤 [STT] "${text.slice(0, 80)}" (final=${isFinal}, listening=${this.isListening}, processing=${this.isProcessing})`);
    }

    // Broadcast to SSE clients
    this.broadcast(text, isFinal ?? false);

    // During AI generation (before TTS), ignore entirely
    if (this.isProcessing && !this.isSpeaking) {
      return;
    }

    // During TTS playback, speech = interrupt
    if (this.isProcessing && this.isSpeaking && isFinal && text.trim().length > 0) {
      console.log(`🔇 TTS interrupt: "${text.slice(0, 40)}"`);
      this.interruptedTTS = true;
      this.user.appSession?.audio.stopAudio(2);
      // Fall through to accumulate transcript
    }

    // If we're listening to a specific speaker, ignore others
    if (this.isListening && this.activeSpeakerId && speakerId !== this.activeSpeakerId) {
      return;
    }

    // If in follow-up mode and speech arrives, transition to active listening
    if (this.isFollowUpMode && this.isListening) {
      console.log(`🔄 Follow-up speech detected, continuing conversation`);
      this.isFollowUpMode = false;
      if (this.followUpTimeout) {
        clearTimeout(this.followUpTimeout);
        this.followUpTimeout = undefined;
      }
    }

    // Check for wake word (use user's custom wake word if configured)
    const customWakeWords = this.user.aiConfig?.wakeWord ? [this.user.aiConfig.wakeWord] : undefined;
    const wakeResult = detectWakeWord(text, customWakeWords);

    if (!this.isListening) {
      // Not listening - look for wake word
      if (!wakeResult.detected) {
        return;  // No wake word, ignore
      }

      // Check for duplicate query (delayed transcript from already-processed utterance)
      if (this.isDuplicateQuery(wakeResult.query)) {
        console.log(`⏱️ [WAKE] Ignoring duplicate wake word: "${text}" (isFinal=${isFinal ?? false})`);
        return;
      }

      // Wake word detected! Start listening
      console.log(`⏱️ [WAKE] Wake word detected: "${text}" (isFinal=${isFinal ?? false})`);
      this.flashWakeLed();
      this.startListening(speakerId);
    }

    // We're listening - accumulate transcript (strip user's custom wake word)
    this.currentTranscript = removeWakeWord(text, customWakeWords);
    this.resetSilenceTimeout();

    // Show live transcription on display glasses HUD
    if (this.isListening && this.user.appSession?.capabilities?.hasDisplay) {
      this.user.appSession.layouts.showTextWall(
        `Listening...\n\n${this.currentTranscript}`,
        { durationMs: 5000 }
      );
    }

    // If final transcript, process after a short delay
    if (isFinal) {
      this.resetSilenceTimeout();  // Reset timer on final transcript
    }
  }

  /**
   * Start listening for a query
   */
  private startListening(speakerId?: string): void {
    this.isListening = true;
    this.activeSpeakerId = speakerId;
    this.currentTranscript = '';
    this.transcriptionStartTime = Date.now();

    // Play "start listening" audio cue
    this.playStartSound();

    // Start a new exchange if one isn't already active (follow-ups reuse the same exchange)
    if (!this.user.exchange.isActive()) {
      this.user.exchange.startExchange().catch(console.error);
    }

    // Photo capture deferred — will be taken only if isVisualQuery() says yes
    this.pendingPhoto = null;

    // Start max listening timeout
    this.maxListeningTimeout = setTimeout(() => {
      if (this.isListening && !this.isProcessing) {
        console.log(`⏰ Max listening time reached (${this.MAX_LISTENING_MS}ms)`);
        this.processCurrentQuery();
      }
    }, this.MAX_LISTENING_MS);
  }

  /**
   * Reset the silence timeout
   */
  private resetSilenceTimeout(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    this.silenceTimeout = setTimeout(() => {
      if (this.isListening && !this.isProcessing && this.currentTranscript.trim().length > 0) {
        this.processCurrentQuery();
      }
    }, this.SILENCE_TIMEOUT_MS);
  }

  /**
   * Process the current accumulated query
   */
  private async processCurrentQuery(): Promise<void> {
    if (this.isProcessing) return;

    const query = this.currentTranscript.trim();

    // Bridge intercept — route transcript to Claude Code (handles empty, deferral, and real responses)
    if (this.bridgeResponseCallback) {
      const callback = this.bridgeResponseCallback;
      this.bridgeResponseCallback = null;
      callback(query); // BridgeManager decides: real response vs deferral vs silence
      this.resetState();
      return;
    }

    // Empty query → comprehension failure (silence after wake word)
    if (!query) {
      this.failedComprehensionCount++;
      console.log(`🔇 Empty transcript — comprehension failure ${this.failedComprehensionCount}/${COMPREHENSION_SETTINGS.maxConsecutiveFailures}`);
      if (this.failedComprehensionCount >= COMPREHENSION_SETTINGS.maxConsecutiveFailures) {
        await this.handleComprehensionAutoClose();
        return;
      }
      this.enterFollowUpMode();
      return;
    }

    this.isProcessing = true;
    this.clearTimers();

    // Bing — acknowledge that speech was received and processing is starting
    this.playBingSound();

    // Store first few words for duplicate detection (lowercase, stripped of punctuation)
    this.lastProcessedWords = this.extractWords(query);
    this.lastProcessedTime = Date.now();

    const silenceDetectedAt = Date.now();
    const timeSinceWake = silenceDetectedAt - this.transcriptionStartTime;
    console.log(`⏱️ [SILENCE] Query ready: "${query}" (${timeSinceWake}ms since wake word)`);

    // Check for conversational closers — end exchange without AI call
    const closer = classifyCloser(query);
    if (closer) {
      console.log(`👋 Conversational closer detected: ${closer.type} for "${query}"`);
      if (closer.type === "gratitude") {
        this.user.appSession?.audio.speak("You're welcome!").catch(() => {});
      }
      const reason = closer.type === "gratitude" ? "closer_gratitude" : "closer_dismissal";
      await this.user.exchange.endExchange(reason);
      this.resetState();
      return;
    }

    // Check for device commands (e.g. "take a photo") — short-circuit AI pipeline
    const deviceCmd = classifyDeviceCommand(query);
    if (deviceCmd && this.onDeviceCommand) {
      console.log(`🎛️ Device command detected: ${deviceCmd.type} for "${query}"`);
      try {
        await this.onDeviceCommand(deviceCmd);
      } catch (error) {
        console.error("Error executing device command:", error);
      } finally {
        if (!this.destroyed) {
          this.enterFollowUpMode();
        } else {
          this.resetState();
        }
      }
      return;
    }

    // Check for bridge commands ("I'm ready", "check messages")
    const bridgeCmd = classifyBridgeCommand(query);
    if (bridgeCmd && this.user.bridge.hasParkedRequest()) {
      console.log(`📬 Bridge command detected: ${bridgeCmd.type} for "${query}"`);
      try {
        await this.user.bridge.replayParkedMessage();
      } catch (error) {
        console.error("Error replaying parked message:", error);
      }
      this.resetState();
      return;
    }

    // Classify query: does it need a photo?
    const hasCamera = !(this.user.appSession?.capabilities?.hasDisplay ?? false);
    let isVisual = false;
    let prePhoto: StoredPhoto | null = null;

    if (hasCamera) {
      try {
        isVisual = await isVisualQuery(query, this.user.aiConfig);
        console.log(`🔍 Visual classification: ${isVisual ? 'YES' : 'NO'} for "${query.slice(0, 40)}..."`);
      } catch (error) {
        console.warn('Visual classification failed, defaulting to no photo:', error);
      }

      // Only take photo if the query requires vision
      if (isVisual) {
        // Play shutter sound for audio feedback
        const shutterUrl = getDefaultSoundUrl('shutter.mp3');
        if (shutterUrl && this.user.appSession) {
          this.user.appSession.audio.playAudio({ audioUrl: shutterUrl }).catch(() => {});
        }

        console.log(`📸 Taking photo for visual query: ${this.user.userId}`);
        try {
          prePhoto = await this.user.photo.takePhoto();
        } catch (error) {
          console.warn('Photo capture failed:', error);
        }
        console.log(`⏱️ [PHOTO-CAPTURE] photo=${prePhoto ? 'yes' : 'no'}`);
      }
    }

    // Bail if session destroyed during classification/photo
    if (this.destroyed) {
      console.log(`🛑 Session destroyed during processing for ${this.user.userId}, aborting`);
      this.playErrorSound();
      return;
    }

    // AI call — get QueryResult instead of void
    let queryResult: QueryResult | undefined;
    try {
      if (this.onQueryReady) {
        queryResult = await this.onQueryReady(query, this.activeSpeakerId, prePhoto, isVisual);
      }
    } catch (error) {
      console.error('Error processing query:', error);
      this.playErrorSound();
      this.failedComprehensionCount++;
    }

    // Check response for comprehension failure
    if (queryResult?.response) {
      if (isComprehensionFailure(queryResult.response)) {
        this.failedComprehensionCount++;
        console.log(`🔇 Agent comprehension failure ${this.failedComprehensionCount}/${COMPREHENSION_SETTINGS.maxConsecutiveFailures}: "${queryResult.response.slice(0, 60)}"`);
      } else {
        this.failedComprehensionCount = 0; // success resets counter
      }
    }

    // Check threshold — auto-close after too many consecutive failures
    if (this.failedComprehensionCount >= COMPREHENSION_SETTINGS.maxConsecutiveFailures) {
      // Wait for current TTS to finish before auto-close message
      if (queryResult?.ttsComplete) {
        await queryResult.ttsComplete.catch(() => {});
      }
      await this.handleComprehensionAutoClose();
      return;
    }

    // Bail if session destroyed during AI processing
    if (this.destroyed) {
      this.playErrorSound();
      this.resetState();
      return;
    }

    // Enable mic during TTS for interrupt support
    this.isSpeaking = true;
    this.isListening = true;
    this.interruptedTTS = false;
    this.currentTranscript = '';

    // Green LED
    this.user.appSession?.led.solid("green", 2000).catch(() => {});

    // Wait for TTS to complete (or be interrupted)
    if (queryResult?.ttsComplete) {
      await queryResult.ttsComplete.catch(() => {});
    }
    this.isSpeaking = false;

    // Bail if session destroyed during TTS
    if (this.destroyed) {
      this.resetState();
      return;
    }

    // Handle interrupt vs normal follow-up
    if (this.interruptedTTS) {
      // User's interrupt speech is already accumulating in currentTranscript
      console.log(`🔇 Processing interrupted speech: "${this.currentTranscript.slice(0, 40)}"`);
      this.interruptedTTS = false;
      this.isProcessing = false;
      this.resetSilenceTimeout();
      // Set max listening timeout for the new utterance
      this.maxListeningTimeout = setTimeout(() => {
        if (this.isListening && !this.isProcessing) {
          console.log(`⏰ Max listening time reached (post-interrupt)`);
          this.processCurrentQuery();
        }
      }, this.MAX_LISTENING_MS);
      return;
    }

    this.enterFollowUpMode();
  }

  /**
   * Enter follow-up listening mode after AI response.
   * Green LED for 2s, 5s window to start speaking before returning to IDLE.
   */
  private enterFollowUpMode(): void {
    this.isProcessing = false;
    this.isFollowUpMode = true;
    // isListening already true, LED already shown by processCurrentQuery
    this.isListening = true;
    this.currentTranscript = '';
    this.transcriptionStartTime = Date.now();
    this.pendingPhoto = null;
    this.clearTimers();

    // Follow-up window — if no speech in 10s, return to IDLE and end exchange
    // Timer starts AFTER TTS finishes (not during)
    this.followUpTimeout = setTimeout(() => {
      if (this.isFollowUpMode && !this.isProcessing) {
        // Yield to event loop — let any in-flight transcription events process first.
        // This prevents a race where speech arrives at the same instant as the timeout
        // and would be dropped because resetState() clears isListening before the
        // transcription handler runs.
        setTimeout(() => {
          // Re-check: if speech arrived during yield, follow-up mode was already cancelled
          if (!this.isFollowUpMode || this.isProcessing) return;

          // If transcript accumulated during yield, process it instead of dropping
          if (this.currentTranscript.trim().length > 0) {
            console.log(`⏰ Follow-up timeout fired but speech pending: "${this.currentTranscript.trim().slice(0, 40)}..." — processing`);
            this.isFollowUpMode = false;
            this.processCurrentQuery();
            return;
          }

          console.log(`⏰ Follow-up window expired for ${this.user.userId}, returning to IDLE`);
          this.user.exchange.endExchange("follow_up_timeout").catch(console.error);
          this.resetState();
        }, 0);
      }
    }, this.FOLLOW_UP_WINDOW_MS);

    // Max listening timeout (safety net)
    this.maxListeningTimeout = setTimeout(() => {
      if (this.isListening && !this.isProcessing) {
        console.log(`⏰ Max listening time reached in follow-up mode`);
        this.processCurrentQuery();
      }
    }, this.MAX_LISTENING_MS);

    console.log(`🔄 Follow-up mode active for ${this.user.userId} (${this.FOLLOW_UP_WINDOW_MS}ms window)`);
  }

  /**
   * Auto-close exchange after repeated comprehension failures.
   * Speaks a friendly message and returns to IDLE.
   */
  private async handleComprehensionAutoClose(): Promise<void> {
    console.log(`🔇 Comprehension auto-close for ${this.user.userId} after ${this.failedComprehensionCount} failures`);
    if (this.user.appSession) {
      try {
        await this.user.appSession.audio.speak(COMPREHENSION_SETTINGS.autoCloseMessage);
      } catch (err) {
        console.debug('Comprehension auto-close speech failed:', err);
      }
    }
    await this.user.exchange.endExchange("comprehension_failure").catch(console.error);
    this.resetState();
  }

  /**
   * Reset state to idle
   */
  private resetState(): void {
    this.isListening = false;
    this.isProcessing = false;
    this.isSpeaking = false;
    this.interruptedTTS = false;
    this.failedComprehensionCount = 0;
    this.isFollowUpMode = false;
    this.activeSpeakerId = undefined;
    this.currentTranscript = '';
    this.transcriptionStartTime = 0;
    this.pendingPhoto = null;
    this.clearTimers();
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = undefined;
    }
    if (this.maxListeningTimeout) {
      clearTimeout(this.maxListeningTimeout);
      this.maxListeningTimeout = undefined;
    }
    if (this.followUpTimeout) {
      clearTimeout(this.followUpTimeout);
      this.followUpTimeout = undefined;
    }
  }

  /**
   * Extract first N words from a query (lowercase, punctuation stripped)
   */
  private extractWords(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')  // Remove punctuation
      .split(/\s+/)
      .filter(w => w.length > 0)
      .slice(0, this.DUPLICATE_WORD_COUNT);
  }

  /**
   * Check if a query is a duplicate of the last processed query
   */
  private isDuplicateQuery(query: string): boolean {
    // No previous query to compare
    if (this.lastProcessedWords.length === 0) {
      return false;
    }

    // Outside the duplicate detection window
    if (Date.now() - this.lastProcessedTime > this.DUPLICATE_WINDOW_MS) {
      return false;
    }

    // Extract words from incoming query
    const incomingWords = this.extractWords(query);

    // If incoming query is too short, compare what we have
    if (incomingWords.length === 0) {
      return false;
    }

    // Compare words - all incoming words must match the start of last processed
    const wordsToCompare = Math.min(incomingWords.length, this.lastProcessedWords.length);
    for (let i = 0; i < wordsToCompare; i++) {
      if (incomingWords[i] !== this.lastProcessedWords[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Flash the green LED briefly to acknowledge wake word detection
   */
  private flashWakeLed(): void {
    if (this.user.appSession) {
      this.user.appSession.led.solid("green", 500).catch((err) => {
        console.debug('Wake LED flash failed:', err);
      });
    }
  }

  /**
   * Play the start listening sound
   */
  private playStartSound(): void {
    const soundUrl = process.env.START_LISTENING_SOUND_URL || getDefaultSoundUrl('start.mp3');
    if (soundUrl && this.user.appSession) {
      this.user.appSession.audio.playAudio({ audioUrl: soundUrl }).catch((err) => {
        console.debug('Start listening sound failed:', err);
      });
    }
  }

  /**
   * Play a short bing to acknowledge speech was received (silence timeout fired)
   */
  private playBingSound(): void {
    const soundUrl = getDefaultSoundUrl('bing.mp3');
    if (soundUrl && this.user.appSession) {
      this.user.appSession.audio.playAudio({ audioUrl: soundUrl }).catch((err) => {
        console.debug('Bing sound failed:', err);
      });
    }
  }

  /**
   * Play an error tone when the pipeline fails unexpectedly
   */
  private playErrorSound(): void {
    const soundUrl = getDefaultSoundUrl('error.mp3');
    if (soundUrl && this.user.appSession) {
      this.user.appSession.audio.playAudio({ audioUrl: soundUrl }).catch((err) => {
        console.debug('Error sound failed:', err);
      });
    }
  }

  /**
   * Manually activate listening mode (e.g. from a double-tap gesture).
   * Equivalent to hearing the wake word — plays the start sound,
   * flashes the LED, and begins accumulating the next utterance.
   */
  activateListening(): void {
    // Ignore if already listening or processing
    if (this.isListening || this.isProcessing) return;

    console.log(`🎤 [MANUAL] Listening activated for ${this.user.userId}`);
    this.flashWakeLed();
    this.startListening();
  }

  /**
   * Check if currently listening for a query
   */
  get listening(): boolean {
    return this.isListening;
  }

  /**
   * Check if currently processing a query
   */
  get processing(): boolean {
    return this.isProcessing;
  }

  /**
   * Push a transcription event to all connected SSE clients
   */
  broadcast(text: string, isFinal: boolean): void {
    const payload = JSON.stringify({
      text,
      isFinal,
      timestamp: Date.now(),
      userId: this.user.userId,
    });

    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  addSSEClient(client: SSEWriter): void {
    this.sseClients.add(client);
  }

  removeSSEClient(client: SSEWriter): void {
    this.sseClients.delete(client);
  }

  /**
   * Tear down listener and drop all SSE clients
   */
  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sseClients.clear();
    this.resetState();
  }
}
