/**
 * NotificationManager — Phone notification tracking with DB persistence
 *
 * Receives typed PhoneNotification objects from the MentraOS SDK,
 * stores them in-memory (Map) for fast access and persists to the
 * user_context table in Supabase for cross-restart hydration.
 *
 * Data flow:
 *   Phone → SDK onPhoneNotifications → addNotification() → in-memory Map + DB upsert
 *   Phone → SDK onPhoneNotificationDismissed → removeNotification() → Map delete + DB delete
 *   Server restart → initialize() → hydrate from DB → in-memory Map
 */

import type { User } from "../session/User";
import type { PhoneNotification, PhoneNotificationDismissed } from "@mentra/sdk";
import { db, isDbAvailable } from "../db/client";
import { userContext } from "../db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

const CONTEXT_TYPE = "notification";
const NOTIFICATION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_NOTIFICATIONS = 50;

/**
 * Internal storage shape (enriched with receive time and DB row ID)
 */
interface StoredNotification {
  notificationId: string;
  app: string;
  title: string;
  content: string;
  priority: "low" | "normal" | "high";
  receivedAt: number;
  contextId?: string; // user_context row UUID
}

/**
 * NotificationManager — stores and manages typed phone notifications for a single user.
 */
export class NotificationManager {
  /** In-memory cache keyed by notificationId */
  private notifications = new Map<string, StoredNotification>();

  constructor(private user: User) {}

  /**
   * Hydrate in-memory cache from DB on session start.
   * Loads only non-expired notifications for this user.
   */
  async initialize(): Promise<void> {
    if (!isDbAvailable()) return;

    try {
      const rows = await db
        .select()
        .from(userContext)
        .where(
          and(
            eq(userContext.userId, this.user.userId),
            eq(userContext.contextType, CONTEXT_TYPE),
            gte(userContext.expiresAt, new Date()),
          ),
        );

      for (const row of rows) {
        const data = row.data as Record<string, unknown>;
        const stored: StoredNotification = {
          notificationId: data.notificationId as string,
          app: data.app as string,
          title: data.title as string,
          content: data.content as string,
          priority: data.priority as "low" | "normal" | "high",
          receivedAt: data.receivedAt as number,
          contextId: row.id,
        };
        this.notifications.set(stored.notificationId, stored);
      }

      if (this.notifications.size > 0) {
        console.log(`📱 Hydrated ${this.notifications.size} notifications from DB for ${this.user.userId}`);
      }
    } catch (error) {
      console.warn(`Failed to hydrate notifications for ${this.user.userId}:`, error);
    }
  }

