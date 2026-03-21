import json
import os
import subprocess
import time

import httpx
import pytest
import websockets
from websockets.asyncio.client import connect

SERVER_URL = "ws://localhost:17890/tts"


@pytest.fixture(scope="module")
def server():
    """Start server in background for WS tests, with mocked edge-tts."""
    env = os.environ.copy()
    env["LACTOR_MOCK_TTS"] = "1"
    proc = subprocess.Popen(
        ["lactor", "serve", "--port", "17890", "--dev"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
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
        await ws.send(
            json.dumps(
                {
                    "action": "speak",
                    "id": "test-1",
                    "text": "Hello world",
                    "voice": "en-US-AriaNeural",
                }
            )
        )
        types_seen = set()
        while True:
            msg = json.loads(await ws.recv())
            assert msg["id"] == "test-1"
            types_seen.add(msg["type"])
            if msg["type"] == "done":
                break
        assert types_seen >= {"audio", "word", "done"}


@pytest.mark.asyncio
async def test_ws_origin_rejected():
    """Test WS Origin validation WITHOUT --dev. Starts a separate server with --extension-id."""
    proc = subprocess.Popen(
        ["lactor", "serve", "--port", "17891", "--extension-id", "test-ext-id"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    for _ in range(10):
        try:
            httpx.get(
                "http://localhost:17891/health",
                headers={"Origin": "moz-extension://test-ext-id"},
                timeout=0.5,
            )
            break
        except (httpx.ConnectError, httpx.TimeoutException):
            time.sleep(0.5)
    try:
        rejected = False
        try:
            async with websockets.connect(
                "ws://localhost:17891/tts",
                additional_headers={"Origin": "http://evil.com"},
            ) as ws:
                await ws.recv()
        except websockets.exceptions.ConnectionClosed as e:
            rejected = True
            assert e.rcvd.code == 4003, f"Expected close code 4003, got {e.rcvd.code}"
        except websockets.exceptions.InvalidStatus as e:
            rejected = True
            assert e.response.status_code == 403, (
                f"Expected HTTP 403, got {e.response.status_code}"
            )
        assert rejected, "Wrong Origin should be rejected"

        # Correct Origin should work
        env = os.environ.copy()
        env["LACTOR_MOCK_TTS"] = "1"
        async with websockets.connect(
            "ws://localhost:17891/tts",
            additional_headers={"Origin": "moz-extension://test-ext-id"},
        ) as ws:
            await ws.send(
                json.dumps(
                    {
                        "action": "speak",
                        "id": "origin-test",
                        "text": "Hi",
                        "voice": "en-US-AriaNeural",
                    }
                )
            )
            msg = json.loads(await ws.recv())
            assert msg["id"] == "origin-test"
    finally:
        proc.terminate()
        proc.wait()


@pytest.mark.asyncio
async def test_cancel_stops_stream(server):
    async with connect(SERVER_URL) as ws:
        await ws.send(
            json.dumps(
                {
                    "action": "speak",
                    "id": "cancel-test",
                    "text": "This is a longer sentence for testing cancel",
                    "voice": "en-US-AriaNeural",
                }
            )
        )
        msg = json.loads(await ws.recv())
        assert msg["id"] == "cancel-test"
        await ws.send(json.dumps({"action": "cancel", "id": "cancel-test"}))
        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == "done" and msg["id"] == "cancel-test":
                break
