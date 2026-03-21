import pytest
from httpx import ASGITransport, AsyncClient

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