  /**
   * Add a notification from SDK push.
   * Writes to in-memory Map + DB upsert.
   */
  async addNotification(notification: PhoneNotification): Promise<void> {
    const stored: StoredNotification = {
      notificationId: notification.notificationId,
      app: notification.app,
      title: notification.title,
      content: notification.content,
      priority: notification.priority,
      receivedAt: Date.now(),
    };

    this.notifications.set(notification.notificationId, stored);
    console.log(`📱 Notification: [${notification.priority}] ${notification.app} — "${notification.title}" for ${this.user.userId} (${this.notifications.size} stored)`);

    // Trim to max size (drop oldest by receivedAt)
    if (this.notifications.size > MAX_NOTIFICATIONS) {
      const sorted = Array.from(this.notifications.entries())
        .sort((a, b) => a[1].receivedAt - b[1].receivedAt);
      const toRemove = sorted.slice(0, this.notifications.size - MAX_NOTIFICATIONS);
      for (const [key] of toRemove) {
        this.notifications.delete(key);
      }
    }

    // Persist to DB
    if (isDbAvailable()) {
      try {
        const [row] = await db
          .insert(userContext)
          .values({
            userId: this.user.userId,
            contextType: CONTEXT_TYPE,
            contextKey: notification.notificationId,
            data: stored,
            expiresAt: new Date(Date.now() + NOTIFICATION_TTL_MS),
          })
          .onConflictDoUpdate({
            target: [userContext.userId, userContext.contextType, userContext.contextKey],
            set: {
              data: stored,
              expiresAt: new Date(Date.now() + NOTIFICATION_TTL_MS),
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: userContext.id });

        stored.contextId = row.id;
        this.notifications.set(notification.notificationId, stored);
      } catch (error) {
        console.warn(`Failed to persist notification for ${this.user.userId}:`, error);
      }
    }
  }

  /**
   * Add multiple notifications at once.
   */
  async addNotifications(notifications: PhoneNotification[]): Promise<void> {
    for (const notification of notifications) {
      await this.addNotification(notification);
    }
  }

  /**
   * Remove a notification when dismissed on the phone.
   * Deletes from in-memory Map + DB.
   */
  async removeNotification(dismissed: PhoneNotificationDismissed): Promise<void> {
    this.notifications.delete(dismissed.notificationId);
    console.log(`📱 Notification dismissed: ${dismissed.app} — "${dismissed.title}" for ${this.user.userId} (${this.notifications.size} remaining)`);

    if (isDbAvailable()) {
      try {
        await db.delete(userContext).where(
          and(
            eq(userContext.userId, this.user.userId),
            eq(userContext.contextType, CONTEXT_TYPE),
            eq(userContext.contextKey, dismissed.notificationId),
          ),
        );
      } catch (error) {
        console.warn(`Failed to delete notification from DB for ${this.user.userId}:`, error);
      }
    }
  }

  /**
   * Get all stored notifications sorted by receivedAt (newest first).
   */
  getRecentNotifications(limit?: number): StoredNotification[] {
    const sorted = Array.from(this.notifications.values())
      .sort((a, b) => b.receivedAt - a.receivedAt);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Format notifications for the AI system prompt.
   * Groups by app, shows title + content + priority + relative time.
   * Returns empty string if no notifications (prompt section omitted).
   */
  formatForPrompt(limit: number = 15): string {
    const recent = this.getRecentNotifications(limit);
    if (recent.length === 0) return "";

    // Group by app
    const grouped = new Map<string, StoredNotification[]>();
    for (const n of recent) {
      const existing = grouped.get(n.app) || [];
      existing.push(n);
      grouped.set(n.app, existing);
    }

    const lines: string[] = ["**Recent Notifications:**"];
    for (const [app, notifications] of grouped) {
      lines.push("");
      lines.push(`${app} (${notifications.length}):`);
      for (const n of notifications) {
        const age = this.formatAge(n.receivedAt);
        const priority = n.priority !== "normal" ? `[${n.priority}] ` : "";
        lines.push(`- ${priority}${n.title}: ${n.content} (${age})`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Format a TTS-friendly spoken readout for the "check notifications" voice command.
   * Groups by app, reads count and highlights the most recent.
   */
  formatNotificationReadout(): string {
    const recent = this.getRecentNotifications();
    if (recent.length === 0) {
      return "You have no recent notifications.";
    }

    // Group by app
    const grouped = new Map<string, StoredNotification[]>();
    for (const n of recent) {
      const existing = grouped.get(n.app) || [];
      existing.push(n);
      grouped.set(n.app, existing);
    }

    const parts: string[] = [];
    const total = recent.length;
    const label = total === 1 ? "1 notification" : `${total} notifications`;
    parts.push(`You have ${label}`);

    // Summarize by app
    const appSummaries: string[] = [];
    for (const [app, notifications] of grouped) {
      appSummaries.push(`${notifications.length} from ${app}`);
    }
    parts.push(appSummaries.join(", and "));

    // Highlight the most recent
    const newest = recent[0];
    if (newest) {
      parts.push(`The most recent is from ${newest.app}: ${newest.title}`);
    }

    return parts.join(". ") + ".";
  }

  /**
   * Get the user_context UUIDs for all stored notifications.
   * Used for traceability on conversation turns.
   */
  getActiveContextIds(): string[] {
    return Array.from(this.notifications.values())
      .map((n) => n.contextId)
      .filter((id): id is string => id !== undefined);
  }

  /**
   * Check if there are any stored notifications.
   */
  hasNotifications(): boolean {
    return this.notifications.size > 0;
  }

  /**
   * Clear in-memory cache.
   */
  destroy(): void {
    this.notifications.clear();
    console.log(`🗑️ NotificationManager cleaned up for ${this.user.userId}`);
  }

  // -- Private helpers --

  /**
   * Format a relative time string (e.g. "2 min ago", "1 hr ago").
   */
  private formatAge(receivedAt: number): string {
    const diffMs = Date.now() - receivedAt;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;

    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr} hr ago`;
  }
}
