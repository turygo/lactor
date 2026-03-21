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
        if char_offset == -1:
            char_offset = search_from
        search_from = char_offset + len(w)
        yield {
            "type": "word",
            "text": w,
            "offset": offset_ms,
            "duration": 200,
            "charOffset": char_offset,
            "charLength": len(w),
        }
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
            yield {
                "type": "audio",
                "data": base64.b64encode(chunk["data"]).decode("ascii"),
            }
        elif chunk["type"] == "WordBoundary":
            word_text = chunk["text"]
            char_offset = text.find(word_text, search_from)
            if char_offset == -1:
                char_offset = search_from
            char_length = len(word_text)
            search_from = char_offset + char_length
            yield {
                "type": "word",
                "text": word_text,
                "offset": chunk["offset"] // 10_000,
                "duration": chunk["duration"] // 10_000,
                "charOffset": char_offset,
                "charLength": char_length,
            }
    yield {"type": "done"}
