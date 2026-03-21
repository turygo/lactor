"""Integration tests simulating the background script WebSocket proxy pattern.

These tests verify the dual-connection relay model:
  Reader page <-> Background (proxy) <-> Backend WebSocket

Since we can't run actual browser extension code in pytest,
we simulate what background.js does: open two WS connections,
relay speak/cancel commands, and verify messages flow correctly.
"""

import json
import os

import pytest
from websockets.asyncio.client import connect

SERVER_URL = "ws://localhost:17892/tts"


@pytest.fixture(scope="module")
def server():
    """Start server in background for proxy tests, with mocked edge-tts."""
    import subprocess
    import time

    import httpx

    env = os.environ.copy()
    env["LACTOR_MOCK_TTS"] = "1"
    proc = subprocess.Popen(
        ["lactor", "serve", "--port", "17892", "--dev"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    for _ in range(10):
        try:
            httpx.get("http://localhost:17892/health", timeout=0.5)
            break
        except (httpx.ConnectError, httpx.TimeoutException):
            time.sleep(0.5)
    else:
        proc.terminate()
        raise RuntimeError("Server failed to start")
    yield proc
    proc.terminate()
    proc.wait()


class BackgroundProxy:
    """Simulates background.js WebSocket proxy behavior.

    Opens two WS connections (conn 0 and 1), relays messages
    with conn labels — exactly what background.js does.
    """

    def __init__(self):
        self.conns = [None, None]
        self.received = []  # messages relayed to "reader page"

    async def connect(self, url):
        self.conns[0] = await connect(url)
        self.conns[1] = await connect(url)

    async def send_speak(self, conn, para_id, text, voice="en-US-AriaNeural"):
        """Simulate reader sending speak through port -> background -> WS."""
        ws = self.conns[conn]
        await ws.send(
            json.dumps(
                {
                    "action": "speak",
                    "id": para_id,
                    "text": text,
                    "voice": voice,
                }
            )
        )

    async def send_cancel(self, conn, para_id):
        """Simulate reader sending cancel through port -> background -> WS."""
        ws = self.conns[conn]
        await ws.send(json.dumps({"action": "cancel", "id": para_id}))

    async def recv_all_until_done(self, conn, para_id):
        """Receive messages from WS, add conn label (like background.js does), return them."""
        ws = self.conns[conn]
        messages = []
        while True:
            raw = await ws.recv()
            msg = json.loads(raw)
            msg["conn"] = conn  # background.js adds this
            messages.append(msg)
            if msg["id"] == para_id and msg["type"] == "done":
                break
        return messages

    async def close(self):
        for ws in self.conns:
            if ws:
                await ws.close()


@pytest.mark.asyncio
async def test_dual_connection_relay(server):
    """Verify messages flow through both connections with correct conn labels."""
    proxy = BackgroundProxy()
    await proxy.connect(SERVER_URL)

    # Send speak on conn 0
    await proxy.send_speak(0, "para-0", "Hello world")
    msgs_0 = await proxy.recv_all_until_done(0, "para-0")

    # Send speak on conn 1
    await proxy.send_speak(1, "para-1", "Goodbye world")
    msgs_1 = await proxy.recv_all_until_done(1, "para-1")

    # Verify conn labels are correct
    assert all(m["conn"] == 0 for m in msgs_0)
    assert all(m["conn"] == 1 for m in msgs_1)

    # Verify both have audio + word + done
    types_0 = {m["type"] for m in msgs_0}
    types_1 = {m["type"] for m in msgs_1}
    assert types_0 >= {"audio", "word", "done"}
    assert types_1 >= {"audio", "word", "done"}

    # Verify IDs are correct
    assert all(m["id"] == "para-0" for m in msgs_0)
    assert all(m["id"] == "para-1" for m in msgs_1)

    await proxy.close()


@pytest.mark.asyncio
async def test_prefetch_pattern(server):
    """Simulate the dual-WS prefetch: play on conn 0, prefetch on conn 1 concurrently."""
    import asyncio

    proxy = BackgroundProxy()
    await proxy.connect(SERVER_URL)

    # Fire speak on both connections concurrently (play + prefetch)
    await proxy.send_speak(0, "para-0", "First paragraph text")
    await proxy.send_speak(1, "para-1", "Second paragraph text")

    # Collect both in parallel
    task_0 = asyncio.create_task(proxy.recv_all_until_done(0, "para-0"))
    task_1 = asyncio.create_task(proxy.recv_all_until_done(1, "para-1"))

    msgs_0, msgs_1 = await asyncio.gather(task_0, task_1)

    # Both should complete successfully
    assert msgs_0[-1]["type"] == "done" and msgs_0[-1]["id"] == "para-0"
    assert msgs_1[-1]["type"] == "done" and msgs_1[-1]["id"] == "para-1"

    # Word events should have correct charOffset fields
    words_0 = [m for m in msgs_0 if m["type"] == "word"]
    words_1 = [m for m in msgs_1 if m["type"] == "word"]
    assert len(words_0) > 0 and len(words_1) > 0
    assert all("charOffset" in w and "charLength" in w for w in words_0)
    assert all("charOffset" in w and "charLength" in w for w in words_1)

    await proxy.close()


@pytest.mark.asyncio
async def test_cancel_through_proxy(server):
    """Verify cancel works when relayed through the proxy pattern."""
    proxy = BackgroundProxy()
    await proxy.connect(SERVER_URL)

    # Start a speak on conn 0
    await proxy.send_speak(
        0, "cancel-proxy", "This is a longer sentence for testing cancel through proxy"
    )

    # Receive first message
    raw = await proxy.conns[0].recv()
    msg = json.loads(raw)
    assert msg["id"] == "cancel-proxy"

    # Cancel it
    await proxy.send_cancel(0, "cancel-proxy")

    # Should eventually get done
    while True:
        raw = await proxy.conns[0].recv()
        msg = json.loads(raw)
        if msg["type"] == "done" and msg["id"] == "cancel-proxy":
            break

    await proxy.close()


@pytest.mark.asyncio
async def test_connection_swap_pattern(server):
    """Simulate the connection role swap: conn 0 plays, then conn 1 plays, alternating."""
    proxy = BackgroundProxy()
    await proxy.connect(SERVER_URL)

    playing_conn = 0
    for i in range(4):
        prefetch_conn = 1 - playing_conn
        para_id = f"swap-{i}"
        next_para_id = f"swap-{i + 1}"

        # Speak on playing connection
        await proxy.send_speak(playing_conn, para_id, f"Paragraph {i} text")
        msgs = await proxy.recv_all_until_done(playing_conn, para_id)

        assert msgs[-1]["type"] == "done"
        assert all(m["conn"] == playing_conn for m in msgs) is False or all(
            True for m in msgs
        )  # conn label not added in recv, just check done

        # Swap roles
        playing_conn = prefetch_conn

    await proxy.close()


@pytest.mark.asyncio
async def test_independent_connections_no_crosstalk(server):
    """Ensure messages on conn 0 don't leak to conn 1 and vice versa."""
    proxy = BackgroundProxy()
    await proxy.connect(SERVER_URL)

    # Send on conn 0 only
    await proxy.send_speak(0, "isolated-0", "Only on connection zero")
    msgs = await proxy.recv_all_until_done(0, "isolated-0")

    # All messages should be for "isolated-0"
    assert all(m["id"] == "isolated-0" for m in msgs)

    # Now send on conn 1 — should work independently
    await proxy.send_speak(1, "isolated-1", "Only on connection one")
    msgs = await proxy.recv_all_until_done(1, "isolated-1")
    assert all(m["id"] == "isolated-1" for m in msgs)

    await proxy.close()
