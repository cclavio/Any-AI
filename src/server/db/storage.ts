/**
 * Supabase Storage Integration — Photo bucket operations
 *
 * Lazy-initializes a Supabase client on first use.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "photos";

let supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  supabase = createClient(url, key);
  return supabase;
}

/** Check if Supabase Storage is available (env vars set). */
export function isStorageAvailable(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Build a deterministic storage path for a photo.
 * Format: {userId}/{epochMs}-{requestId}.{ext}
 */
export function buildStoragePath(
  userId: string,
  requestId: string,
  capturedAt: Date,
  mimeType: string
): string {
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `${userId}/${capturedAt.getTime()}-${requestId}.${ext}`;
}

/** Upload a photo buffer to the storage bucket. */
export async function uploadPhoto(
  storagePath: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  const client = getClient();
  if (!client) throw new Error("Supabase Storage not available");

  const { error } = await client.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) throw error;
}

/** Download a photo from the storage bucket. */
export async function downloadPhoto(
  storagePath: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const client = getClient();
  if (!client) throw new Error("Supabase Storage not available");

  const { data, error } = await client.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) throw error ?? new Error("Download returned no data");

  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: data.type || "image/jpeg",
  };
}

/** Delete a photo from the storage bucket. */
export async function deletePhoto(storagePath: string): Promise<void> {
  const client = getClient();
  if (!client) throw new Error("Supabase Storage not available");

  const { error } = await client.storage
    .from(BUCKET)
    .remove([storagePath]);

  if (error) throw error;
}
