/**
 * QueryProcessor - Orchestrates the full query → response pipeline
 *
 * This is the main entry point for processing user queries.
 * It coordinates all managers and the agent to produce responses.
 */

import type { User } from "../session/User";
import type { StoredPhoto } from "./PhotoManager";
import { generateResponse, type GenerateOptions } from "../agent/MentraAgent";
import { broadcastChatEvent } from "../api/chat";
import { formatForTTS } from "../utils/tts-formatter";
import { getDefaultSoundUrl } from "../constants/config";
import { isDbAvailable, db, photos } from "../db";
import { eq } from "drizzle-orm";

const PROCESSING_SOUND_URL = process.env.PROCESSING_SOUND_URL || getDefaultSoundUrl('processing.mp3');

/**
 * Result from processing a query — includes the text response and
 * a promise that resolves when TTS output finishes.
 */
export interface QueryResult {
  response: string;
  ttsComplete: Promise<void>;
}

/**
 * QueryProcessor — handles the full query processing pipeline.
 */
export class QueryProcessor {
  private processingSoundLooping = false;

  constructor(private user: User) {}

  /**
   * Process a user query and return the response.
   * prePhoto is a photo pre-captured at wake word time (already awaited).
   * isVisual indicates whether the query was classified as needing the camera photo.
   */
  async processQuery(query: string, speakerId?: string, prePhoto?: StoredPhoto | null, isVisual?: boolean): Promise<QueryResult> {
    const session = this.user.appSession;
    if (!session) {
      console.error(`No active session for ${this.user.userId}`);
      return { response: "I'm not connected to your glasses right now.", ttsComplete: Promise.resolve() };
    }

    const pipelineStart = Date.now();
    const lap = (label: string) => console.log(`⏱️ [${label}] +${Date.now() - pipelineStart}ms`);

    // Determine glasses type from hasDisplay — the single source of truth.
    // hasDisplay=true → display glasses (no camera, no speakers)
    // hasDisplay=false → camera glasses (has camera, has speakers)
    const hasDisplay = session.capabilities?.hasDisplay ?? false;
    const hasCamera = !hasDisplay;
    const hasSpeakers = !hasDisplay;

    console.log(`⏱️ [PIPELINE-START] Query: "${query.slice(0, 60)}..." | prePhoto: ${prePhoto ? 'yes' : 'no'} | isVisual: ${isVisual ?? 'n/a'} | glasses: ${hasDisplay ? 'display' : 'camera'}`);

    // Start looping processing sound (fire and forget - don't block pipeline)
    this.startProcessingSound(hasDisplay);
    this.showStatus("Processing...", hasDisplay);
    lap('PROCESSING-SOUND');

    // Step 1: Use pre-captured photo, or fallback capture (only for visual queries)
    let photoBuffers: Buffer[] = [];
    let photoDataUrl: string | undefined;
    let sourcePhoto: StoredPhoto | null = null;

    if (hasCamera) {
      if (prePhoto) {
        console.log(`📸 Using pre-captured photo for ${this.user.userId}`);
        photoBuffers = this.user.photo.getPhotosForContext();
        photoDataUrl = `data:${prePhoto.mimeType};base64,${prePhoto.buffer.toString("base64")}`;
        sourcePhoto = prePhoto;
        lap('PHOTO-FROM-CACHE');
      } else if (isVisual) {
        // Visual query with no pre-photo — fallback capture with 10s timeout
        console.log(`📸 Visual query but no pre-photo, attempting fallback capture for ${this.user.userId}`);
        let timeoutId: NodeJS.Timeout;
        const currentPhoto = await Promise.race([
          this.user.photo.takePhoto(),
          new Promise<null>(r => { timeoutId = setTimeout(() => r(null), 10000); }),
        ]);
        clearTimeout(timeoutId!);
        if (currentPhoto) {
          photoBuffers = this.user.photo.getPhotosForContext();
          photoDataUrl = `data:${currentPhoto.mimeType};base64,${currentPhoto.buffer.toString("base64")}`;
          sourcePhoto = currentPhoto;
        } else {
          console.warn(`📸 Fallback photo capture failed/timed out for ${this.user.userId}`);
        }
        lap('PHOTO-FALLBACK-CAPTURE');
      } else {
        // Non-visual query, no pre-photo — skip entirely
        lap('PHOTO-SKIPPED-NON-VISUAL');
      }
    }

    // Persist analysis photo to DB (no Storage upload for analysis-only photos)
    let photoId: string | undefined;
    if (sourcePhoto) {
      photoId = await this.persistAnalysisPhoto(sourcePhoto).catch((err) => {
        console.error(`📸 [QP] Analysis photo persist failed for ${this.user.userId}:`, err);
        return undefined;
      });
    }
    lap('PERSIST-ANALYSIS-PHOTO');

    // If the query needed a photo but we couldn't get one, tell the user directly
    // instead of sending a photoless query to the LLM (which gives a useless answer)
    if (isVisual && photoBuffers.length === 0) {
      this.stopProcessingSound();
      const errorMsg = "Sorry, I couldn't capture a photo. Please make sure camera permission is enabled in the MentraOS app and try again.";
      console.warn(`📸 Visual query failed — no photo available for ${this.user.userId}`);

      broadcastChatEvent(this.user.userId, {
        type: "message",
        id: `user-${Date.now()}`,
        senderId: this.user.userId,
        recipientId: "mentra-ai",
        content: query,
        timestamp: new Date().toISOString(),
      });
      broadcastChatEvent(this.user.userId, {
        type: "message",
        id: `ai-${Date.now()}`,
        senderId: "mentra-ai",
        recipientId: this.user.userId,
        content: errorMsg,
        timestamp: new Date().toISOString(),
      });
      broadcastChatEvent(this.user.userId, { type: "idle" });

      const ttsComplete = this.outputResponse(errorMsg, hasSpeakers, hasDisplay);
      return { response: errorMsg, ttsComplete };
    }

    // Broadcast user message to frontend (with photo if available)
    broadcastChatEvent(this.user.userId, {
      type: "message",
      id: `user-${Date.now()}`,
      senderId: this.user.userId,
      recipientId: "mentra-ai",
      content: query,
      timestamp: new Date().toISOString(),
      image: photoDataUrl,
    });

    // Broadcast processing state
    broadcastChatEvent(this.user.userId, { type: "processing" });
    lap('SSE-BROADCAST-USER-MSG');

    // Step 2: Fetch location if needed
    if (this.user.location.queryNeedsLocation(query)) {
      try {
        const locationData = await session.location.getLatestLocation({ accuracy: "high" });
        if (locationData) {
          this.user.location.updateCoordinates(locationData.lat, locationData.lng);
          await this.user.location.fetchContextIfNeeded(query);
        }
      } catch (error) {
        console.warn(`Failed to get location for ${this.user.userId}:`, error);
      }
      lap('LOCATION-FETCH');
    }

    // Step 3: Get local date and time
    const localTime = this.getLocalDateTime();

    // Step 4: Build agent context (using snapshotted capabilities from pipeline start)
    const hasPhotos = photoDataUrl !== undefined; // current query's photo, not stale ones

    // Load exchange-grouped history for prompt context
    const exchangeGroups = await this.user.chatHistory.getHistoryGroupedByExchange();

    const context: GenerateOptions["context"] = {
      hasDisplay,
      hasSpeakers,
      hasCamera,
      hasPhotos,
      glassesType: hasDisplay ? 'display' : 'camera',
      location: this.user.location.getCachedContext(),
      localTime,
      timezone: this.user.location.getTimezone() ?? undefined,
      notifications: this.user.notifications.formatForPrompt(),
      calendar: this.user.calendar.formatForPrompt(),
      conversationHistory: this.user.chatHistory.getRecentTurns(),
      exchangeGroups,
    };
    lap('BUILD-CONTEXT');

    // Step 5: Generate response (pass user's AI config for multi-provider routing)
    this.showStatus("Thinking...", hasDisplay);
    let response: string;
    try {
      const result = await generateResponse({
        query,
        photos: photoBuffers.length > 0 ? photoBuffers : undefined,
        context,
        aiConfig: this.user.aiConfig,
        onToolCall: (toolName) => {
          if (toolName === 'search' || toolName === 'web_search' || toolName === 'google_search') {
            this.showStatus("Searching...", hasDisplay);
          }
        },
      });
      response = result.response;
    } catch (error) {
      console.error(`Agent error for ${this.user.userId}:`, error);
      response = "I'm sorry, I had trouble processing that. Please try again.";
    }
    lap('AI-GENERATE-RESPONSE');

    // Broadcast AI response to frontend
    broadcastChatEvent(this.user.userId, {
      type: "message",
      id: `ai-${Date.now()}`,
      senderId: "mentra-ai",
      recipientId: this.user.userId,
      content: response,
      timestamp: new Date().toISOString(),
    });

    // Broadcast idle state
    broadcastChatEvent(this.user.userId, { type: "idle" });
    lap('SSE-BROADCAST-AI-MSG');

    // Step 6: Format response for output
    const formattedResponse = this.formatResponse(
      response,
      context.hasSpeakers,
      context.hasDisplay
    );

    // Step 7: Stop processing sound loop and start output (don't await — TranscriptionManager controls TTS lifecycle for interrupt support)
    this.stopProcessingSound();
    const ttsComplete = this.outputResponse(formattedResponse, context.hasSpeakers, context.hasDisplay);
    lap('OUTPUT-TO-GLASSES-STARTED');

    // Update photo analysis with LLM response (fire-and-forget)
    if (photoId) {
      this.updatePhotoAnalysis(photoId, response).catch((err) => {
        console.error(`📸 [QP] Photo analysis update failed for ${this.user.userId}:`, err);
      });
    }

    // Step 8: Save to chat history (with active context IDs and exchange ID for traceability)
    const hadPhoto = photoBuffers.length > 0;
    const contextIds = [
      ...this.user.calendar.getActiveContextIds(),
      ...this.user.notifications.getActiveContextIds(),
    ];
    const exchangeId = this.user.exchange.getCurrentExchangeId();
    await this.user.chatHistory.addTurn(query, response, hadPhoto, photoDataUrl, photoId, contextIds, exchangeId);
    lap('SAVE-HISTORY');

    console.log(`⏱️ [PIPELINE-DONE] Total: ${Date.now() - pipelineStart}ms`);

    return { response, ttsComplete };
  }

