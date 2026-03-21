"""Latency benchmark: first-audio-chunk and first-word-event latency."""

import argparse
import asyncio
import json
import os
import time

import websockets

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
VOICE = "en-US-AriaNeural"


async def measure_first_chunk_latency(url, text):
    """Measure time to first audio chunk and first word event."""
    async with websockets.connect(url) as ws:
        para_id = f"bench-{time.monotonic_ns()}"
        start = time.monotonic()
        await ws.send(
            json.dumps(
                {
                    "action": "speak",
                    "id": para_id,
                    "text": text,
                    "voice": VOICE,
                }
            )
        )

        first_audio = None
        first_word = None
        while True:
            msg = json.loads(await ws.recv())
            if msg["id"] != para_id:
                continue
            now = time.monotonic()
            if msg["type"] == "audio" and first_audio is None:
                first_audio = now - start
            elif msg["type"] == "word" and first_word is None:
                first_word = now - start
            elif msg["type"] == "done":
                break
            if first_audio and first_word and msg["type"] == "done":
                break

        return {"first_audio_s": first_audio, "first_word_s": first_word}


async def run_benchmark(port):
    url = f"ws://localhost:{port}/tts"
    results = {}

    for fixture in sorted(os.listdir(FIXTURES_DIR)):
        if not fixture.endswith(".txt"):
            continue
        name = fixture.replace(".txt", "")
        filepath = os.path.join(FIXTURES_DIR, fixture)
        with open(filepath) as f:
            text = f.read()

        # Use first ~100 words as the test paragraph
        words = text.split()[:100]
        test_text = " ".join(words)

        latency = await measure_first_chunk_latency(url, test_text)
        results[name] = latency

        audio_ok = latency["first_audio_s"] < 1.0
        word_ok = latency["first_word_s"] < 1.0
        status = "PASS" if (audio_ok and word_ok) else "FAIL"
        print(
            f"  {name}: first_audio={latency['first_audio_s']:.3f}s "
            f"first_word={latency['first_word_s']:.3f}s [{status}]"
        )

    return results


def main():
    parser = argparse.ArgumentParser(description="Latency benchmark")
    parser.add_argument("--port", type=int, default=7890)
    args = parser.parse_args()

    print("=== Latency Benchmark ===")
    results = asyncio.run(run_benchmark(args.port))

    all_pass = all(r["first_audio_s"] < 1.0 and r["first_word_s"] < 1.0 for r in results.values())
    print(f"\nLatency: {'PASS' if all_pass else 'FAIL'}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    exit(main())
