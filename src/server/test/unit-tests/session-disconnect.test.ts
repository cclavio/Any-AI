/**
 * Test: Kill Session via API
 *
 * Calls POST /api/debug/kill-session against the running dev server.
 * Assumes the dev server is running (bun run dev) and the user is logged in.
 *
 * Run: bun run test:disconnect
 */

import { describe, test, expect } from "bun:test";

const BASE_URL = "http://localhost:3000";
const USER_ID = "fparyan28@gmail.com";

describe("kill session via API", () => {
  test(`kills session for ${USER_ID}`, async () => {
    const res = await fetch(`${BASE_URL}/api/debug/kill-session?userId=${encodeURIComponent(USER_ID)}`, {
      method: "POST",
    });

    const data = await res.json();
    console.log(`Status: ${res.status}`, data);

    // 200 = session existed and was killed
    // 404 = no session for this user (glasses not connected)
    expect([200, 404]).toContain(res.status);

    if (res.status === 200) {
      expect(data.success).toBe(true);
      console.log("Session killed successfully");
    } else {
      console.log("No active session to kill (glasses not connected)");
    }
  });
});
