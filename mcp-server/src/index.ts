#!/usr/bin/env node

/**
 * Mentra Bridge MCP Server — Claude Code ↔ Mentra Smart Glasses.
 *
 * Runs locally via stdio transport. Makes HTTP calls to the
 * Any AI server's bridge API to speak to and listen from
 * the user's smart glasses.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RelayClient } from "./relay-client.js";

// ─── Config ───

const RELAY_URL = process.env.MENTRA_RELAY_URL;
const API_KEY = process.env.MENTRA_RELAY_API_KEY;

if (!RELAY_URL || !API_KEY) {
  console.error(
    "Missing required environment variables: MENTRA_RELAY_URL, MENTRA_RELAY_API_KEY",
  );
  process.exit(1);
}

const client = new RelayClient(RELAY_URL, API_KEY);

// ─── MCP Server ───

const server = new Server(
  { name: "mentra-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ─── Tool Definitions ───

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
            description: "The conversation ID from a previous notify_user or continue_conversation response.",
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
  ],
}));

// ─── Tool Handlers ───

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "pair_mentra": {
        const status = await client.getPairingStatus();
        if (status.paired) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Already paired with ${status.displayName || "a user"}. Ready to use notify_user and speak_to_user.`,
              },
            ],
          };
        }

        const result = await client.generatePairingCode();
        return {
          content: [
            {
              type: "text" as const,
              text: `Pairing code: ${result.code}\n\n${result.instructions}\n\nThe code expires in ${result.expiresInSeconds / 60} minutes.`,
            },
          ],
        };
      }

      case "notify_user": {
        const message = (args as any)?.message as string;
        const timeoutMinutes = (args as any)?.timeout_minutes as number | undefined;
        const timeoutMs = timeoutMinutes ? timeoutMinutes * 60_000 : undefined;

        const result = await client.notify(message, undefined, timeoutMs);

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

      case "continue_conversation": {
        const conversationId = (args as any)?.conversation_id as string;
        const message = (args as any)?.message as string;

        const result = await client.notify(message, conversationId);

        if (result.status === "timeout") {
          return {
            content: [
              {
                type: "text" as const,
                text: `The user didn't respond within the timeout window. The message has been saved.\n\nConversation ID: ${result.conversationId}`,
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

      case "speak_to_user": {
        const message = (args as any)?.message as string;
        const conversationId = (args as any)?.conversation_id as string | undefined;

        await client.speak(message, conversationId);

        return {
          content: [
            {
              type: "text" as const,
              text: "Message delivered and spoken through the glasses.",
            },
          ],
        };
      }

      case "end_conversation": {
        const conversationId = (args as any)?.conversation_id as string;
        const message = (args as any)?.message as string | undefined;

        await client.endConversation(message, conversationId);

        return {
          content: [
            {
              type: "text" as const,
              text: "Conversation ended." + (message ? ` Farewell message delivered: "${message}"` : ""),
            },
          ],
        };
      }

      case "check_pending": {
        const result = await client.checkPending();

        if (result.pending.length === 0 && result.answered.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No pending messages.",
              },
            ],
          };
        }

        const lines: string[] = [];

        if (result.answered.length > 0) {
          lines.push("Answered messages:");
          for (const msg of result.answered) {
            lines.push(
              `- You asked: "${msg.message}" → User replied: "${msg.response}" (at ${msg.respondedAt})`,
            );
          }
        }

        if (result.pending.length > 0) {
          lines.push("\nStill waiting:");
          for (const msg of result.pending) {
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
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mentra Bridge MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
