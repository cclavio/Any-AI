import type { AppSession, TranscriptionData } from "@mentra/sdk";
import type { User } from "../session/User";
import type { StoredPhoto } from "./PhotoManager";
import { detectWakeWord, removeWakeWord } from "../utils/wake-word";
import { isVisualQuery } from "../agent/visual-classifier";
import { getDefaultSoundUrl } from "../constants/config";

interface SSEWriter {
  write: (data: string) => void;
  userId: string;
  close: () => void;
}

/**
 * Callback signature for when a query is ready to be processed.
 * Includes pre-captured photo (taken at wake word time) and visual classification.
 */
export type OnQueryReadyCallback = (query: string, speakerId?: string, prePhoto?: StoredPhoto | null, isVisual?: boolean) => Promise<void>;

/**
 * TranscriptionManager — handles speech-to-text, wake word detection,
 * speaker locking, and SSE broadcasting for a single user.
 *
 * Simplified architecture:
 * - No follow-up mode
 * - No head position tracking
 * - No cancellation phrases
 * - Clean state machine: IDLE -> LISTENING -> (callback) -> IDLE
 */
export class TranscriptionManager {
  private sseClients: Set<SSEWriter> = new Set();
  private unsubscribe: (() => void) | null = null;

  // State
  private isListening: boolean = false;
  private isProcessing: boolean = false;
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

  // Timers
  private silenceTimeout: NodeJS.Timeout | undefined;
  private maxListeningTimeout: NodeJS.Timeout | undefined;

  // Config
  private readonly SILENCE_TIMEOUT_MS = 1500;  // 1.5s silence = query complete
  private readonly MAX_LISTENING_MS = 15000;   // 15s max listening time

  // Callback for when query is ready
  private onQueryReady: OnQueryReadyCallback | null = null;

  // Session disconnect safety — prevents zombie query processing
  private destroyed = false;

  constructor(private user: User) {}

  /**
   * Set the callback to be invoked when a query is ready
   */
  setOnQueryReady(callback: OnQueryReadyCallback): void {
    this.onQueryReady = callback;
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

    const wakeWord = this.user.aiConfig?.wakeWord ?? 'hey any ai';
    console.log(`🎤 TranscriptionManager ready for ${this.user.userId} (wake word: "${wakeWord}")`);
  }

  /**
   * Handle incoming transcription data
   */
  private async handleTranscription(data: TranscriptionData): Promise<void> {
    const { text, isFinal, speakerId } = data as TranscriptionData & { speakerId?: string };

    // Log all transcription events for debugging (truncated to avoid log spam)
    if (isFinal) {
      console.log(`🎤 [STT] "${text.slice(0, 80)}" (final=${isFinal}, listening=${this.isListening}, processing=${this.isProcessing})`);
    }

    // Broadcast to SSE clients
    this.broadcast(text, isFinal ?? false);

    // Ignore if we're currently processing a query
    if (this.isProcessing) {
      return;
    }

    // If we're listening to a specific speaker, ignore others
    if (this.isListening && this.activeSpeakerId && speakerId !== this.activeSpeakerId) {
      return;
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
    if (!query) {
      this.resetState();
      return;
    }

    this.isProcessing = true;
    this.clearTimers();

    // Store first few words for duplicate detection (lowercase, stripped of punctuation)
    this.lastProcessedWords = this.extractWords(query);
    this.lastProcessedTime = Date.now();

    const silenceDetectedAt = Date.now();
    const timeSinceWake = silenceDetectedAt - this.transcriptionStartTime;
    console.log(`⏱️ [SILENCE] Query ready: "${query}" (${timeSinceWake}ms since wake word)`);

    // Classify query: does it need a photo?
    const hasCamera = this.user.appSession?.capabilities?.hasCamera ?? false;
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
      return;
    }

    try {
      if (this.onQueryReady) {
        await this.onQueryReady(query, this.activeSpeakerId, prePhoto, isVisual);
      }
    } catch (error) {
      console.error('Error processing query:', error);
    } finally {
      this.resetState();
    }
  }

  /**
   * Reset state to idle
   */
  private resetState(): void {
    this.isListening = false;
    this.isProcessing = false;
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
