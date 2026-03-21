# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# One-time setup
git config core.hooksPath .githooks
pip install -e ".[dev]"
npm install

# Format
ruff format .                        # Python
npx prettier --write "extension/**/*.js"  # JS

# Lint
ruff check src/ tests/               # Python
npx eslint extension                 # JS

# Run backend
lactor serve --port 7890 --extension-id <id>
lactor serve --port 7890 --dev   # skip origin checks

# Tests (Python)
LACTOR_MOCK_TTS=1 pytest            # all tests (mock TTS, no network)
LACTOR_MOCK_TTS=1 pytest tests/test_ws_handler.py  # single file

# Tests (JS)
node --test extension/reader/components/*.test.js
```

## Architecture

Lactor is two separate components that communicate over a local WebSocket:

### Python Backend (`src/lactor/`)
- `main.py` — FastAPI app factory + CLI. Origin enforcement via `OriginMiddleware` (HTTP) and `check_ws_origin` (WS). Requires `--extension-id` in production to allowlist `moz-extension://` and `chrome-extension://` origins; `--dev` bypasses all origin checks.
- `ws_handler.py` — single persistent WebSocket per tab. Handles `speak` / `cancel` actions, serializes concurrent paragraph requests by cancelling the in-flight task before starting a new one.
- `tts.py` — wraps `edge-tts`. Yields `{"type": "audio"|"word"|"done"}` events. `LACTOR_MOCK_TTS=1` activates a deterministic mock (no network) for tests.

### Browser Extension (`extension/`)
- `background.js` — service worker. Maintains **two** parallel WebSocket connections to the backend per tab (via Port API proxy, port name `lactor-tts`). Two connections allow simultaneous prefetch and playback without head-of-line blocking.
- `content/extractor.js` + `overlay.js` — injected into the active tab. Extractor uses Defuddle to parse article content and sends it to the background via `browser.runtime.sendMessage`.
- `reader/reader.js` — loaded in an iframe/tab. Orchestrates playback: fetches buffered audio via the background port, feeds `Player`, drives `HighlightEngine`, and uses `PrefetchScheduler` to look ahead.
- `reader/components/` — pure ES modules: `normalizer` (paragraph splitting), `highlight` (word-by-word DOM highlighting), `player` (AudioContext + queue), `scheduler` (prefetch timing), `controls` (UI), `logger` (debug wrapper).

### Key data flows
1. User clicks extension → `background.js` injects extractor → extractor sends article to background → background opens overlay iframe.
2. Reader iframe connects to background via `chrome.runtime.connect("lactor-tts")` → background proxies to two WebSocket connections on `ws://127.0.0.1:<port>/tts`.
3. `speak` message → backend streams interleaved `audio` (base64 MP3) + `word` boundary events → reader feeds audio to `AudioContext`, highlights matching DOM word spans.

## Docs Archiving

- 工作过程中产生的设计稿、实现计划等文档，完成后移入 `docs/archived/`。
- 发版前统一整理：将 `docs/archived/` 下的文件按版本号分子目录（如 `docs/archived/v0.1.0/`），再在版本目录内按产品需求/功能点分子文件夹（如 `word-highlight/`、`prefetch-scheduler/`），而非按技术模块区分。

### WebSocket protocol
Messages sent to backend: `{ action: "speak"|"cancel", id, text, voice, conn }`
Events from backend: `{ type: "audio"|"word"|"done"|"error", id, ... }`
`conn` (0 or 1) tracks which of the two parallel connections handles a given paragraph.
