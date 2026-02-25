/**
 * Hosted MCP server — Claude Code connects directly via Streamable HTTP.
 *
 * Replaces the local stdio MCP server for users who don't want to run
 * anything locally. Tool handlers call BridgeManager directly (no HTTP hop).
 *
 * Mount at /mcp on the main Hono router, before SDK auth middleware.
 */

import { Hono } from "hono";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { eq, and, inArray } from "drizzle-orm";
import { hashApiKey } from "./bridge-auth";
import { sessions } from "../manager/SessionManager";
import { db } from "../db/client";
import { claudeMentraPairs, pairingCodes, bridgeRequests } from "../db/schema";

// ─── Session State ───

/** Active transports keyed by MCP session ID */
const mcpTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();

// ─── Tool Definitions ───

const TOOL_DEFINITIONS = [
  {
    name: "pair_mentra",
    description:
      "Generate a 6-digit pairing code to link Claude Code with the user's Mentra smart glasses. " +
      "The user enters this code in their glasses app Settings. Only needed once — after pairing, " +
      "use notify_user and speak_to_user to communicate through the glasses.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "notify_user",
    description:
      "Send a message to the user through their Mentra smart glasses and wait for their voice response. " +
      "The message is spoken aloud and shown on the glasses HUD. Keep messages concise — the user is listening, not reading. " +
      "If the user is busy, the message is 'parked' and they can respond later by saying 'I'm ready'. " +
      "This tool may take a while to return — the user will respond when they're ready. Wait patiently. " +
      "If the full timeout expires, the tool returns status 'timeout' — use check_pending later if you need the answer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description:
            "The message to speak to the user. Keep it conversational and concise — it's spoken aloud.",
        },
        timeout_minutes: {
          type: "number",
          description:
            "How long to wait for a response (default: 10 minutes). The user can respond at any time during this window.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "continue_conversation",
    description:
      "Follow-up question in an ongoing conversation. Uses the same conversation context. " +
      "Same behavior as notify_user but carries the conversation_id forward.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation_id: {
          type: "string",
          description:
            "The conversation ID from a previous notify_user or continue_conversation response.",
        },
        message: {
          type: "string",
          description: "Follow-up message to speak to the user.",
        },
      },
      required: ["conversation_id", "message"],
    },
  },
  {
    name: "speak_to_user",
    description:
      "Send a one-way announcement to the user through their glasses. No response is collected. " +
      "Use this for status updates, acknowledgments, or when you don't need an answer. " +
      "Returns immediately after the message is spoken.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation_id: {
          type: "string",
          description: "Optional conversation ID for context.",
        },
        message: {
          type: "string",
          description: "The announcement to speak. Keep it brief.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "end_conversation",
    description:
      "Close out a conversation with an optional farewell message. " +
      "Always call this when you're done communicating through the glasses.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation_id: {
          type: "string",
          description: "The conversation ID to end.",
        },
        message: {
          type: "string",
          description: "Optional farewell message to speak.",
        },
      },
      required: ["conversation_id"],
    },
  },
  {
    name: "check_pending",
    description:
      "Check if any timed-out messages have been answered by the user. " +
      "This is a last resort — only use after notify_user returned status 'timeout'. " +
      "Do not poll this routinely. Most requests resolve inline via park-and-wait.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ─── MCP Server Factory ───

/**
 * Creates an MCP Server with all bridge tools wired to call
 * BridgeManager directly via the apiKeyHash closure.
 */
function createMcpServer(apiKeyHash: string): Server {
  const server = new Server(
    { name: "mentra-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // ── Pairing ──
        case "pair_mentra": {
          const [existing] = await db
            .select()
            .from(claudeMentraPairs)
            .where(eq(claudeMentraPairs.apiKeyHash, apiKeyHash))
            .limit(1);

          if (existing) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Already paired with ${existing.displayName || "a user"}. Ready to use notify_user and speak_to_user.`,
                },
              ],
            };
          }

          // Generate 6-digit code
          let code: string;
          let attempts = 0;
          do {
            code = Math.random().toString().slice(2, 8).padStart(6, "0");
            const [collision] = await db
              .select()
              .from(pairingCodes)
              .where(eq(pairingCodes.code, code))
              .limit(1);
            if (!collision) break;
            attempts++;
          } while (attempts < 10);

          await db
            .delete(pairingCodes)
            .where(eq(pairingCodes.apiKeyHash, apiKeyHash));

          const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
          await db.insert(pairingCodes).values({ code, apiKeyHash, expiresAt });

          return {
            content: [
              {
                type: "text" as const,
                text: `Pairing code: ${code}\n\nEnter this code in your Mentra glasses app Settings → Claude Bridge to complete pairing.\n\nThe code expires in 10 minutes.`,
              },
            ],
          };
        }

        // ── Notify / Continue ──
        case "notify_user":
        case "continue_conversation": {
          const message = (args as any)?.message as string;
          if (!message?.trim()) {
            return {
              content: [
                { type: "text" as const, text: "Message is required." },
              ],
              isError: true,
            };
          }

          const [pair] = await db
            .select()
            .from(claudeMentraPairs)
            .where(eq(claudeMentraPairs.apiKeyHash, apiKeyHash))
            .limit(1);

          if (!pair) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Not paired. Use pair_mentra tool first.",
                },
              ],
            };
          }

          const user = sessions.get(pair.mentraUserId);
          if (!user?.appSession) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Glasses offline. The user's smart glasses are not connected.",
                },
              ],
            };
          }

          const timeoutMinutes = (args as any)?.timeout_minutes as
            | number
            | undefined;
          const timeoutMs = timeoutMinutes ? timeoutMinutes * 60_000 : 600_000;
          const requestId = crypto.randomUUID();

          const result = await user.bridge.handleNotify(
            message,
            requestId,
            timeoutMs,
          );

          // Enrich DB log with apiKeyHash
          db.update(bridgeRequests)
            .set({ apiKeyHash })
            .where(eq(bridgeRequests.id, requestId))
            .catch(() => {});

          if (result.status === "timeout") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `The user didn't respond within the timeout window. The message has been saved — they may respond later. Use check_pending if you need the answer.\n\nConversation ID: ${result.conversationId}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `User responded: "${result.transcript}"\n\nConversation ID: ${result.conversationId}`,
              },
            ],
          };
        }

        // ── Speak (fire-and-forget) ──
        case "speak_to_user": {
          const message = (args as any)?.message as string;
          if (!message?.trim()) {
            return {
              content: [
                { type: "text" as const, text: "Message is required." },
              ],
              isError: true,
            };
          }

          const [pair] = await db
            .select()
            .from(claudeMentraPairs)
            .where(eq(claudeMentraPairs.apiKeyHash, apiKeyHash))
            .limit(1);

          if (!pair) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Not paired. Use pair_mentra tool first.",
                },
              ],
            };
          }

          const user = sessions.get(pair.mentraUserId);
          if (!user?.appSession) {
            return {
              content: [
                { type: "text" as const, text: "Glasses offline." },
              ],
            };
          }

          await user.bridge.handleSpeak(message);

          const conversationId = (args as any)?.conversation_id as
            | string
            | undefined;
          db.insert(bridgeRequests)
            .values({
              apiKeyHash,
              mentraUserId: pair.mentraUserId,
              conversationId: conversationId ?? null,
              message,
              status: "responded",
              respondedAt: new Date(),
            })
            .catch(() => {});

          return {
            content: [
              {
                type: "text" as const,
                text: "Message delivered and spoken through the glasses.",
              },
            ],
          };
        }

        // ── End Conversation ──
        case "end_conversation": {
          const farewell = (args as any)?.message as string | undefined;

          const [pair] = await db
            .select()
            .from(claudeMentraPairs)
            .where(eq(claudeMentraPairs.apiKeyHash, apiKeyHash))
            .limit(1);

          let delivered = false;
          if (pair) {
            const user = sessions.get(pair.mentraUserId);
            if (user) {
              delivered = await user.bridge.handleEnd(farewell).catch(() => false);
            }
          }

          const status = farewell
            ? (delivered ? `Farewell delivered: "${farewell}"` : `Farewell failed to deliver (glasses may be busy).`)
            : "";

          return {
            content: [
              {
                type: "text" as const,
                text: "Conversation ended." + (status ? ` ${status}` : ""),
              },
            ],
          };
        }

        // ── Check Pending ──
        case "check_pending": {
          const rows = await db
            .select()
            .from(bridgeRequests)
            .where(
              and(
                eq(bridgeRequests.apiKeyHash, apiKeyHash),
                inArray(bridgeRequests.status, [
                  "timeout",
                  "timeout_responded",
                ]),
              ),
            );

          const pending = rows
            .filter((r) => r.status === "timeout")
            .map((r) => ({
              requestId: r.id,
              message: r.message,
              deferredAt: r.createdAt.toISOString(),
            }));

          const answered = rows
            .filter((r) => r.status === "timeout_responded")
            .map((r) => ({
              requestId: r.id,
              message: r.message,
              response: r.response ?? undefined,
              deferredAt: r.createdAt.toISOString(),
              respondedAt: r.respondedAt?.toISOString(),
            }));

          // Mark answered as consumed
          const answeredIds = answered.map((a) => a.requestId);
          if (answeredIds.length > 0) {
            db.update(bridgeRequests)
              .set({ status: "consumed" })
              .where(inArray(bridgeRequests.id, answeredIds))
              .catch(() => {});
          }

          if (pending.length === 0 && answered.length === 0) {
            return {
              content: [
                { type: "text" as const, text: "No pending messages." },
              ],
            };
          }

          const lines: string[] = [];
          if (answered.length > 0) {
            lines.push("Answered messages:");
            for (const msg of answered) {
              lines.push(
                `- You asked: "${msg.message}" → User replied: "${msg.response}" (at ${msg.respondedAt})`,
              );
            }
          }
          if (pending.length > 0) {
            lines.push("\nStill waiting:");
            for (const msg of pending) {
              lines.push(`- "${msg.message}" (sent ${msg.deferredAt})`);
            }
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        }

        default:
          return {
            content: [
              { type: "text" as const, text: `Unknown tool: ${name}` },
            ],
            isError: true,
          };
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Hono Router ───

export const mcpApp = new Hono();

// Handle OAuth discovery/auth requests — our server uses API key auth, not OAuth.
// Return proper JSON errors so Claude Code doesn't choke on plain-text 404s.
mcpApp.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json({ error: "This MCP server uses API key authentication, not OAuth. The key is in the URL." }, 404);
});
mcpApp.all("/oauth/*", (c) => {
  return c.json({ error: "This MCP server uses API key authentication, not OAuth. The key is in the URL." }, 404);
});

