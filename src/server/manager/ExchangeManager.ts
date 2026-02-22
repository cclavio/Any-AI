/**
 * ExchangeManager — Exchange lifecycle and tag generation
 *
 * Manages the concept of an "exchange" — a group of conversation turns
 * between wake word activation and exchange end (closer, timeout, disconnect).
 *
 * After an exchange ends, generates topic tags via a lightweight LLM call
 * for fast future reference and context grouping.
 */

import type { User } from "../session/User";
import { db, isDbAvailable } from "../db/client";
import { exchanges } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateText } from "ai";
import { resolveLLMModel } from "../agent/providers/registry";
import { EXCHANGE_SETTINGS } from "../constants/config";

export type EndReason = "closer_gratitude" | "closer_dismissal" | "follow_up_timeout" | "session_disconnect";

interface BufferedTurn {
  query: string;
  response: string;
}

export class ExchangeManager {
  private currentExchangeId: string | null = null;
  private turnBuffer: BufferedTurn[] = [];

  constructor(private user: User) {}

  /**
   * Start a new exchange — inserts a row and stores the UUID.
   */
  async startExchange(): Promise<void> {
    if (!isDbAvailable()) return;

    try {
      const [row] = await db
        .insert(exchanges)
        .values({ userId: this.user.userId })
        .returning({ id: exchanges.id });

      this.currentExchangeId = row.id;
      this.turnBuffer = [];
      console.log(`🔄 Exchange started: ${row.id} for ${this.user.userId}`);
    } catch (error) {
      console.error(`Failed to start exchange for ${this.user.userId}:`, error);
    }
  }

  /**
   * Get the current exchange ID (used by ChatHistoryManager when persisting turns).
   */
  getCurrentExchangeId(): string | null {
    return this.currentExchangeId;
  }

  /**
   * Whether an exchange is currently active.
   */
  isActive(): boolean {
    return this.currentExchangeId !== null;
  }

  /**
   * Buffer a turn for tag generation (called after DB persist in ChatHistoryManager).
   */
  recordTurn(query: string, response: string): void {
    if (!this.currentExchangeId) return;
    this.turnBuffer.push({ query, response });
  }

  /**
   * End the current exchange — sets ended_at, end_reason, and triggers async tag generation.
   */
  async endExchange(reason: EndReason): Promise<void> {
    const exchangeId = this.currentExchangeId;
    if (!exchangeId || !isDbAvailable()) {
      this.currentExchangeId = null;
      this.turnBuffer = [];
      return;
    }

    try {
      await db
        .update(exchanges)
        .set({
          endedAt: new Date(),
          endReason: reason,
        })
        .where(eq(exchanges.id, exchangeId));

      console.log(`🔄 Exchange ended: ${exchangeId} reason=${reason} turns=${this.turnBuffer.length}`);
    } catch (error) {
      console.error(`Failed to end exchange ${exchangeId}:`, error);
    }

    // Fire-and-forget tag generation if we had turns
    const turns = [...this.turnBuffer];
    if (turns.length > 0) {
      this.generateTags(exchangeId, turns).catch((err) => {
        console.warn(`Tag generation failed for exchange ${exchangeId}:`, err);
      });
    }

    this.currentExchangeId = null;
    this.turnBuffer = [];
  }

  /**
   * Generate topic tags for a completed exchange via lightweight LLM call.
   */
  private async generateTags(exchangeId: string, turns: BufferedTurn[]): Promise<void> {
    const aiConfig = this.user.aiConfig;
    if (!aiConfig?.isConfigured) return;

    let model;
    try {
      model = resolveLLMModel(aiConfig);
    } catch {
      return; // Can't resolve model — skip tagging
    }

    const conversation = turns
      .map((t) => `User: ${t.query}\nAssistant: ${t.response}`)
      .join("\n\n");

    try {
      const result = await generateText({
        model,
        maxOutputTokens: EXCHANGE_SETTINGS.tagMaxTokens,
        messages: [
          {
            role: "user",
            content: `Analyze this conversation and return ${EXCHANGE_SETTINGS.minTags}-${EXCHANGE_SETTINGS.maxTags} lowercase topic tags as a JSON array. Tags should capture the key subjects discussed. Return ONLY the JSON array, nothing else.\n\nConversation:\n${conversation}`,
          },
        ],
      });

      const text = result.text.trim();
      // Extract JSON array from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) return;

      const tags: unknown = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) return;

      const cleanTags = tags
        .map((t: string) => t.toLowerCase().trim())
        .filter((t: string) => t.length > 0)
        .slice(0, EXCHANGE_SETTINGS.maxTags);

      if (cleanTags.length === 0) return;

      await db
        .update(exchanges)
        .set({ tags: cleanTags })
        .where(eq(exchanges.id, exchangeId));

      console.log(`🏷️ Tags generated for exchange ${exchangeId}: [${cleanTags.join(", ")}]`);
    } catch (error) {
      console.warn(`Tag generation LLM call failed for exchange ${exchangeId}:`, error);
    }
  }

  /**
   * Destroy — end any active exchange on session cleanup.
   */
  async destroy(): Promise<void> {
    if (this.isActive()) {
      await this.endExchange("session_disconnect");
    }
  }
}
