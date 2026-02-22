/**
 * CalendarManager — Calendar event tracking with DB persistence
 *
 * Receives calendar events pushed from the phone via MentraOS SDK,
 * stores them in-memory (Map) for fast access and persists to the
 * user_context table in Supabase for cross-restart hydration.
 *
 * Data flow:
 *   Phone → SDK onCalendarEvent → addEvent() → in-memory Map + DB upsert
 *   Server restart → initialize() → hydrate from DB → in-memory Map
 */

import type { User } from "../session/User";
import { db, isDbAvailable } from "../db/client";
import { userContext } from "../db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

const CONTEXT_TYPE = "calendar_event";

/**
 * CalendarEvent shape from the MentraOS SDK.
 * dtStart/dtEnd/timeStamp arrive as strings (epoch ms or ISO) from the SDK.
 */
export interface CalendarEvent {
  eventId: string;
  title: string;
  dtStart: string;
  dtEnd: string;
  timezone: string;
  timeStamp: string;
}

/**
 * Internal storage shape (enriched with receive time)
 */
interface StoredCalendarEvent {
  eventId: string;
  title: string;
  dtStart: number;
  dtEnd: number;
  timezone?: string;
  receivedAt: number;
}

export class CalendarManager {
  /** In-memory cache keyed by eventId */
  private events = new Map<string, StoredCalendarEvent>();

  constructor(private user: User) {}

  /**
   * Hydrate in-memory cache from DB on session start.
   * Loads only non-expired calendar events for this user.
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
        const event: StoredCalendarEvent = {
          eventId: data.eventId as string,
          title: data.title as string,
          dtStart: data.dtStart as number,
          dtEnd: data.dtEnd as number,
          timezone: data.timezone as string | undefined,
          receivedAt: data.receivedAt as number,
        };
        this.events.set(event.eventId, event);
      }

      if (this.events.size > 0) {
        console.log(`📅 Hydrated ${this.events.size} calendar events from DB for ${this.user.userId}`);
      }
    } catch (error) {
      console.warn(`Failed to hydrate calendar events for ${this.user.userId}:`, error);
    }
  }

  /**
   * Add or update a calendar event (from SDK push).
   * Writes to in-memory Map + DB upsert.
   */
  async addEvent(event: CalendarEvent): Promise<void> {
    const dtStart = this.parseEpoch(event.dtStart);
    const dtEnd = this.parseEpoch(event.dtEnd);

    if (!dtStart || !dtEnd) {
      console.warn(`📅 Invalid calendar event dates for "${event.title}" — skipping`);
      return;
    }

    const stored: StoredCalendarEvent = {
      eventId: event.eventId,
      title: event.title,
      dtStart,
      dtEnd,
      timezone: event.timezone || undefined,
      receivedAt: Date.now(),
    };

    this.events.set(event.eventId, stored);
    console.log(`📅 Calendar event: "${event.title}" (${new Date(dtStart).toLocaleString()}) for ${this.user.userId}`);

    // Persist to DB
    if (isDbAvailable()) {
      try {
        await db
          .insert(userContext)
          .values({
            userId: this.user.userId,
            contextType: CONTEXT_TYPE,
            contextKey: event.eventId,
            data: stored,
            expiresAt: new Date(dtEnd),
          })
          .onConflictDoUpdate({
            target: [userContext.userId, userContext.contextType, userContext.contextKey],
            set: {
              data: stored,
              expiresAt: new Date(dtEnd),
              updatedAt: sql`now()`,
            },
          });
      } catch (error) {
        console.warn(`Failed to persist calendar event for ${this.user.userId}:`, error);
      }
    }
  }

  /**
   * Get active (not yet ended) events, sorted by start time.
   */
  getActiveEvents(): StoredCalendarEvent[] {
    const now = Date.now();
    return Array.from(this.events.values())
      .filter((e) => e.dtEnd > now)
      .sort((a, b) => a.dtStart - b.dtStart);
  }

  /**
   * Get all events overlapping today (includes past events from today).
   * Used for the full schedule readout voice command.
   */
  getTodayEvents(): StoredCalendarEvent[] {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

    return Array.from(this.events.values())
      .filter((e) => e.dtStart < endOfDay && e.dtEnd > startOfDay)
      .sort((a, b) => a.dtStart - b.dtStart);
  }

  /**
   * Format upcoming events for injection into the AI system prompt.
   * Returns empty string if no upcoming events.
   */
  formatForPrompt(): string {
    const active = this.getActiveEvents();
    if (active.length === 0) return "";

    const lines = active.map((e) => {
      const start = this.formatTime(e.dtStart, e.timezone);
      const end = this.formatTime(e.dtEnd, e.timezone);
      return `- ${start} - ${end}: ${e.title}`;
    });

    return lines.join("\n");
  }

  /**
   * Format a full schedule readout for the voice command.
   * Returns a spoken-friendly string (no LLM call needed).
   */
  formatScheduleReadout(): string {
    const today = this.getTodayEvents();

    if (today.length === 0) {
      return "You have no events on your schedule today.";
    }

    const now = Date.now();
    const upcoming = today.filter((e) => e.dtEnd > now);
    const past = today.filter((e) => e.dtEnd <= now);

    const parts: string[] = [];

    if (upcoming.length > 0) {
      const label = upcoming.length === 1 ? "1 upcoming event" : `${upcoming.length} upcoming events`;
      parts.push(`You have ${label} today`);

      for (const e of upcoming) {
        const start = this.formatTimeSpoken(e.dtStart, e.timezone);
        const end = this.formatTimeSpoken(e.dtEnd, e.timezone);
        parts.push(`${e.title}, from ${start} to ${end}`);
      }
    } else {
      parts.push("No more events today");
    }

    if (past.length > 0) {
      const pastLabel = past.length === 1 ? "1 event" : `${past.length} events`;
      parts.push(`${pastLabel} already passed`);
    }

    return parts.join(". ") + ".";
  }

  /**
   * Clear in-memory cache.
   */
  destroy(): void {
    this.events.clear();
  }

  // -- Private helpers --

  /**
   * Parse a string epoch ms (or ISO date) to a number.
   * Returns null if unparseable.
   */
  private parseEpoch(value: string): number | null {
    const num = Number(value);
    if (!isNaN(num) && num > 0) return num;
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date.getTime();
  }

  /**
   * Format epoch ms to a concise time string (e.g. "9:00 AM")
   */
  private formatTime(epochMs: number, timezone?: string): string {
    const opts: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    };
    if (timezone) opts.timeZone = timezone;

    try {
      return new Date(epochMs).toLocaleTimeString("en-US", opts);
    } catch {
      return new Date(epochMs).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }

  /**
   * Format epoch ms to a TTS-friendly time string (e.g. "nine AM")
   */
  private formatTimeSpoken(epochMs: number, timezone?: string): string {
    // Use the standard format — TTS formatting is handled downstream
    return this.formatTime(epochMs, timezone);
  }
}
