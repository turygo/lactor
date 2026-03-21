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
                current_task = asyncio.create_task(_stream_paragraph(websocket, msg, cancel_event))

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
            if cancel_event.is_set():
                return done_sent
            event["id"] = para_id
            await websocket.send_text(json.dumps(event))
            if event["type"] == "done":
                done_sent = True
    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "id": para_id, "message": str(e)}))
    return done_sent