  /**
   * Show a status message on the HUD (display glasses only)
   */
  private showStatus(text: string, hasDisplay?: boolean): void {
    const session = this.user.appSession;
    const isDisplay = hasDisplay ?? session?.capabilities?.hasDisplay ?? false;
    if (!session || !isDisplay) return;
    session.layouts.showTextWall(text, { durationMs: 10000 });
  }

  /**
   * Start looping the processing sound until stopProcessingSound() is called
   */
  private startProcessingSound(hasDisplay?: boolean): void {
    if (!PROCESSING_SOUND_URL || !this.user.appSession) return;
    // Don't play sound on display glasses — they have no speakers and get visual status instead
    const isDisplay = hasDisplay ?? this.user.appSession.capabilities?.hasDisplay ?? false;
    if (isDisplay) return;

    this.processingSoundLooping = true;
    this.loopProcessingSound();
  }

  /**
   * Loop that replays the processing sound until the flag is cleared
   */
  private async loopProcessingSound(): Promise<void> {
    while (this.processingSoundLooping && this.user.appSession) {
      try {
        await this.user.appSession.audio.playAudio({ audioUrl: PROCESSING_SOUND_URL! });
      } catch {
        break;
      }
    }
  }

  /**
   * Stop the processing sound loop
   */
  private stopProcessingSound(): void {
    this.processingSoundLooping = false;
  }

