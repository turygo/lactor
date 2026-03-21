import argparse

import uvicorn
from fastapi import FastAPI
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


def check_ws_origin(websocket, allowed_origins: set[str], dev: bool) -> bool:
    """Check Origin header for WebSocket connections. Returns True if allowed."""
    if dev:
        return True
    origin = websocket.headers.get("origin")
    return origin in allowed_origins


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
