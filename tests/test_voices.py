import pytest
from httpx import ASGITransport, AsyncClient

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
