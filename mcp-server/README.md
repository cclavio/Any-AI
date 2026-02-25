# Mentra Bridge MCP Server

Connect Claude Code to your Mentra smart glasses. Ask questions, get voice answers.

## Setup

### 1. Install & Build

```bash
cd mcp-server
npm install
npm run build
```

### 2. Generate an API Key

```bash
export MENTRA_RELAY_API_KEY=$(openssl rand -hex 32)
echo $MENTRA_RELAY_API_KEY  # save this
```

### 3. Add to Claude Code

```bash
claude mcp add --transport stdio mentra-bridge -- \
  node /path/to/any-AI/mcp-server/dist/index.js
```

### 4. Set Environment Variables

Add to your shell profile or Claude Code config:

```bash
export MENTRA_RELAY_URL=https://your-any-ai.railway.app
export MENTRA_RELAY_API_KEY=<your-key-from-step-2>
```

### 5. Pair

In Claude Code, say "pair with my glasses" — Claude will use the `pair_mentra` tool to generate a 6-digit code. Enter it in the Mentra app Settings > Claude Bridge.

## Tools

| Tool | Description |
|------|-------------|
| `pair_mentra` | Generate a pairing code (one-time setup) |
| `notify_user` | Ask the user something, wait for voice response |
| `continue_conversation` | Follow-up in the same conversation |
| `speak_to_user` | One-way announcement (no response) |
| `end_conversation` | Close out with optional farewell |
| `check_pending` | Retrieve timed-out messages (last resort) |

## How It Works

1. Claude sends a message via `notify_user`
2. The message is spoken through the glasses and shown on the HUD
3. The user responds by voice
4. If the user is busy, the message is "parked" — they say "I'm ready" when available
5. The response flows back to Claude Code
