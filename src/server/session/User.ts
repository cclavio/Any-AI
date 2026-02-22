import { AppSession } from "@mentra/sdk";
import { PhotoManager } from "../manager/PhotoManager";
import { TranscriptionManager } from "../manager/TranscriptionManager";
import { AudioManager } from "../manager/AudioManager";
import { StorageManager } from "../manager/StorageManager";
import { InputManager } from "../manager/InputManager";
import { LocationManager } from "../manager/LocationManager";
import { NotificationManager } from "../manager/NotificationManager";
import { ChatHistoryManager } from "../manager/ChatHistoryManager";
import { QueryProcessor } from "../manager/QueryProcessor";
import { DeviceCommandHandler } from "../manager/DeviceCommandHandler";
import type { UserAIConfig } from "../agent/providers/types";
import { DEFAULT_AI_CONFIG, getModelDisplayName } from "../agent/providers/types";
import { db, isDbAvailable } from "../db/client";
import { userSettings } from "../db/schema";
import { getApiKey } from "../db/vault";
import { eq } from "drizzle-orm";

/**
 * User — per-user state container.
 *
 * Composes all managers and holds the glasses AppSession.
 * Created when a user connects (glasses or webview) and
 * destroyed when the session is cleaned up.
 */
/** Known glasses models */
export const GLASSES_MODELS = {
  EVEN_REALITIES_G1: "Even Realities G1",
  MENTRA_LIVE: "Mentra Live",
} as const;

export class User {
  /** Active glasses connection, null when webview-only */
  appSession: AppSession | null = null;

  /** Device model name — fallback is Mentra Live (camera glasses) */
  glassesModel: string = GLASSES_MODELS.MENTRA_LIVE;

  /** True if the connected glasses have a camera (i.e. not a HUD-only device) */
  get isCameraGlasses(): boolean {
    return this.glassesModel !== GLASSES_MODELS.EVEN_REALITIES_G1;
  }

  /** User's AI configuration (loaded from DB + Vault on init) */
  aiConfig: UserAIConfig | undefined = undefined;

  /** Photo capture, storage, and SSE broadcasting */
  photo: PhotoManager;

  /** Speech-to-text listener, wake word detection, and SSE broadcasting */
  transcription: TranscriptionManager;

  /** Text-to-speech and audio control */
  audio: AudioManager;

  /** User preferences via MentraOS Simple Storage */
  storage: StorageManager;

  /** Button presses and touchpad gestures */
  input: InputManager;

  /** GPS location, geocoding, and weather */
  location: LocationManager;

  /** Phone notifications for context */
  notifications: NotificationManager;

  /** Conversation history storage */
  chatHistory: ChatHistoryManager;

  /** Query processing pipeline */
  queryProcessor: QueryProcessor;

  /** Hardware device command executor (photo capture, etc.) */
  deviceCommand: DeviceCommandHandler;

  constructor(public readonly userId: string) {
    this.photo = new PhotoManager(this);
    this.transcription = new TranscriptionManager(this);
    this.audio = new AudioManager(this);
    this.storage = new StorageManager(this);
    this.input = new InputManager(this);
    this.location = new LocationManager(this);
    this.notifications = new NotificationManager(this);
    this.chatHistory = new ChatHistoryManager(this);
    this.queryProcessor = new QueryProcessor(this);
    this.deviceCommand = new DeviceCommandHandler(this);
  }

  /**
   * Initialize async components — loads AI config from DB + Vault
   */
  async initialize(): Promise<void> {
    await this.chatHistory.initialize();

    // Load AI config from Supabase if available
    if (isDbAvailable()) {
      try {
        await this.loadAIConfig();
      } catch (error) {
        console.warn(`Failed to load AI config for ${this.userId}:`, error);
      }
    }

    console.log(`✅ User ${this.userId} initialized (aiConfig: ${this.aiConfig?.isConfigured ? 'configured' : 'not configured'})`);
  }

  /**
   * Load AI configuration from user_settings + Vault
   */
  private async loadAIConfig(): Promise<void> {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, this.userId));

    if (!settings) return;

    // Decrypt API keys from Vault
    let llmApiKey = "";
    let visionApiKey = "";
    let googleCloudApiKey: string | undefined;

    if (settings.llmApiKeyVaultId) {
      llmApiKey = (await getApiKey(settings.llmApiKeyVaultId)) ?? "";
    }
    if (settings.visionApiKeyVaultId) {
      visionApiKey = (await getApiKey(settings.visionApiKeyVaultId)) ?? "";
    }
    if (settings.googleCloudApiKeyVaultId) {
      googleCloudApiKey = (await getApiKey(settings.googleCloudApiKeyVaultId)) ?? undefined;
    }

    const llmProvider = (settings.llmProvider ?? "openai") as UserAIConfig["llmProvider"];
    const llmModel = settings.llmModel ?? "gpt-5-mini";
    const visionProvider = (settings.visionProvider ?? "google") as UserAIConfig["visionProvider"];

    this.aiConfig = {
      agentName: settings.agentName,
      wakeWord: settings.wakeWord,
      llmProvider,
      llmModel,
      llmModelName: getModelDisplayName(llmProvider, llmModel),
      llmApiKey,
      visionProvider,
      visionModel: settings.visionModel ?? "gemini-2.5-flash",
      visionApiKey,
      googleCloudApiKey,
      isConfigured: settings.isAiConfigured,
    };
  }

  /**
   * Reload AI config from Supabase (DB + Vault).
   * Called after webview saves to refresh the live session immediately.
   */
  async reloadAIConfig(): Promise<void> {
    if (!isDbAvailable()) return;
    try {
      await this.loadAIConfig();
      console.log(`🔄 AI config reloaded for ${this.userId} (${this.aiConfig?.isConfigured ? 'configured' : 'not configured'})`);
    } catch (error) {
      console.warn(`Failed to reload AI config for ${this.userId}:`, error);
    }
  }

  /** Wire up a glasses connection — sets up all event listeners */
  setAppSession(session: AppSession): void {
    // Clean up old session if exists (reconnect without clean onStop)
    if (this.appSession) {
      this.clearAppSession();
    }
    this.appSession = session;
    this.transcription.setup(session);
    this.input.setup(session);
    console.log(`🔗 Session connected for ${this.userId}`);
  }

  /** Disconnect glasses but keep user alive (photos, SSE clients stay) */
  clearAppSession(): void {
    this.transcription.destroy();
    this.appSession = null;
  }

  /** Nuke everything — call on full disconnect */
  cleanup(): void {
    this.transcription.destroy();
    this.photo.destroy();
    this.location.destroy();
    this.notifications.destroy();
    this.chatHistory.destroy();
    this.appSession = null;
    console.log(`🗑️ User ${this.userId} cleaned up`);
  }
}
