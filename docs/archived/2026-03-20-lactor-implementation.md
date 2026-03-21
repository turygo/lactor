# Lactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser extension + local Python backend that extracts web article content and reads it aloud with synchronized word-by-word highlighting.

**Architecture:** Two independent subsystems — (1) Python backend (FastAPI + edge-tts) serving TTS via WebSocket, (2) Firefox/Zen browser extension (MV3) using Defuddle for content extraction, rendering an immersive iframe overlay with Web Audio API playback and rAF-driven highlighting. Communication via dual WebSocket connections with prefetch-1 buffer.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, edge-tts, base64 | JavaScript (vanilla), Manifest V3, Defuddle, Web Audio API

**Spec:** `docs/superpowers/specs/2026-03-20-lactor-design.md`

---

## File Structure

### Python Backend (`src/lactor/`)

| File | Responsibility |
|------|---------------|
| `pyproject.toml` | Package metadata, dependencies (fastapi, uvicorn, edge-tts), CLI entry point |
| `src/lactor/__init__.py` | Package marker |
| `src/lactor/main.py` | FastAPI app factory, Origin middleware (HTTP + WS), CLI (`lactor serve`) via argparse |
| `src/lactor/tts.py` | edge-tts wrapper: stream audio+word boundaries for a paragraph, convert ticks→ms, compute charOffset |
| `src/lactor/ws_handler.py` | WebSocket endpoint: dispatch speak/cancel, manage per-connection state, validate Origin on WS |
| `tests/test_tts.py` | Unit tests for tts.py (mocked edge-tts, no network) |
| `tests/test_ws_handler.py` | Integration tests for WebSocket protocol (including WS Origin check) |
| `tests/test_origin.py` | Tests for HTTP Origin validation middleware |

### Browser Extension (`extension/`)

| File | Responsibility |
|------|---------------|
| `manifest.json` | MV3 manifest: permissions, host_permissions, web_accessible_resources, background service worker |
| `background.js` | Button click handler, content script injection, tabId-keyed content store (Map + 60s TTL), CSP fallback handler |
| `popup/popup.html` | Port config UI + extension ID display + connection status |
| `popup/popup.js` | Port save/load (storage.local), backend health check, extension ID display |
| `content/extractor.js` | Defuddle extraction → sendMessage to background |
| `content/overlay.js` | iframe injection/removal, fade animations, CSP fallback detection (2s handshake timeout), postMessage listener with source+type validation |
| `reader/reader.html` | Minimal HTML shell for reader page |
| `reader/reader.css` | Reading typography, .active highlight style, controls bar layout |
| `reader/reader.js` | Main orchestrator: fetch content from background, normalize text, split paragraphs, render word spans, coordinate playback queue with dual WS connections |
| `reader/components/highlight.js` | charOffset→span binary search mapping, rAF loop, auto-scroll |
| `reader/components/player.js` | base64→binary→buffer→decodeAudioData→AudioBufferSourceNode, pause/resume via AudioContext.suspend/resume |
| `reader/components/controls.js` | Play/pause button, voice dropdown (from /voices), close button (postMessage to parent) |
| `lib/defuddle.min.js` | Vendored Defuddle library |

### Benchmark (`benchmark/`)

| File | Responsibility |
|------|---------------|
| `fixtures/*.txt` | Test articles (short/medium/long/extra-long) |
| `bench_latency.py` | First-chunk latency, inter-paragraph latency |
| `bench_memory.py` | Backend RSS tracking over long playback |
| `bench_integrity.py` | Word event coverage, MP3 decode success, charOffset monotonicity |
| `bench_stability.py` | Rapid cancel+speak, dual-connection alternation |
| `bench_frontend_memory.html` | Browser-side memory profiling page |
| `run_all.py` | Run all Python benchmarks, aggregate JSON report |

---

## Task 1: Project Scaffolding + Python Package Setup

**Files:**
- Create: `pyproject.toml`
- Create: `src/lactor/__init__.py`
- Create: `src/lactor/main.py`

- [ ] **Step 1: Initialize git repo (if not already one)**

```bash
cd /Users/turygo/code/tools/lactor
git rev-parse --is-inside-work-tree 2>/dev/null || git init
```

