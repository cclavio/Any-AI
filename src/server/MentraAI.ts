/**
 * MentraAI — Main MentraOS AppServer for the Any AI assistant.
 *
 * Handles the glasses lifecycle (onSession/onStop) and wires up
 * all the managers, event listeners, and query processing.
 */

import { AppServer, AppSession } from "@mentra/sdk";
import { sessions } from "./manager/SessionManager";
import { broadcastChatEvent } from "./api/chat";
import type { User } from "./session/User";
import { getDefaultSoundUrl } from "./constants/config";

const WELCOME_SOUND_URL = process.env.WELCOME_SOUND_URL || getDefaultSoundUrl('welcome.mp3');

export interface MentraAIConfig {
  packageName: string;
  apiKey: string;
  port: number;
  cookieSecret?: string;
}

export class MentraAI extends AppServer {
  constructor(config: MentraAIConfig) {
    super({
      packageName: config.packageName,
      apiKey: config.apiKey,
      port: config.port,
      cookieSecret: config.cookieSecret,
    });
  }

  /**
   * Called when a user launches the app on their glasses
   */
  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    console.log(`🚀 Any AI session started for ${userId} | model: ${session.capabilities?.modelName ?? 'unknown (capabilities not yet loaded)'} | hasCamera: ${session.capabilities?.hasCamera} | hasDisplay: ${session.capabilities?.hasDisplay} | hasSpeaker: ${session.capabilities?.hasSpeaker}`);

    // ★ Reconnect detection — check if user already has an active session
    const existingUser = sessions.get(userId);
    if (existingUser) {
      console.log(`🔄 Reconnect for ${userId} (skipping welcome)`);
      existingUser.setAppSession(session);

      // Resolve AI config from MentraOS settings (fallback if not configured via web UI)
      existingUser.resolveAIConfigFromSession();

      // Listen for settings changes from MentraOS companion app
      this.setupSettingsListeners(session, existingUser);

      // Re-attach event listeners
      existingUser.transcription.setOnQueryReady(async (query, speakerId, prePhoto, isVisual) => {
        await existingUser.queryProcessor.processQuery(query, speakerId, prePhoto, isVisual);
      });

      session.events.onLocation((locationData) => {
        existingUser.location.updateCoordinates(locationData.lat, locationData.lng);
      });

      session.events.onPhoneNotifications((notifications) => {
        if (Array.isArray(notifications)) {
          existingUser.notifications.addNotifications(notifications);
        } else if (notifications) {
          existingUser.notifications.addNotification(notifications);
        }
      });

      const userTimezone = session.settings.getMentraOS<string>('userTimezone');
      if (userTimezone) {
        existingUser.location.setTimezone(userTimezone);
      }

      session.settings.onMentraosChange<string>('userTimezone', (newTimezone) => {
        if (newTimezone) {
          existingUser.location.setTimezone(newTimezone);
        }
      });

      session.device.state.modelName.onChange((newModel) => {
        if (newModel) {
          existingUser.glassesModel = newModel;
        }
      });

      // Notify frontend
      const hasDisplay = session.capabilities?.hasDisplay ?? false;
      broadcastChatEvent(userId, {
        type: "session_started",
        glassesType: hasDisplay ? "display" : "camera",
        timestamp: new Date().toISOString(),
      });

      console.log(`✅ Any AI reconnected for ${userId}`);
      return; // Skip welcome and re-initialization
    }

    // First connection — full setup
    const user = sessions.getOrCreate(userId);

    // Initialize async components (database, settings)
    await user.initialize();

    // Wire up glasses session
    user.setAppSession(session);

    // Resolve AI config from MentraOS settings (fallback if not configured via web UI)
    user.resolveAIConfigFromSession();

    // Listen for settings changes from MentraOS companion app
    this.setupSettingsListeners(session, user);

    // Set up transcription callback for query processing
    user.transcription.setOnQueryReady(async (query, speakerId, prePhoto, isVisual) => {
      await user.queryProcessor.processQuery(query, speakerId, prePhoto, isVisual);
    });

    // Wire up location updates
    session.events.onLocation((locationData) => {
      user.location.updateCoordinates(locationData.lat, locationData.lng);
    });

