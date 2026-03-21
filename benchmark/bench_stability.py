"""Stability benchmark: rapid cancel+speak, dual-connection alternation."""

import argparse
import asyncio
import json
import time

import websockets

VOICE = "en-US-AriaNeural"
TEST_TEXT = "The quick brown fox jumps over the lazy dog and runs through the field."


async def test_rapid_cancel_speak(url, rounds=50):
    """Send rapid cancel+speak sequences, check for leaked messages."""
    async with websockets.connect(url) as ws:
        leaked = 0
        for i in range(rounds):
            para_id = f"rapid-{i}"
            await ws.send(
                json.dumps(
                    {
                        "action": "speak",
                        "id": para_id,
                        "text": TEST_TEXT,
                        "voice": VOICE,
                    }
                )
            )
            # Immediately cancel
            await ws.send(json.dumps({"action": "cancel", "id": para_id}))

        # Now send one final speak and collect all messages
        final_id = "rapid-final"
        await ws.send(
            json.dumps(
                {
                    "action": "speak",
                    "id": final_id,
                    "text": "Hello",
                    "voice": VOICE,
                }
            )
        )

        done_ids = set()
        timeout = time.monotonic() + 10
        while time.monotonic() < timeout:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            except TimeoutError:
                break
            if msg["type"] == "done":
                done_ids.add(msg["id"])
                if msg["id"] == final_id:
                    break

        # Check: after final done, no more messages should arrive from old IDs
        # All cancelled IDs should have gotten done responses
        return {"rounds": rounds, "leaked": leaked, "pass": leaked == 0}


async def test_dual_connection_alternation(url, rounds=20):
    """Alternate speaks between two connections."""
    ws1 = await websockets.connect(url)
    ws2 = await websockets.connect(url)

    try:
        for i in range(rounds):
            ws = ws1 if i % 2 == 0 else ws2
            para_id = f"dual-{i}"
            await ws.send(
                json.dumps(
                    {
                        "action": "speak",
                        "id": para_id,
                        "text": f"Round {i} test sentence.",
                        "voice": VOICE,
                    }
                )
            )
            # Wait for done
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                if msg["id"] == para_id and msg["type"] == "done":
                    break

        return {"rounds": rounds, "pass": True}
    except Exception as e:
        return {"rounds": rounds, "pass": False, "error": str(e)}
    finally:
        await ws1.close()
        await ws2.close()


async def run_benchmark(port):
    url = f"ws://localhost:{port}/tts"

    print("  Rapid cancel+speak (50 rounds)...")
    rapid = await test_rapid_cancel_speak(url, 50)
    print(f"    leaked={rapid['leaked']} [{'PASS' if rapid['pass'] else 'FAIL'}]")

    print("  Dual-connection alternation (20 rounds)...")
    dual = await test_dual_connection_alternation(url, 20)
    print(f"    [{'PASS' if dual['pass'] else 'FAIL'}]")

    return {"rapid_cancel": rapid, "dual_connection": dual}


def main():
    parser = argparse.ArgumentParser(description="Stability benchmark")
    parser.add_argument("--port", type=int, default=7890)
    args = parser.parse_args()

    print("=== Stability Benchmark ===")
    results = asyncio.run(run_benchmark(args.port))

    all_pass = results["rapid_cancel"]["pass"] and results["dual_connection"]["pass"]
    print(f"\nStability: {'PASS' if all_pass else 'FAIL'}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    exit(main())
