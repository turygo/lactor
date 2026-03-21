"""Run all Python benchmarks and output summary."""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime

BENCHMARK_DIR = os.path.dirname(os.path.abspath(__file__))
REPORTS_DIR = os.path.join(BENCHMARK_DIR, "reports")


def run_bench(name, port):
    """Run a benchmark script and return its exit code."""
    script = os.path.join(BENCHMARK_DIR, f"bench_{name}.py")
    if not os.path.exists(script):
        print(f"  SKIP: {script} not found")
        return -1

    result = subprocess.run(
        [sys.executable, script, "--port", str(port)],
        capture_output=False,
    )
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description="Run all Lactor benchmarks")
    parser.add_argument("--port", type=int, default=7890)
    args = parser.parse_args()

    os.makedirs(REPORTS_DIR, exist_ok=True)

    benchmarks = ["latency", "integrity", "stability", "memory"]
    results = {}
    all_pass = True

    print("=" * 50)
    print("Lactor Benchmark Suite")
    print("=" * 50)
    print()

    for name in benchmarks:
        code = run_bench(name, args.port)
        passed = code == 0
        results[name] = {"exit_code": code, "pass": passed}
        if not passed:
            all_pass = False
        print()

    # Summary
    print("=" * 50)
    print("Summary")
    print("=" * 50)
    for name, r in results.items():
        status = "PASS" if r["pass"] else ("FAIL" if r["exit_code"] >= 0 else "SKIP")
        print(f"  {name:15s} {status}")

    print()
    print(f"Automated: {'PASS' if all_pass else 'FAIL'}")
    print("Note: Frontend memory test (bench_frontend_memory.html) requires manual browser run.")

    # Save report
    report = {
        "timestamp": datetime.now().isoformat(),
        "port": args.port,
        "results": results,
        "overall": "PASS" if all_pass else "FAIL",
    }
    report_path = os.path.join(
        REPORTS_DIR,
        datetime.now().strftime("%Y-%m-%d-%H%M%S") + ".json",
    )
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved to: {report_path}")

    return 0 if all_pass else 1


if __name__ == "__main__":
    exit(main())
