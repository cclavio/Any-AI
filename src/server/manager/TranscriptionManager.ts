import type { AppSession, TranscriptionData } from "@mentra/sdk";
import type { User } from "../session/User";
import type { StoredPhoto } from "./PhotoManager";
import { detectWakeWord, removeWakeWord } from "../utils/wake-word";
import { isVisualQuery } from "../agent/visual-classifier";

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
    this.unsubscribe = session.events.onTranscription(
      (data: TranscriptionData) => {
        this.handleTranscription(data);
      },
    );
    console.log(`🎤 TranscriptionManager ready for ${this.user.userId}`);
  }

  /**
   * Handle incoming transcription data
   */
  private async handleTranscription(data: TranscriptionData): Promise<void> {
    const { text, isFinal, speakerId } = data as TranscriptionData & { speakerId?: string };

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

    // Check for wake word
    const wakeResult = detectWakeWord(text);

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
      this.startListening(speakerId);
    }

    // We're listening - accumulate transcript
    this.currentTranscript = removeWakeWord(text);
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

    // Capture photo NOW while user is still speaking (parallel with transcript accumulation)
    const hasCamera = this.user.appSession?.capabilities?.hasCamera ?? false;
    if (hasCamera) {
      console.log(`📸 Pre-capturing photo at wake word for ${this.user.userId}`);
      this.pendingPhoto = this.user.photo.takePhoto();
    } else {
      this.pendingPhoto = null;
    }

    // Play start listening sound
    // NOTE: Don't do this because it interferes with the Mentra Live's camera's "snap" sound
    //this.playStartSound();

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

    // Smart photo await: classify query first, then decide whether to wait for photo
    const hasCamera = this.user.appSession?.capabilities?.hasCamera ?? false;

    // 1. Fire classifier immediately (photo still in-flight from wake word)
    const classifierStart = Date.now();
    const isVisual = hasCamera ? await isVisualQuery(query) : false;
    console.log(`⏱️ [CLASSIFIER] isVisual=${isVisual} (${Date.now() - classifierStart}ms)`);

    // 2. Bail if session was destroyed while classifier was running
    if (this.destroyed) {
      console.log(`🛑 Session destroyed during classifier for ${this.user.userId}, aborting`);
      return;
    }

    // 3. Now decide how to handle the photo
    let prePhoto: StoredPhoto | null = null;
    if (this.pendingPhoto) {
      const photoWaitStart = Date.now();
      try {
        if (isVisual) {
          // VISUAL — wait for photo (10s safety timeout)
          let timeoutId: NodeJS.Timeout;
          prePhoto = await Promise.race([
            this.pendingPhoto,
            new Promise<null>(r => { timeoutId = setTimeout(() => r(null), 10000); }),
          ]);
          clearTimeout(timeoutId!);
        } else {
          // NON-VISUAL — grab photo only if already settled
          // setTimeout(0) = next macrotask, lets an already-settled photo win the race
          prePhoto = await Promise.race([
            this.pendingPhoto,
            new Promise<null>(r => setTimeout(() => r(null), 0)),
          ]);
        }
      } catch (error) {
        console.warn('Pre-captured photo failed:', error);
      }
      this.pendingPhoto = null;
      console.log(`⏱️ [PHOTO-AWAIT] ${Date.now() - photoWaitStart}ms | visual=${isVisual} | photo=${prePhoto ? 'yes' : 'no'}`);
    }

    // 4. Bail if session destroyed during photo wait
    if (this.destroyed) {
      console.log(`🛑 Session destroyed during photo await for ${this.user.userId}, aborting`);
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
   * Play the start listening sound
   */
  private playStartSound(): void {
    const soundUrl = process.env.START_LISTENING_SOUND_URL;
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