- [ ] **Step 2: Create pyproject.toml**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "lactor"
version = "0.1.0"
description = "Local TTS backend for Lactor browser extension"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "edge-tts>=7.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24.0",
    "pytest-timeout>=2.3.0",
    "httpx>=0.27.0",
    "websockets>=13.0",
]

[project.scripts]
lactor = "lactor.main:cli"

[tool.hatch.build.targets.wheel]
packages = ["src/lactor"]
```

- [ ] **Step 3: Create src/lactor/__init__.py**

Empty file.

- [ ] **Step 4: Create src/lactor/main.py with minimal CLI + app**

```python
import argparse
import uvicorn
from fastapi import FastAPI

def create_app(extension_id: str | None = None, dev: bool = False) -> FastAPI:
    app = FastAPI()
    app.state.extension_id = extension_id
    app.state.dev = dev

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app

def cli():
    parser = argparse.ArgumentParser(description="Lactor TTS backend")
    parser.add_argument("command", choices=["serve"])
    parser.add_argument("--port", type=int, default=7890)
    parser.add_argument("--extension-id", type=str, default=None)
    parser.add_argument("--dev", action="store_true")
    args = parser.parse_args()

    if args.command == "serve":
        app = create_app(extension_id=args.extension_id, dev=args.dev)
        uvicorn.run(app, host="127.0.0.1", port=args.port)

if __name__ == "__main__":
    cli()
```

- [ ] **Step 5: Install in dev mode and verify**

```bash
pip install -e ".[dev]"
lactor serve --port 7890 &
curl http://localhost:7890/health
# Expected: {"status":"ok"}
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml src/
git commit -m "feat: project scaffolding with FastAPI CLI"
```

---

## Task 2: Origin Validation Middleware

**Files:**
- Modify: `src/lactor/main.py`
- Create: `tests/test_origin.py`

- [ ] **Step 1: Write failing test for Origin validation**

```python
# tests/test_origin.py
import pytest
from httpx import AsyncClient, ASGITransport
from lactor.main import create_app

@pytest.mark.asyncio
async def test_health_allowed_origin():
    app = create_app(extension_id="test-ext-id")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as client:
        resp = await client.get("/health", headers={"Origin": "moz-extension://test-ext-id"})
        assert resp.status_code == 200

@pytest.mark.asyncio
async def test_health_rejected_origin():
    app = create_app(extension_id="test-ext-id")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as client:
        resp = await client.get("/health", headers={"Origin": "http://evil.com"})
        assert resp.status_code == 403

@pytest.mark.asyncio
async def test_health_no_origin_rejected():
    app = create_app(extension_id="test-ext-id")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as client:
        resp = await client.get("/health")
        assert resp.status_code == 403

