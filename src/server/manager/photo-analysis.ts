/**
 * Photo Analysis & Tagging — Shared utilities for photo intelligence
 *
 * Provides:
 *   - analyzePhoto(): Vision model analysis of a photo buffer
 *   - generatePhotoTags(): Extract tags from analysis text via LLM
 *   - ensurePhotoAnalyzed(): Recovery/backfill for photos missing analysis or tags
 *   - getRecentPhotosForPrompt(): Query recent photos for system prompt injection
 */

import { generateText } from "ai";
import { resolveVisionModel, resolveLLMModel } from "../agent/providers/registry";
import type { UserAIConfig } from "../agent/providers/types";
import { PHOTO_ANALYSIS_SETTINGS } from "../constants/config";
import { isDbAvailable, db, photos, downloadPhoto } from "../db";
import { eq, desc, and, gte } from "drizzle-orm";

/** Type for recent photo context injected into the system prompt */
export interface RecentPhoto {
  capturedAt: Date;
  tags: string[];
  analysis: string;
  saved: boolean;
}

/**
 * Analyze a photo buffer using the user's configured vision model.
 * Returns the analysis text, or empty string on failure.
 */
export async function analyzePhoto(buffer: Buffer, aiConfig: UserAIConfig): Promise<string> {
  let model;
  try {
    const resolved = resolveVisionModel(aiConfig);
    model = resolved.model;
  } catch (err) {
    console.warn("📸 [ANALYSIS] Failed to resolve vision model:", err);
    return "";
  }

  try {
    const result = await generateText({
      model,
      maxOutputTokens: PHOTO_ANALYSIS_SETTINGS.analysisMaxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PHOTO_ANALYSIS_SETTINGS.analysisPrompt },
            { type: "image", image: buffer },
          ],
        },
      ],
    });

    const text = typeof result.text === "string" ? result.text.trim() : "";
    if (text) {
      console.log(`📸 [ANALYSIS] Photo analyzed (${text.length} chars)`);
    }
    return text;
  } catch (err) {
    console.warn("📸 [ANALYSIS] Vision analysis failed:", err);
    return "";
  }
}

/**
 * Generate tags from analysis text and update the photo row.
 * Follows the same pattern as ExchangeManager.generateTags().
 */
export async function generatePhotoTags(
  photoId: string,
  analysis: string,
  aiConfig: UserAIConfig
): Promise<void> {
  if (!isDbAvailable() || !analysis) return;

  let model;
  try {
    model = resolveLLMModel(aiConfig);
  } catch {
    return;
  }

  try {
    const result = await generateText({
      model,
      maxOutputTokens: PHOTO_ANALYSIS_SETTINGS.tagMaxTokens,
      messages: [
        {
          role: "user",
          content: `Analyze this photo description and return ${PHOTO_ANALYSIS_SETTINGS.minTags}-${PHOTO_ANALYSIS_SETTINGS.maxTags} lowercase topic tags as a JSON array. Tags should capture the key subjects and objects. Return ONLY the JSON array, nothing else.\n\nDescription:\n${analysis}`,
        },
      ],
    });

    const text = result.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return;

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || !parsed.every((t) => typeof t === "string")) return;

    const cleanTags = parsed
      .map((t: string) => t.toLowerCase().trim())
      .filter((t: string) => t.length > 0)
      .slice(0, PHOTO_ANALYSIS_SETTINGS.maxTags);

    if (cleanTags.length === 0) return;

    await db
      .update(photos)
      .set({ tags: cleanTags })
      .where(eq(photos.id, photoId));

    console.log(`🏷️ [PHOTO-TAGS] Tags generated for ${photoId}: [${cleanTags.join(", ")}]`);
  } catch (err) {
    console.warn(`🏷️ [PHOTO-TAGS] Tag generation failed for ${photoId}:`, err);
  }
}

/**
 * Recovery/backfill method for photos missing analysis or tags.
 * Downloads from Storage if needed, runs vision analysis, generates tags.
 */
export async function ensurePhotoAnalyzed(
  photoId: string,
  aiConfig: UserAIConfig
): Promise<void> {
  if (!isDbAvailable() || !aiConfig.isConfigured) return;

  const [row] = await db
    .select({
      id: photos.id,
      storagePath: photos.storagePath,
      analysis: photos.analysis,
      tags: photos.tags,
    })
    .from(photos)
    .where(eq(photos.id, photoId));

  if (!row) return;

  let analysis = row.analysis;

  // Step 1: If analysis is missing, try to recover from Storage
  if (!analysis) {
    if (!row.storagePath) {
      console.warn(`📸 [ENSURE] Photo ${photoId} has no storage path — cannot recover analysis`);
      return;
    }

    try {
      const { buffer } = await downloadPhoto(row.storagePath);
      analysis = await analyzePhoto(buffer, aiConfig);
      if (!analysis) return;

      await db.update(photos).set({ analysis }).where(eq(photos.id, photoId));
      console.log(`📸 [ENSURE] Analysis recovered for ${photoId} (${analysis.length} chars)`);
    } catch (err) {
      console.warn(`📸 [ENSURE] Failed to recover analysis for ${photoId}:`, err);
      return;
    }
  }

  // Step 2: If tags are missing, generate from analysis
  const tags = row.tags ?? [];
  if (tags.length === 0 && analysis) {
    await generatePhotoTags(photoId, analysis, aiConfig);
  }
}

/**
 * Query recent photos for system prompt injection.
 * Returns photos with analysis from the last 24 hours.
 * Fires ensurePhotoAnalyzed() as fire-and-forget for photos missing data.
 */
export async function getRecentPhotosForPrompt(
  userId: string,
  aiConfig?: UserAIConfig
): Promise<RecentPhoto[]> {
  if (!isDbAvailable()) return [];

  const windowStart = new Date(Date.now() - PHOTO_ANALYSIS_SETTINGS.recentPhotosWindowMs);

  const rows = await db
    .select({
      id: photos.id,
      capturedAt: photos.capturedAt,
      tags: photos.tags,
      analysis: photos.analysis,
      saved: photos.saved,
    })
    .from(photos)
    .where(
      and(
        eq(photos.userId, userId),
        gte(photos.capturedAt, windowStart)
      )
    )
    .orderBy(desc(photos.capturedAt))
    .limit(PHOTO_ANALYSIS_SETTINGS.recentPhotosMax);

  const result: RecentPhoto[] = [];

  for (const row of rows) {
    if (row.analysis) {
      // Has analysis — include in results
      const truncated =
        row.analysis.length > PHOTO_ANALYSIS_SETTINGS.analysisTruncateChars
          ? row.analysis.slice(0, PHOTO_ANALYSIS_SETTINGS.analysisTruncateChars - 3) + "..."
          : row.analysis;

      result.push({
        capturedAt: row.capturedAt,
        tags: row.tags ?? [],
        analysis: truncated,
        saved: row.saved,
      });

      // Fire-and-forget tag backfill if tags are missing
      if ((row.tags ?? []).length === 0 && aiConfig?.isConfigured) {
        ensurePhotoAnalyzed(row.id, aiConfig).catch((err) => {
          console.warn(`📸 [RECENT] Tag backfill failed for ${row.id}:`, err);
        });
      }
    } else if (aiConfig?.isConfigured) {
      // Missing analysis — fire-and-forget recovery (available next query)
      ensurePhotoAnalyzed(row.id, aiConfig).catch((err) => {
        console.warn(`📸 [RECENT] Analysis backfill failed for ${row.id}:`, err);
      });
    }
  }

  return result;
}
