from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from lactor.main import create_app

FAKE_VOICES = [
    {"Name": "en-US-AriaNeural", "Locale": "en-US", "Gender": "Female"},
    {"Name": "en-US-GuyNeural", "Locale": "en-US", "Gender": "Male"},
    {"Name": "zh-CN-XiaoxiaoNeural", "Locale": "zh-CN", "Gender": "Female"},
]


@pytest.mark.asyncio
async def test_voices_returns_list():
    app = create_app(dev=True)
    transport = ASGITransport(app=app)
    with patch("edge_tts.list_voices", new_callable=AsyncMock, return_value=FAKE_VOICES):
        async with AsyncClient(transport=transport, base_url="http://localhost") as client:
            resp = await client.get("/voices")
            assert resp.status_code == 200
            voices = resp.json()
            assert isinstance(voices, list) and len(voices) == 3
            assert all(k in voices[0] for k in ("name", "locale", "gender"))


@pytest.mark.asyncio
async def test_voices_maps_fields_correctly():
    app = create_app(dev=True)
    transport = ASGITransport(app=app)
    with patch("edge_tts.list_voices", new_callable=AsyncMock, return_value=FAKE_VOICES):
        async with AsyncClient(transport=transport, base_url="http://localhost") as client:
            resp = await client.get("/voices")
            voices = resp.json()
            assert voices[0] == {"name": "en-US-AriaNeural", "locale": "en-US", "gender": "Female"}
            assert voices[2] == {
                "name": "zh-CN-XiaoxiaoNeural",
                "locale": "zh-CN",
                "gender": "Female",
            }


@pytest.mark.asyncio
async def test_voices_empty_list():
    app = create_app(dev=True)
    transport = ASGITransport(app=app)
    with patch("edge_tts.list_voices", new_callable=AsyncMock, return_value=[]):
        async with AsyncClient(transport=transport, base_url="http://localhost") as client:
            resp = await client.get("/voices")
            assert resp.status_code == 200
            assert resp.json() == []
