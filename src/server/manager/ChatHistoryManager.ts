/**
 * ChatHistoryManager - Conversation history with Drizzle persistence
 *
 * Features:
 * - In-memory cache of recent conversation turns (for agent context)
 * - Drizzle persistence to Supabase Postgres (for cross-session history)
 * - Photo data URLs stored alongside turns for frontend sync
 * - Configurable history window
 *
 * Falls back to in-memory only when DATABASE_URL is not configured.
 */

import type { User } from "../session/User";
import { CONVERSATION_SETTINGS } from "../constants/config";
import { db, isDbAvailable } from "../db/client";
import { conversations, conversationTurns } from "../db/schema";
import { eq, and } from "drizzle-orm";

/**
 * A conversation turn for context
 */
export interface ConversationTurn {
  query: string;
  response: string;
  timestamp: Date;
  hadPhoto: boolean;
  photoDataUrl?: string;
  photoId?: string;
}

/**
 * ChatHistoryManager — manages conversation history for a single user.
 * Persists to Supabase Postgres via Drizzle when available, falls back to in-memory.
 */
export class ChatHistoryManager {
  // In-memory store of recent turns
  private recentTurns: ConversationTurn[] = [];

  constructor(private user: User) {}

  /**
   * Initialize the manager — hydrate in-memory cache from today's DB history
   */
  async initialize(): Promise<void> {
    if (!isDbAvailable()) return;

    try {
      const todaysTurns = await this.getHistoryByDate(new Date());
      if (todaysTurns.length > 0) {
        this.recentTurns = todaysTurns.slice(-CONVERSATION_SETTINGS.maxTurns);
        console.log(`📜 Loaded ${this.recentTurns.length} conversation turns from DB`);
      }
    } catch (error) {
      console.warn("Failed to load conversation history from DB:", error);
    }
  }

  /**
   * Add a conversation turn — writes to both memory and DB
   */
  async addTurn(query: string, response: string, hadPhoto: boolean = false, photoDataUrl?: string, photoId?: string): Promise<void> {
    const turn: ConversationTurn = {
      query,
      response,
      timestamp: new Date(),
      hadPhoto,
      photoDataUrl,
      photoId,
    };

    this.recentTurns.push(turn);

    // Trim to max turns
    if (this.recentTurns.length > CONVERSATION_SETTINGS.maxTurns) {
      this.recentTurns = this.recentTurns.slice(-CONVERSATION_SETTINGS.maxTurns);
    }

    // Persist to DB if available
    if (isDbAvailable()) {
      try {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        let [convo] = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.userId, this.user.userId), eq(conversations.date, today)));

        if (!convo) {
          [convo] = await db
            .insert(conversations)
            .values({ userId: this.user.userId, date: today })
            .returning();
        }

        await db.insert(conversationTurns).values({
          conversationId: convo.id,
          query,
          response,
          hadPhoto,
          photoId,
        });
      } catch (error) {
        console.error("Failed to persist conversation turn:", error);
        // In-memory turn was already added — don't throw
      }
    }
  }

  /**
   * Get recent turns for context
   * Filters by age and returns up to maxTurns
   */
  getRecentTurns(limit?: number): ConversationTurn[] {
    const now = Date.now();
    const maxAge = CONVERSATION_SETTINGS.maxAgeMs;
    const maxTurns = limit ?? CONVERSATION_SETTINGS.maxTurns;

    // Filter by age
    const recent = this.recentTurns.filter(turn => {
      const age = now - turn.timestamp.getTime();
      return age < maxAge;
    });

    // Return most recent
    return recent.slice(-maxTurns);
  }

  /**
   * Format conversation history for the prompt
   */
  formatForPrompt(limit?: number): string {
    const turns = this.getRecentTurns(limit);

    if (turns.length === 0) {
      return "";
    }

    const formatted = turns.map(turn => {
      const photoNote = turn.hadPhoto ? " (with photo)" : "";
      return `User${photoNote}: ${turn.query}\nAssistant: ${turn.response}`;
    }).join("\n\n");

    return `## Previous Conversation\n\n${formatted}`;
  }

  /**
   * Get conversation history by date from DB
   */
  async getHistoryByDate(_date: Date): Promise<ConversationTurn[]> {
    if (!isDbAvailable()) return [];

    try {
      const dateStr = _date.toISOString().split("T")[0];
      const [convo] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.userId, this.user.userId), eq(conversations.date, dateStr)));

      if (!convo) return [];

      const turns = await db
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.conversationId, convo.id))
        .orderBy(conversationTurns.timestamp);

      return turns.map(t => ({
        query: t.query,
        response: t.response,
        timestamp: t.timestamp,
        hadPhoto: t.hadPhoto,
        photoId: t.photoId ?? undefined,
      }));
    } catch (error) {
      console.error("Failed to fetch history by date:", error);
      return [];
    }
  }

  /**
   * Clear today's conversation
   */
  async clearToday(): Promise<void> {
    this.recentTurns = [];
  }

  /**
   * Clear all conversation history
   */
  async clearAll(): Promise<void> {
    this.recentTurns = [];
  }

  /**
   * Update chat history enabled setting (in-memory flag only)
   */
  async setChatHistoryEnabled(_enabled: boolean): Promise<void> {
    // Persisted via user_settings table — this is a no-op here
  }

  /**
   * Check if chat history is enabled
   */
  isChatHistoryEnabled(): boolean {
    return false;
  }

  /**
   * Clean up (called on session end)
   */
  destroy(): void {
    this.recentTurns = [];
  }
}