mcpApp.all("/", async (c) => {
  // Extract API key from Authorization header or query parameter
  let apiKey: string | undefined;
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7);
  }
  if (!apiKey) {
    apiKey = c.req.query("key") ?? undefined;
  }

  const sessionId = c.req.header("mcp-session-id");

  // Route to existing session
  if (sessionId && mcpTransports.has(sessionId)) {
    return mcpTransports.get(sessionId)!.handleRequest(c.req.raw);
  }

  // Session ID provided but not found — expired after deploy.
  // MCP protocol requires an initialization handshake, so we can't transparently
  // bootstrap a new session from a tool call. Return 404 to signal the client
  // to re-initialize.
  if (sessionId) {
    console.log(`📬 [MCP] Stale session ${sessionId} — requesting client re-init`);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Session expired. Please reconnect.",
        },
        id: null,
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // New session — API key required
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "API key required. Pass via Authorization: Bearer <key> or ?key=<key>",
        },
        id: null,
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const apiKeyHash = hashApiKey(apiKey);

  // Create transport + server
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sid: string) => {
      mcpTransports.set(sid, transport);
      console.log(`📬 [MCP] Session initialized: ${sid}`);
    },
  });

  const server = createMcpServer(apiKeyHash);
  await server.connect(transport);

  transport.onclose = () => {
    if (transport.sessionId) {
      mcpTransports.delete(transport.sessionId);
      console.log(`📬 [MCP] Session closed: ${transport.sessionId}`);
    }
  };

  return transport.handleRequest(c.req.raw);
});