@pytest.mark.asyncio
async def test_dev_mode_skips_origin():
    app = create_app(dev=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_origin.py -v
```
Expected: some tests FAIL (no middleware yet)

- [ ] **Step 3: Implement Origin middleware in src/lactor/main.py**

Note: `BaseHTTPMiddleware` does NOT intercept WebSocket connections, so we also add a helper function `check_ws_origin()` that the WebSocket handler will call explicitly.

```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

class OriginMiddleware(BaseHTTPMiddleware):
    """Origin validation for HTTP requests only. WebSocket Origin is checked in ws_handler."""
    def __init__(self, app, allowed_origins: set[str], dev: bool = False):
        super().__init__(app)
        self.allowed_origins = allowed_origins
        self.dev = dev

    async def dispatch(self, request: Request, call_next):
        if self.dev:
            return await call_next(request)
        origin = request.headers.get("origin")
        if origin not in self.allowed_origins:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        return await call_next(request)

def create_app(extension_id: str | None = None, dev: bool = False) -> FastAPI:
    app = FastAPI()
    allowed_origins = set()
    if extension_id:
        allowed_origins.add(f"moz-extension://{extension_id}")
        allowed_origins.add(f"chrome-extension://{extension_id}")
    app.state.extension_id = extension_id
    app.state.dev = dev
    app.state.allowed_origins = allowed_origins
    app.add_middleware(OriginMiddleware, allowed_origins=allowed_origins, dev=dev)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app

def check_ws_origin(websocket, allowed_origins: set[str], dev: bool) -> bool:
    """Check Origin header for WebSocket connections. Returns True if allowed."""
    if dev:
        return True
    origin = websocket.headers.get("origin")
    return origin in allowed_origins
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_origin.py -v
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lactor/main.py tests/test_origin.py
git commit -m "feat: Origin validation middleware with --dev bypass"
```

---

## Task 3: TTS Wrapper (edge-tts)

**Files:**
- Create: `src/lactor/tts.py`
- Create: `tests/test_tts.py`

- [ ] **Step 1: Write failing tests for TTS streaming**

Two test files: one with mocked edge-tts (fast, no network, tests protocol logic), one integration test marked `@pytest.mark.integration` (optional, tests real edge-tts).

```python
# tests/test_tts.py
"""Unit tests with mocked edge-tts — no network required."""
import pytest
from unittest.mock import patch
from lactor.tts import stream_tts

def _fake_communicate_stream():
    """Simulate edge-tts Communicate.stream() yielding audio + WordBoundary."""
    async def stream():
        yield {"type": "audio", "data": b"\xff\xfb\x90\x00" * 10}
        yield {"type": "WordBoundary", "text": "Hello", "offset": 5_000_000, "duration": 2_000_000}
        yield {"type": "audio", "data": b"\xff\xfb\x90\x00" * 10}
        yield {"type": "WordBoundary", "text": "world", "offset": 9_000_000, "duration": 3_000_000}
    return stream()

@pytest.mark.asyncio
async def test_stream_tts_produces_audio_and_words():
    with patch("lactor.tts.edge_tts.Communicate") as MockComm:
        MockComm.return_value.stream = _fake_communicate_stream
        audio_chunks, word_events, got_done = [], [], False
        async for event in stream_tts("Hello world", "en-US-AriaNeural"):
            if event["type"] == "audio": audio_chunks.append(event["data"])
            elif event["type"] == "word":
                word_events.append(event)
                assert all(k in event for k in ("charOffset", "charLength", "offset", "duration"))
            elif event["type"] == "done": got_done = True
        assert len(audio_chunks) > 0 and len(word_events) == 2 and got_done

@pytest.mark.asyncio
async def test_stream_tts_offsets_in_milliseconds():
    with patch("lactor.tts.edge_tts.Communicate") as MockComm:
        MockComm.return_value.stream = _fake_communicate_stream
        async for event in stream_tts("Hello world", "en-US-AriaNeural"):
            if event["type"] == "word":
                assert event["offset"] == 500 and event["duration"] == 200
                assert event["charOffset"] == 0 and event["charLength"] == 5
                break

@pytest.mark.asyncio
async def test_stream_tts_charoffset_tracks_position():
    with patch("lactor.tts.edge_tts.Communicate") as MockComm:
        MockComm.return_value.stream = _fake_communicate_stream
        words = [e async for e in stream_tts("Hello world", "en-US-AriaNeural") if e["type"] == "word"]
        assert words[0]["charOffset"] == 0 and words[1]["charOffset"] == 6
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_tts.py -v
```
Expected: FAIL (module not found)

- [ ] **Step 3: Implement src/lactor/tts.py**

charOffset is computed by tracking text position (edge-tts does not natively provide character offsets in WordBoundary events).

```python
import base64
import os
from collections.abc import AsyncIterator
from typing import Any

import edge_tts


async def _mock_stream_tts(text: str) -> AsyncIterator[dict[str, Any]]:
    """Deterministic mock TTS for testing. No network calls."""
    words = text.split()
    fake_audio = base64.b64encode(b"\xff\xfb\x90\x00" * 50).decode("ascii")
    yield {"type": "audio", "data": fake_audio}
    offset_ms = 0
    search_from = 0
    for w in words:
        char_offset = text.find(w, search_from)
        if char_offset == -1: char_offset = search_from
        search_from = char_offset + len(w)
        yield {"type": "word", "text": w, "offset": offset_ms, "duration": 200,
               "charOffset": char_offset, "charLength": len(w)}
        offset_ms += 300
        yield {"type": "audio", "data": fake_audio}
    yield {"type": "done"}


async def stream_tts(text: str, voice: str) -> AsyncIterator[dict[str, Any]]:
    """Stream audio chunks and word boundary events for a paragraph.

    Yields dicts with type: "audio" | "word" | "done".
    Audio data is base64-encoded. Offsets/durations are in milliseconds.
    charOffset/charLength are computed by searching for each word in the source text.

    Set LACTOR_MOCK_TTS=1 env var for deterministic mock output (for tests).
    """
    if os.environ.get("LACTOR_MOCK_TTS") == "1":
        async for event in _mock_stream_tts(text):
            yield event
        return

    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    search_from = 0
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            yield {"type": "audio", "data": base64.b64encode(chunk["data"]).decode("ascii")}
        elif chunk["type"] == "WordBoundary":
            word_text = chunk["text"]
            char_offset = text.find(word_text, search_from)
            if char_offset == -1: char_offset = search_from
            char_length = len(word_text)
            search_from = char_offset + char_length
            yield {"type": "word", "text": word_text,
                   "offset": chunk["offset"] // 10_000, "duration": chunk["duration"] // 10_000,
                   "charOffset": char_offset, "charLength": char_length}
    yield {"type": "done"}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_tts.py -v
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lactor/tts.py tests/test_tts.py
git commit -m "feat: edge-tts wrapper with word boundary timing"
```

---

## Task 4: WebSocket Handler

**Files:**
- Create: `src/lactor/ws_handler.py`
- Create: `tests/test_ws_handler.py`
- Modify: `src/lactor/main.py` (register WS route)

- [ ] **Step 1: Write failing integration test**

```python
# tests/test_ws_handler.py
import json
import pytest
from websockets.asyncio.client import connect

SERVER_URL = "ws://localhost:17890/tts"

@pytest.fixture(scope="module")
def server():
    """Start server in background for WS tests, with mocked edge-tts."""
    import subprocess, time, httpx, os
    env = os.environ.copy()
    env["LACTOR_MOCK_TTS"] = "1"
    proc = subprocess.Popen(
        ["lactor", "serve", "--port", "17890", "--dev"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
    )
    for _ in range(10):
        try:
            httpx.get("http://localhost:17890/health", timeout=0.5)
            break
        except (httpx.ConnectError, httpx.TimeoutException):
            time.sleep(0.5)
    else:
        proc.terminate()
        raise RuntimeError("Server failed to start")
    yield proc
    proc.terminate()
    proc.wait()

@pytest.mark.asyncio
async def test_speak_returns_audio_word_done(server):
    async with connect(SERVER_URL) as ws:
        await ws.send(json.dumps({"action": "speak", "id": "test-1",
                                   "text": "Hello world", "voice": "en-US-AriaNeural"}))
        types_seen = set()
        while True:
            msg = json.loads(await ws.recv())
            assert msg["id"] == "test-1"
            types_seen.add(msg["type"])
            if msg["type"] == "done": break
        assert types_seen >= {"audio", "word", "done"}

@pytest.mark.asyncio
async def test_ws_origin_rejected():
    """Test WS Origin validation WITHOUT --dev. Starts a separate server with --extension-id."""
    import subprocess, time, httpx, websockets
    proc = subprocess.Popen(
        ["lactor", "serve", "--port", "17891", "--extension-id", "test-ext-id"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    for _ in range(10):
        try:
            httpx.get("http://localhost:17891/health",
                       headers={"Origin": "moz-extension://test-ext-id"}, timeout=0.5)
            break
        except (httpx.ConnectError, httpx.TimeoutException):
            time.sleep(0.5)
    try:
        rejected = False
        try:
            async with websockets.connect("ws://localhost:17891/tts",
                                           additional_headers={"Origin": "http://evil.com"}) as ws:
                await ws.recv()
        except websockets.exceptions.ConnectionClosed as e:
            rejected = True
            assert e.rcvd.code == 4003, f"Expected close code 4003, got {e.rcvd.code}"
        except websockets.exceptions.InvalidStatus as e:
            rejected = True
            assert e.response.status_code == 403, f"Expected HTTP 403, got {e.response.status_code}"
        assert rejected, "Wrong Origin should be rejected"

        # Correct Origin should work
        async with websockets.connect("ws://localhost:17891/tts",
                                       additional_headers={"Origin": "moz-extension://test-ext-id"}) as ws:
            await ws.send(json.dumps({"action": "speak", "id": "origin-test",
                                       "text": "Hi", "voice": "en-US-AriaNeural"}))
            msg = json.loads(await ws.recv())
            assert msg["id"] == "origin-test"
    finally:
        proc.terminate()
        proc.wait()

@pytest.mark.asyncio
async def test_cancel_stops_stream(server):
    async with connect(SERVER_URL) as ws:
        await ws.send(json.dumps({"action": "speak", "id": "cancel-test",
                                   "text": "This is a longer sentence for testing cancel",
                                   "voice": "en-US-AriaNeural"}))
        msg = json.loads(await ws.recv())
        assert msg["id"] == "cancel-test"
        await ws.send(json.dumps({"action": "cancel", "id": "cancel-test"}))
        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == "done" and msg["id"] == "cancel-test": break
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_ws_handler.py -v
```

- [ ] **Step 3: Implement src/lactor/ws_handler.py**

Key design decisions:
- Origin check before WebSocket accept (Starlette middleware does NOT intercept WS)
- `_stream_paragraph` tracks whether it sent `done` via a flag to avoid duplicate `done` on cancel
- Cancel only acts if `id` matches the current in-flight stream

```python
import asyncio
import json
from fastapi import WebSocket, WebSocketDisconnect
from lactor.tts import stream_tts


async def handle_tts_websocket(websocket: WebSocket, allowed_origins: set[str], dev: bool):
    if not dev:
        origin = websocket.headers.get("origin")
        if origin not in allowed_origins:
            await websocket.close(code=4003, reason="Forbidden: invalid Origin")
            return

    await websocket.accept()
    current_task: asyncio.Task | None = None
    current_id: str | None = None
    cancel_event = asyncio.Event()

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            action = msg.get("action")

            if action == "speak":
                if current_task and not current_task.done():
                    cancel_event.set()
                    await current_task
                cancel_event.clear()
                current_id = msg.get("id")
                current_task = asyncio.create_task(
                    _stream_paragraph(websocket, msg, cancel_event)
                )

            elif action == "cancel":
                cancel_id = msg.get("id")
                if current_id == cancel_id and current_task and not current_task.done():
                    cancel_event.set()
                    done_sent = await current_task
                    if not done_sent:
                        await websocket.send_text(json.dumps({"type": "done", "id": cancel_id}))

    except WebSocketDisconnect:
        if current_task and not current_task.done():
            cancel_event.set()


async def _stream_paragraph(websocket: WebSocket, msg: dict, cancel_event: asyncio.Event) -> bool:
    """Stream TTS for a paragraph. Returns True if 'done' was sent."""
    para_id, text, voice = msg["id"], msg["text"], msg["voice"]
    done_sent = False
    try:
        async for event in stream_tts(text, voice):
            if cancel_event.is_set(): return done_sent
            event["id"] = para_id
            await websocket.send_text(json.dumps(event))
            if event["type"] == "done": done_sent = True
    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "id": para_id, "message": str(e)}))
    return done_sent
```

- [ ] **Step 4: Register WS route in src/lactor/main.py**

```python
from fastapi import WebSocket
from lactor.ws_handler import handle_tts_websocket

# Inside create_app, after middleware:
@app.websocket("/tts")
async def tts_endpoint(websocket: WebSocket):
    await handle_tts_websocket(websocket, app.state.allowed_origins, app.state.dev)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_ws_handler.py -v --timeout=30
```

- [ ] **Step 6: Commit**

```bash
git add src/lactor/ws_handler.py src/lactor/main.py tests/test_ws_handler.py
git commit -m "feat: WebSocket TTS handler with speak/cancel protocol and Origin check"
```

---

## Task 5: Voices Endpoint

**Files:**
- Modify: `src/lactor/main.py`
- Create: `tests/test_voices.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_voices.py
import pytest
from httpx import AsyncClient, ASGITransport
from lactor.main import create_app

@pytest.mark.asyncio
async def test_voices_returns_list():
    app = create_app(dev=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as client:
        resp = await client.get("/voices")
        assert resp.status_code == 200
        voices = resp.json()
        assert isinstance(voices, list) and len(voices) > 0
        assert all(k in voices[0] for k in ("name", "locale", "gender"))
```

- [ ] **Step 2: Implement /voices endpoint**

```python
import edge_tts

@app.get("/voices")
async def list_voices():
    voices = await edge_tts.list_voices()
    return [{"name": v["Name"], "locale": v["Locale"], "gender": v["Gender"]} for v in voices]
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
pytest tests/test_voices.py -v
git add src/lactor/main.py tests/test_voices.py
git commit -m "feat: /voices endpoint listing available TTS voices"
```

---

## Task 6: Extension Scaffolding (manifest.json + background.js)

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/icons/` (placeholder)

- [ ] **Step 1: Create extension/manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Lactor",
  "version": "0.1.0",
  "description": "Immersive web article reader with synchronized TTS",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [
    "http://localhost/*",
    "http://127.0.0.1/*",
    "ws://localhost/*",
    "ws://127.0.0.1/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_icon": { "48": "icons/icon-48.png" }
  },
  "web_accessible_resources": [{
    "resources": ["reader/reader.html", "reader/reader.css", "reader/reader.js",
                  "reader/components/*.js", "lib/defuddle.min.js"],
    "matches": ["<all_urls>"]
  }],
  "options_ui": { "page": "popup/popup.html", "open_in_tab": false },
  "icons": { "48": "icons/icon-48.png" }
}
```

- [ ] **Step 2: Create extension/background.js (definitive version)**

This is the complete background.js. Tasks 8 and 9 do NOT modify this file.

```javascript
const contentStore = new Map();
const CONTENT_TTL_MS = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [tabId, entry] of contentStore) {
    if (now - entry.timestamp > CONTENT_TTL_MS) contentStore.delete(tabId);
  }
}, 10_000);

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "content") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      contentStore.set(tabId, { data: msg.data, timestamp: Date.now() });
      browser.scripting.executeScript({
        target: { tabId },
        func: (tid) => { window.__lactorTabId = tid; },
        args: [tabId],
      }).then(() => {
        browser.scripting.executeScript({ target: { tabId }, files: ["content/overlay.js"] });
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "getContent") {
    const entry = contentStore.get(msg.tabId);
    if (entry) { contentStore.delete(msg.tabId); sendResponse({ data: entry.data }); }
    else { sendResponse({ data: null, error: "No content available" }); }
    return false;
  }

  if (msg.type === "fallback-to-tab") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      browser.tabs.update(tabId, { url: browser.runtime.getURL("reader/reader.html") + `?tabId=${tabId}` });
    }
    return false;
  }

  if (msg.type === "extraction-failed") {
    console.warn("Lactor: extraction failed on tab", sender.tab?.id);
    return false;
  }
});

