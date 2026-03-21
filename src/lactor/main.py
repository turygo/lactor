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
