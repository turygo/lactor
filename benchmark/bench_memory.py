"""Memory benchmark: backend RSS tracking over long playback."""

import argparse
import asyncio
import json
import os
import time

import websockets

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
VOICE = "en-US-AriaNeural"


def get_rss_mb(pid):
    """Get RSS of a process in MB (macOS/Linux)."""
    try:
        import psutil

        proc = psutil.Process(pid)
        return proc.memory_info().rss / (1024 * 1024)
    except ImportError:
        # Fallback: use ps command
        import subprocess

        result = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)],
            capture_output=True,
            text=True,
        )
        return int(result.stdout.strip()) / 1024  # ps gives KB


def find_server_pid(port):
    """Find the PID of the lactor server on the given port."""
    import subprocess

    result = subprocess.run(
        ["lsof", "-ti", f":{port}"],
        capture_output=True,
        text=True,
    )
    pids = result.stdout.strip().split("\n")
    return int(pids[0]) if pids and pids[0] else None


async def stream_fixture(url, filepath):
    """Stream all paragraphs from a fixture file."""
    with open(filepath) as f:
        text = f.read()

    words = text.split()
    # Split into ~50-word paragraphs
    paragraphs = []
    for i in range(0, len(words), 50):
        paragraphs.append(" ".join(words[i : i + 50]))

    async with websockets.connect(url) as ws:
        for idx, para in enumerate(paragraphs[:20]):  # Limit to 20 paragraphs for speed
            para_id = f"mem-{idx}"
            await ws.send(
                json.dumps(
                    {
                        "action": "speak",
                        "id": para_id,
                        "text": para,
                        "voice": VOICE,
                    }
                )
            )
            while True:
                msg = json.loads(await ws.recv())
                if msg["id"] == para_id and msg["type"] == "done":
                    break


async def run_benchmark(port):
    url = f"ws://localhost:{port}/tts"
    pid = find_server_pid(port)

    if pid is None:
        print("  ERROR: Could not find server PID")
        return {"pass": False, "error": "no PID"}

    baseline_rss = get_rss_mb(pid)
    print(f"  Baseline RSS: {baseline_rss:.1f} MB")

    peak_rss = baseline_rss
    fixture_path = os.path.join(FIXTURES_DIR, "extra-long.txt")
    if not os.path.exists(fixture_path):
        fixture_path = os.path.join(FIXTURES_DIR, "long.txt")

    await stream_fixture(url, fixture_path)
    current_rss = get_rss_mb(pid)
    peak_rss = max(peak_rss, current_rss)
    print(f"  After playback RSS: {current_rss:.1f} MB (peak: {peak_rss:.1f} MB)")

    # Check criteria
    peak_ok = peak_rss < 200
    ratio = current_rss / baseline_rss if baseline_rss > 0 else 999
    ratio_ok = ratio < 1.5

    all_pass = peak_ok and ratio_ok
    print(f"  Peak < 200MB: {'PASS' if peak_ok else 'FAIL'} ({peak_rss:.1f} MB)")
    print(f"  RSS ratio < 1.5x: {'PASS' if ratio_ok else 'FAIL'} ({ratio:.2f}x)")

    return {
        "baseline_mb": baseline_rss,
        "peak_mb": peak_rss,
        "final_mb": current_rss,
        "ratio": ratio,
        "pass": all_pass,
    }


def main():
    parser = argparse.ArgumentParser(description="Memory benchmark")
    parser.add_argument("--port", type=int, default=7890)
    args = parser.parse_args()

    print("=== Memory Benchmark ===")
    results = asyncio.run(run_benchmark(args.port))

    print(f"\nMemory: {'PASS' if results['pass'] else 'FAIL'}")
    return 0 if results["pass"] else 1


if __name__ == "__main__":
    exit(main())