browser.action.onClicked.addListener(async (tab) => {
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/defuddle.min.js", "content/extractor.js"],
    });
  } catch (err) { console.error("Failed to inject content scripts:", err); }
});
```

- [ ] **Step 3: Create placeholder icon + verify manifest + commit**

```bash
mkdir -p extension/icons
python3 -c "
import struct, zlib
def create_png(w,h,r,g,b):
    raw=b'';
    for _ in range(h): raw+=b'\x00'+bytes([r,g,b])*w
    c=zlib.compress(raw); sig=b'\x89PNG\r\n\x1a\n'
    id=struct.pack('>IIBBBBB',w,h,8,2,0,0,0); ic=zlib.crc32(b'IHDR'+id)&0xffffffff
    ih=struct.pack('>I',13)+b'IHDR'+id+struct.pack('>I',ic)
    dc=zlib.crc32(b'IDAT'+c)&0xffffffff; idat=struct.pack('>I',len(c))+b'IDAT'+c+struct.pack('>I',dc)
    ec=zlib.crc32(b'IEND')&0xffffffff; iend=struct.pack('>I',0)+b'IEND'+struct.pack('>I',ec)
    return sig+ih+idat+iend
open('extension/icons/icon-48.png','wb').write(create_png(48,48,66,133,244))
"
python3 -c "import json; json.load(open('extension/manifest.json'))"
git add extension/
git commit -m "feat: extension scaffolding with MV3 manifest and background script"
```

---

## Tasks 7-15: Extension Components

Tasks 7-15 create the remaining extension files. Each task creates one or two files and commits. The code for these tasks (popup, extractor, overlay, reader HTML/CSS, normalizer, highlight engine, player, controls, reader orchestrator) follows the patterns established in the spec. Key implementation details:

- **Task 7:** `popup/popup.html` + `popup.js` — port config input, extension ID display, health check
- **Task 8:** `content/extractor.js` + vendor `lib/defuddle.min.js` — Defuddle extraction, sendMessage to background
- **Task 9:** `content/overlay.js` — iframe injection with `?tabId=` param, separate ready/close listeners, 2s handshake timeout CSP fallback
- **Task 10:** `reader/reader.html` + `reader.css` — HTML shell, typography, .active highlight, controls bar
- **Task 11:** `reader/components/normalizer.js` — canonical text pipeline (normalizeText, splitIntoWords, splitIntoParagraphs, renderParagraphs)
- **Task 12:** `reader/components/highlight.js` — HighlightEngine class with charOffset binary search, rAF loop, auto-scroll
- **Task 13:** `reader/components/player.js` — Player class with decodeAudio (base64→AudioBuffer), play/pause/resume via AudioContext.suspend/resume
- **Task 14:** `reader/components/controls.js` — Controls class with play/pause/voice/close bindings
- **Task 15:** `reader/reader.js` — main orchestrator: init (handshake, fetch content, render, connect WS), dual-WS playback queue with pendingRequests Map, per-connection reconnect counter, beforeunload cleanup, buffers.clear() on replay

Full code for each task is provided in the spec and previous conversation context. Each file should be created exactly as specified, then committed.

---

## Task 16: Benchmark Fixtures + Latency Test

**Files:**
- Create: `benchmark/fixtures/*.txt` (via generate script)
- Create: `benchmark/bench_latency.py`

- [ ] **Step 1: Generate test fixtures**

```bash
python3 -c "
import os
BASE='The quick brown fox jumps over the lazy dog. '
os.makedirs('benchmark/fixtures',exist_ok=True)
for name,count in [('short',500),('medium',3000),('long',10000),('extra-long',30000)]:
    words=(BASE*((count//9)+1)).split()[:count]
    open(f'benchmark/fixtures/{name}.txt','w').write(' '.join(words))
    print(f'{name}.txt: {count} words')
"
```

- [ ] **Step 2: Create benchmark/bench_latency.py**

Measures first-audio-chunk and first-word-event latency for each fixture. Pass criteria: < 1s for both. Uses `websockets` library to connect directly to backend in `--dev` mode.

- [ ] **Step 3: Commit**

```bash
git add benchmark/
git commit -m "feat: benchmark fixtures and latency test"
```

---

## Task 17: Benchmark — Integrity + Stability + Memory

- [ ] **Step 1:** Create `benchmark/bench_integrity.py` — word event coverage ≥ 99%, MP3 decode 100%, charOffset monotonicity, exactly one done per paragraph
- [ ] **Step 2:** Create `benchmark/bench_stability.py` — rapid cancel+speak (50x), dual-connection alternation (20 rounds), zero leaked messages
- [ ] **Step 3:** Create `benchmark/bench_memory.py` — backend RSS tracking via psutil, peak < 200MB, no leak trend
- [ ] **Step 4:** Create `benchmark/bench_frontend_memory.html` — browser-side test page, must be run manually
- [ ] **Step 5:** Create `benchmark/run_all.py` — runs all Python benchmarks, outputs `Automated: PASS/FAIL` with note that frontend memory test requires manual browser run
- [ ] **Step 6: Commit**

```bash
git add benchmark/
git commit -m "feat: integrity, stability, memory, and frontend memory benchmarks"
```

---

## Task 18: End-to-End Manual Testing

- [ ] **Step 1:** Start backend: `lactor serve --port 7890 --dev &`
- [ ] **Step 2:** Load extension in Firefox/Zen via `about:debugging`
- [ ] **Step 3:** Test on a real article — verify iframe overlay, content rendering, play/pause/resume, word highlighting, close
- [ ] **Step 4:** Run benchmarks: `python benchmark/run_all.py --port 7890`
- [ ] **Step 5:** Fix any issues found, commit

---

## Task 19: Final Cleanup + README

- [ ] **Step 1: Create README.md**

```markdown
# Lactor

Immersive web article reader with synchronized TTS and word-by-word highlighting.

## Quick Start

### Backend
pip install -e ".[dev]"
lactor serve --port 7890 --extension-id <your-extension-id>

### Extension
1. Open about:debugging#/runtime/this-firefox
2. Load extension/manifest.json as temporary add-on
3. Click the Lactor icon on any article page

### Development
lactor serve --port 7890 --dev
python benchmark/run_all.py --port 7890
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with quick start instructions"
```
