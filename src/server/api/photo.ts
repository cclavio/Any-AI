import type { Context } from "hono";
import { eq, desc } from "drizzle-orm";
import { sessions } from "../manager/SessionManager";
import { isDbAvailable, db, photos } from "../db";
import { isStorageAvailable, downloadPhoto } from "../db/storage";

/** GET /latest-photo — metadata for the most recent photo */
export function getLatestPhoto(c: Context) {
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const user = sessions.get(userId);
  if (!user) return c.json({ error: "No photos available for this user" }, 404);

  const photos = user.photo.getAll();
  if (photos.length === 0) {
    return c.json({ error: "No photos available for this user" }, 404);
  }

  const latest = photos[0];
  return c.json({
    requestId: latest.requestId,
    timestamp: latest.timestamp.getTime(),
    userId: latest.userId,
    hasPhoto: true,
  });
}

/** GET /photo/:requestId — raw photo image data */
export async function getPhotoData(c: Context) {
  const requestId = c.req.param("requestId");
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  // Try in-memory first
  const user = sessions.get(userId);
  const photo = user?.photo.getPhoto(requestId);
  if (photo) {
    if (photo.userId !== userId) {
      return c.json({ error: "Access denied: photo belongs to different user" }, 403);
    }
    return new Response(new Uint8Array(photo.buffer), {
      headers: { "Content-Type": photo.mimeType, "Cache-Control": "no-cache" },
    });
  }

  // Fallback to DB + Storage
  if (isDbAvailable() && isStorageAvailable()) {
    const [row] = await db
      .select()
      .from(photos)
      .where(eq(photos.requestId, requestId))
      .limit(1);

    if (row && row.userId === userId) {
      const { buffer, contentType } = await downloadPhoto(row.storagePath);
      return new Response(new Uint8Array(buffer), {
        headers: { "Content-Type": contentType, "Cache-Control": "no-cache" },
      });
    }
    if (row && row.userId !== userId) {
      return c.json({ error: "Access denied: photo belongs to different user" }, 403);
    }
  }

  return c.json({ error: "Photo not found" }, 404);
}

/** GET /photo-base64/:requestId — photo as base64 JSON */
export async function getPhotoBase64(c: Context) {
  const requestId = c.req.param("requestId");
  const userId = c.get("authUserId") as string | undefined;

  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  // Try in-memory first
  const user = sessions.get(userId);
  const photo = user?.photo.getPhoto(requestId);
  if (photo) {
    if (photo.userId !== userId) {
      return c.json({ error: "Access denied: photo belongs to different user" }, 403);
    }
    const base64Data = photo.buffer.toString("base64");
    return c.json({
      requestId: photo.requestId,
      timestamp: photo.timestamp.getTime(),
      mimeType: photo.mimeType,
      filename: photo.filename,
      size: photo.size,
      userId: photo.userId,
      base64: base64Data,
      dataUrl: `data:${photo.mimeType};base64,${base64Data}`,
    });
  }

  // Fallback to DB + Storage
  if (isDbAvailable() && isStorageAvailable()) {
    const [row] = await db
      .select()
      .from(photos)
      .where(eq(photos.requestId, requestId))
      .limit(1);

    if (row && row.userId === userId) {
      const { buffer } = await downloadPhoto(row.storagePath);
      const base64Data = buffer.toString("base64");
      return c.json({
        requestId: row.requestId,
        timestamp: row.capturedAt.getTime(),
        mimeType: row.mimeType,
        filename: row.filename,
        size: row.sizeBytes,
        userId: row.userId,
        base64: base64Data,
        dataUrl: `data:${row.mimeType};base64,${base64Data}`,
      });
    }
    if (row && row.userId !== userId) {
      return c.json({ error: "Access denied: photo belongs to different user" }, 403);
    }
  }

  return c.json({ error: "Photo not found" }, 404);
}

/** GET /photos — paginated photo metadata from DB */
export async function listPhotos(c: Context) {
  const userId = c.get("authUserId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  if (!isDbAvailable()) return c.json({ error: "Database not available" }, 503);

  const limit = Math.min(Number(c.req.query("limit")) || 20, 100);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const rows = await db
    .select({
      id: photos.id,
      requestId: photos.requestId,
      filename: photos.filename,
      mimeType: photos.mimeType,
      sizeBytes: photos.sizeBytes,
      capturedAt: photos.capturedAt,
      createdAt: photos.createdAt,
    })
    .from(photos)
    .where(eq(photos.userId, userId))
    .orderBy(desc(photos.capturedAt))
    .limit(limit)
    .offset(offset);

  return c.json({ photos: rows, limit, offset });
}
