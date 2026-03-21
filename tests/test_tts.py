"""Unit tests with mocked edge-tts — no network required."""

from unittest.mock import patch

import pytest

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
            if event["type"] == "audio":
                audio_chunks.append(event["data"])
            elif event["type"] == "word":
                word_events.append(event)
                assert all(k in event for k in ("charOffset", "charLength", "offset", "duration"))
            elif event["type"] == "done":
                got_done = True
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
        words = [
            e async for e in stream_tts("Hello world", "en-US-AriaNeural") if e["type"] == "word"
        ]
        assert words[0]["charOffset"] == 0 and words[1]["charOffset"] == 6
