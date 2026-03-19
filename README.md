# SillyTavern x Woven Imprint

Persistent memory and relationship tracking for SillyTavern characters. Powered by [woven-imprint](https://github.com/virtaava/woven-imprint).

Your characters remember past conversations, form opinions about you, and develop relationships that evolve over time. Come back after days or weeks — they know who you are and what happened.

## How it works

```
SillyTavern (your LLM, your characters)
    │
    ├─ You chat normally — ST handles the LLM as usual
    │
    ├─ UI Extension: records every message to woven-imprint (async, non-blocking)
    │   └─ woven-imprint extracts facts, updates relationships, stores memories
    │
    └─ Before each LLM call: extension queries woven-imprint for relevant memories
        └─ Injects memory context into the prompt (like ST's built-in memory, but persistent)
```

SillyTavern keeps full control of your LLM connection. Woven-imprint runs as a sidecar — it only stores and retrieves memories. No extra LLM calls for generation.

## Prerequisites

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) with server plugins enabled (`enableServerPlugins: true` in `config.yaml`)
- Python 3.11+
- An LLM backend configured in woven-imprint (Ollama, OpenAI, etc.) — used only for fact extraction and relationship assessment, not for chat

```bash
pip install woven-imprint
```

## Install

### 1. Start the sidecar

```bash
woven-imprint sidecar --port 8765
```

Or with a custom database location:

```bash
woven-imprint sidecar --port 8765 --db ~/.woven_imprint/sillytavern.db
```

The sidecar runs on `http://127.0.0.1:8765` and handles all memory operations.

### 2. Install the server plugin

Copy the `plugin/` directory into SillyTavern's plugins folder:

```bash
cp -r plugin/ /path/to/SillyTavern/plugins/sillytavern-woven-imprint/
```

### 3. Install the UI extension

**Option A: Install from URL** (recommended)

In SillyTavern, go to Extensions > Install Extension, paste:
```
https://github.com/virtaava/sillytavern-woven-imprint
```

**Option B: Manual install**

Copy the `extension/` directory:
```bash
cp -r extension/ /path/to/SillyTavern/data/default-user/extensions/woven-imprint/
```

### 4. Restart SillyTavern

Restart ST. You should see "Woven Imprint" in the Extensions panel with a green "Connected" indicator.

## Configuration

In SillyTavern's Extensions panel:

| Setting | Default | Description |
|---------|---------|-------------|
| Enable | On | Toggle persistent memory on/off |
| Injection depth | 4 | How deep in the chat history to inject memories (lower = closer to latest message) |
| Max memories | 5 | Maximum number of memories to inject per generation |

Environment variables for the sidecar:

| Variable | Default | Description |
|----------|---------|-------------|
| `WOVEN_IMPRINT_SIDECAR_PORT` | 8765 | Sidecar port |
| `WOVEN_IMPRINT_MODEL` | llama3.2 | LLM for fact extraction |
| `WOVEN_IMPRINT_LLM_PROVIDER` | ollama | LLM provider |

## What gets tracked

For each character you chat with, woven-imprint automatically:

- **Extracts facts** from conversation (key events, preferences, promises)
- **Tracks relationships** (trust, affection, respect, familiarity, tension)
- **Stores memories** with importance scoring and decay
- **Consolidates** over time (buffer → core → bedrock memory tiers)

All data lives in a local SQLite database. Nothing leaves your machine.

## Troubleshooting

**"Sidecar not reachable"** — Make sure the sidecar is running: `woven-imprint sidecar --port 8765`

**No memory injection happening** — Check that:
1. The extension is enabled in ST's Extensions panel
2. Server plugins are enabled in ST's `config.yaml`
3. The sidecar shows requests in its logs

**Characters not being created** — The extension auto-creates a woven-imprint character the first time you chat with an ST character. Check sidecar logs for errors.

## License

Apache 2.0
