/**
 * Thinking Tool
 *
 * Allows the agent to "think out loud" about complex problems.
 * The thought is logged but not returned to the user.
 */

import { tool } from "ai";
import { z } from "zod";

export const thinkingTool = tool({
  description: "Think through a problem step by step. Use this to reason about complex questions before answering.",
  inputSchema: z.object({
    thought: z.string().describe("Your reasoning process or step-by-step thinking"),
  }),
  execute: async ({ thought }) => {
    // Log the thought for debugging/transparency
    console.log(`💭 [Thinking] ${thought}`);

    return { acknowledged: true };
  },
});