    // Wire up phone notifications
    session.events.onPhoneNotifications((notifications) => {
      if (Array.isArray(notifications)) {
        user.notifications.addNotifications(notifications);
      } else if (notifications) {
        user.notifications.addNotification(notifications);
      }
    });

    // Wire up timezone from SDK settings
    const userTimezone = session.settings.getMentraOS<string>('userTimezone');
    if (userTimezone) {
      user.location.setTimezone(userTimezone);
      console.log(`🕐 Set timezone: ${userTimezone}`);
    }

    // Listen for timezone changes
    session.settings.onMentraosChange<string>('userTimezone', (newTimezone) => {
      if (newTimezone) {
        user.location.setTimezone(newTimezone);
        console.log(`🕐 Updated timezone: ${newTimezone}`);
      }
    });

    // Track device model — arrives async via DEVICE_STATE_UPDATE
    session.device.state.modelName.onChange((newModel) => {
      if (newModel) {
        user.glassesModel = newModel;
        console.log(`📱 Device model: ${newModel} for ${userId} (camera: ${user.isCameraGlasses})`);
      }
    });

    // DEBUG: Check if modelName.value populates after 10s
    setTimeout(() => {
      const delayedModel = session.device.state.modelName.value;
      console.log(`🧪 [DEBUG] modelName.value after 10s: ${delayedModel ?? 'STILL NULL'} for ${userId}`);
    }, 10000);

    // Play welcome message (with delay for camera-only glasses)
    this.playWelcome(session, user);

    // Notify frontend that glasses session is active
    const hasDisplay = session.capabilities?.hasDisplay ?? false;
    broadcastChatEvent(userId, {
      type: "session_started",
      glassesType: hasDisplay ? "display" : "camera",
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Any AI ready for ${userId}`);
  }

  /**
   * Listen for AI config changes from MentraOS native settings.
   * When the user changes provider, model, API key, etc. in the MentraOS
   * companion app, update the in-memory AI config immediately.
   */
  private setupSettingsListeners(session: AppSession, user: User): void {
    const settingsKeys = [
      'agent_name', 'wake_word',
      'llm_provider', 'llm_model', 'llm_api_key',
      'use_same_for_vision',
      'vision_provider', 'vision_model', 'vision_api_key',
    ];

    for (const key of settingsKeys) {
      session.settings.onValueChange(key, (newValue) => {
        const safeValue = key.includes('api_key') && newValue
          ? `${String(newValue).slice(0, 8)}...`
          : newValue;
        console.log(`⚙️ [SETTINGS] ${key} changed → ${safeValue} for ${user.userId}`);
        user.updateAIConfigFromSettings();
      });
    }
  }

  /**
   * Play the welcome sound/message
   */
  private playWelcome(session: AppSession, user: User): void {
    const hasDisplay = session.capabilities?.hasDisplay ?? false;
    const agentName = user.aiConfig?.agentName ?? "Any AI";
    const wakeWord = user.aiConfig?.wakeWord ?? "Hey Any AI";

    if (hasDisplay) {
      // HUD glasses: show text
      session.layouts.showTextWall(
        `${agentName}\n\nWelcome to ${agentName}.\nSay "${wakeWord}" followed by your question.`,
        { durationMs: 3000 }
      );
    } else {
      // Camera-only glasses: speak welcome message after short delay
      setTimeout(() => {
        session.audio.speak(`Welcome to ${agentName}`).catch((err) => {
          console.debug("Welcome speech failed:", err);
        });
      }, 1000);
    }
  }

  /**
   * Called when a user closes the app or disconnects
   */
  protected async onStop(
    sessionId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    console.log(`👋 Any AI session ended for ${userId}: ${reason}`);

    // Notify frontend BEFORE cleanup — chatClients is independent from sessions
    broadcastChatEvent(userId, {
      type: "session_ended",
      reason,
      timestamp: new Date().toISOString(),
    });

    try {
      sessions.remove(userId);
      console.log(`🗑️ Cleaned up session for ${userId}`);
    } catch (err) {
      console.error(`Error during session cleanup for ${userId}:`, err);
    }
  }
}

/**
 * Create and configure the Any AI server
 */
export async function createMentraAIServer(config: MentraAIConfig): Promise<MentraAI> {
  // DB connection will be handled by Drizzle lazily in Phase 2
  // For now, just create the server
  const server = new MentraAI(config);

  return server;
}
