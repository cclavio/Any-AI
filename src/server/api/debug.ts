/**
 * Debug API — dev-only endpoints for testing session lifecycle.
 */

import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";
import { broadcastChatEvent } from "./chat";

/**
 * POST /api/debug/kill-session
 *
 * Simulates MentraAI.onStop() — broadcasts session_ended then removes user.
 */
export async function killSession(c: Context) {
  const userId = c.get("authUserId") as string | undefined;
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const user = sessions.get(userId);
  if (!user) return c.json({ error: `No session for ${userId}` }, 404);

  // Same sequence as MentraAI.onStop()
  broadcastChatEvent(userId, {
    type: "session_ended",
    reason: "debug-kill",
    timestamp: new Date().toISOString(),
  });

  sessions.remove(userId);

  return c.json({
    success: true,
    message: `Session killed for ${userId}`,
  });
}