  /**
   * Get local date and time string
   */
  private getLocalDateTime(): string {
    // Use timezone (available even before geocoding, set from SDK settings or GPS auto-detect)
    const timezone = this.user.location.getTimezone();

    if (!timezone) {
      console.warn(`⚠️ No timezone set for ${this.user.userId} — time will use server default (likely UTC)`);
    }

    try {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      };

      if (timezone) {
        options.timeZone = timezone;
      }

      const dateTimeStr = now.toLocaleString("en-US", options);
      console.log(`🕐 Local date/time for ${this.user.userId}: ${dateTimeStr} (tz=${timezone ?? 'server-default'})`);
      return dateTimeStr;
    } catch {
      return new Date().toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }

  /**
   * Format response for output
   */
  private formatResponse(
    response: string,
    hasSpeakers: boolean,
    hasDisplay: boolean
  ): string {
    // For speaker-only glasses, format for TTS
    if (hasSpeakers && !hasDisplay) {
      return formatForTTS(response);
    }

    // For HUD glasses or mixed, return as-is
    return response;
  }

  /**
   * Persist an analysis photo to the photos table (no Storage upload).
   * Returns the photo UUID, or undefined if DB is unavailable.
   */
  private async persistAnalysisPhoto(photo: StoredPhoto): Promise<string | undefined> {
    if (!isDbAvailable()) return undefined;

    const [row] = await db.insert(photos).values({
      userId: photo.userId,
      requestId: photo.requestId,
      storagePath: null,
      filename: photo.filename,
      mimeType: photo.mimeType,
      sizeBytes: photo.size,
      saved: false,
      capturedAt: photo.timestamp,
    }).returning({ id: photos.id });

    console.log(`📸 [QP] Analysis photo persisted: ${row.id}`);
    return row.id;
  }

  /**
   * Update a photo row with the LLM analysis text.
   */
  private async updatePhotoAnalysis(photoId: string, analysis: string): Promise<void> {
    if (!isDbAvailable()) return;

    await db.update(photos).set({ analysis }).where(eq(photos.id, photoId));
    console.log(`📸 [QP] Photo analysis updated: ${photoId}`);
  }

  /**
   * Output the response (speak and/or display)
   */
  private async outputResponse(
    response: string,
    hasSpeakers: boolean,
    hasDisplay: boolean
  ): Promise<void> {
    const session = this.user.appSession;
    if (!session) return;

    // Display on HUD if available
    if (hasDisplay) {
      try {
        await session.layouts.showTextWall(response, { durationMs: 10000 });
      } catch (error) {
        console.debug("Display output failed:", error);
      }
    }

    // Speak if speakers available
    if (hasSpeakers) {
      try {
        await session.audio.speak(response);
      } catch (error) {
        console.debug("Speech output failed:", error);
      }
    }
  }
}
