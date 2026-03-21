"""Data integrity benchmark: word event coverage, charOffset monotonicity, done count."""

import argparse
import asyncio
import json
import os
import time

import websockets

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
VOICE = "en-US-AriaNeural"


async def check_integrity(url, text, para_id):
    """Stream a paragraph and check integrity of returned events."""
    async with websockets.connect(url) as ws:
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

        audio_chunks = []
        word_events = []
        done_count = 0

        while True:
            msg = json.loads(await ws.recv())
            if msg["id"] != para_id:
                continue
            if msg["type"] == "audio":
                audio_chunks.append(msg["data"])
            elif msg["type"] == "word":
                word_events.append(msg)
            elif msg["type"] == "done":
                done_count += 1
                break

        return audio_chunks, word_events, done_count


def analyze_integrity(text, audio_chunks, word_events, done_count):
    """Analyze integrity metrics."""
    results = {}

    # 1. Word event coverage
    total_chars = len(text)
    covered_chars = sum(e.get("charLength", 0) for e in word_events)
    # Calculate pronounceable chars (excluding spaces and common punctuation)
    pronounceable = sum(1 for c in text if c.isalnum())
    coverage = covered_chars / pronounceable if pronounceable > 0 else 0
    results["word_coverage"] = coverage
    results["word_coverage_pass"] = coverage >= 0.99

    # 2. charOffset monotonicity
    offsets = [e["charOffset"] for e in word_events]
    monotonic = all(offsets[i] <= offsets[i + 1] for i in range(len(offsets) - 1))
    results["charoffset_monotonic"] = monotonic

    # 3. Exactly one done event
    results["done_count"] = done_count
    results["done_count_pass"] = done_count == 1

    # 4. Audio chunks present
    results["audio_chunk_count"] = len(audio_chunks)
    results["has_audio"] = len(audio_chunks) > 0

    return results


async def run_benchmark(port):
    url = f"ws://localhost:{port}/tts"
    all_results = {}

    for fixture in sorted(os.listdir(FIXTURES_DIR)):
        if not fixture.endswith(".txt"):
            continue
        name = fixture.replace(".txt", "")
        filepath = os.path.join(FIXTURES_DIR, fixture)
        with open(filepath) as f:
            text = f.read()

        # Test with first ~50 words per paragraph
        words = text.split()
        paragraphs = []
        for i in range(0, min(len(words), 200), 50):
            paragraphs.append(" ".join(words[i : i + 50]))

        fixture_results = []
        for idx, para in enumerate(paragraphs):
            para_id = f"integrity-{name}-{idx}"
            audio, events, done = await check_integrity(url, para, para_id)
            result = analyze_integrity(para, audio, events, done)
            fixture_results.append(result)

        # Aggregate
        agg = {
            "word_coverage_min": min(r["word_coverage"] for r in fixture_results),
            "all_monotonic": all(r["charoffset_monotonic"] for r in fixture_results),
            "all_done_once": all(r["done_count_pass"] for r in fixture_results),
            "all_has_audio": all(r["has_audio"] for r in fixture_results),
        }
        all_pass = (
            agg["word_coverage_min"] >= 0.99
            and agg["all_monotonic"]
            and agg["all_done_once"]
            and agg["all_has_audio"]
        )
        agg["pass"] = all_pass
        all_results[name] = agg

        status = "PASS" if all_pass else "FAIL"
        print(
            f"  {name}: coverage={agg['word_coverage_min']:.2%} "
            f"monotonic={agg['all_monotonic']} "
            f"done_ok={agg['all_done_once']} [{status}]"
        )

    return all_results


def main():
    parser = argparse.ArgumentParser(description="Integrity benchmark")
    parser.add_argument("--port", type=int, default=7890)
    args = parser.parse_args()

    print("=== Integrity Benchmark ===")
    results = asyncio.run(run_benchmark(args.port))

    all_pass = all(r["pass"] for r in results.values())
    print(f"\nIntegrity: {'PASS' if all_pass else 'FAIL'}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    exit(main())
