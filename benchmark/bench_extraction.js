/**
 * Extraction quality benchmark.
 *
 * Runs Defuddle + sanitize/structure pipeline on HTML fixtures and scores:
 *   - noise_ratio:     fraction of output segments that look like noise
 *   - content_kept:    whether key content paragraphs survived extraction
 *   - segment_count:   total segments produced
 *   - text_segments:   text-type segments
 *   - non_text:        non-text segments (code/table/image/formula)
 *   - empty_segments:  segments with empty text (should be 0)
 *
 * Usage:
 *   node benchmark/bench_extraction.js
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { JSDOM } from "jsdom";

// ── Load Defuddle in a way that works with its IIFE format ──────────────────

const defuddleSrc = readFileSync(
  join(import.meta.dirname, "../extension/lib/defuddle.min.js"),
  "utf-8"
);

// ── Import pipeline stages ──────────────────────────────────────────────────

import { sanitize } from "../extension/reader/components/pipeline/sanitize.js";
import { structure } from "../extension/reader/components/pipeline/structure.js";

// ── Noise detection heuristics ──────────────────────────────────────────────

const NOISE_PATTERNS = [
  /^(subscribe|sign up|newsletter|follow us|share|copyright|©|all rights reserved)/i,
  /^(advertisement|sponsored|promoted|ad\b)/i,
  /^(cookie|privacy policy|terms of (service|use))/i,
  /^(read more|see also|related articles|trending|popular|recommended)/i,
  /^(login|log in|sign in|create account|register)\b/i,
  /^(download|install)\s+(the\s+)?app/i,
  /^\d+\s*(comments?|replies|shares?|likes?|views?|claps?)\s*$/i,
  /^(skip to|jump to|back to top)/i,
  /^(menu|navigation|search)\s*$/i,
  /^[_\-=*·•]{3,}$/,
];

function isNoise(text) {
  const t = text.trim();
  return NOISE_PATTERNS.some((re) => re.test(t));
}

// ── Run extraction on a single fixture ──────────────────────────────────────

function runExtraction(htmlPath) {
  const html = readFileSync(htmlPath, "utf-8");

  // 1. Parse with JSDOM and run Defuddle
  // Strip <style> blocks to avoid jsdom cssstyle crash on complex CSS
  const cleanHtml = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  const dom = new JSDOM(cleanHtml, { url: "https://example.com" });
  const { window } = dom;
  const { document } = window;

  // Evaluate Defuddle in this window context
  const script = new window.Function(
    defuddleSrc + "\nreturn typeof Defuddle !== 'undefined' ? Defuddle : DefuddleLib?.Defuddle;"
  );
  const DefuddleClass = script.call(window);

  if (!DefuddleClass) {
    return { error: "Defuddle not loaded" };
  }

  let defuddleResult;
  try {
    defuddleResult = new DefuddleClass(document).parse();
  } catch (err) {
    return { error: `Defuddle parse error: ${err.message}` };
  }

  if (!defuddleResult || !defuddleResult.content) {
    return { error: "Defuddle returned empty content" };
  }

  // 2. Run sanitize + structure pipeline
  const pipelineDom = new JSDOM(
    `<!DOCTYPE html><html><body>${defuddleResult.content}</body></html>`
  );
  const pipelineDoc = pipelineDom.window.document;
  const ctx = {
    doc: pipelineDoc,
    body: pipelineDoc.body,
    lang: defuddleResult.language || "",
  };

  sanitize(ctx);
  structure(ctx);

  // 3. Analyze segments
  const segments = ctx.segments || [];
  const textSegments = segments.filter((s) => s.type === "text");
  const nonTextSegments = segments.filter((s) => s.type !== "text");
  const emptySegments = segments.filter((s) => !s.text || s.text.trim() === "");
  const noiseSegments = textSegments.filter((s) => isNoise(s.text));

  const totalChars = textSegments.reduce((sum, s) => sum + s.text.length, 0);
  const noiseChars = noiseSegments.reduce((sum, s) => sum + s.text.length, 0);

  return {
    title: defuddleResult.title || "(no title)",
    lang: ctx.lang,
    segment_count: segments.length,
    text_segments: textSegments.length,
    non_text: nonTextSegments.length,
    empty_segments: emptySegments.length,
    noise_segments: noiseSegments.length,
    noise_ratio: totalChars > 0 ? +(noiseChars / totalChars).toFixed(4) : 0,
    total_chars: totalChars,
    // Sample: first 5 and last 5 text segments for manual review
    sample_head: textSegments.slice(0, 5).map((s) => s.text.slice(0, 120)),
    sample_tail: textSegments.slice(-5).map((s) => s.text.slice(0, 120)),
    noise_samples: noiseSegments.slice(0, 10).map((s) => s.text.slice(0, 120)),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

const fixtureDir = join(import.meta.dirname, "fixtures/html");
const files = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".html"))
  .sort();

// Known limitations — pages that are not articles (feeds, homepages, etc.)
// These are still extracted and reported but excluded from the average score.
const KNOWN_LIMITATIONS = new Set(["zh-zhihu-home"]);

console.log(`\n=== Extraction Quality Benchmark ===\n`);
console.log(`Fixtures: ${files.length}\n`);

const results = {};
let totalScore = 0;
let scoredCount = 0;

// Weights for weighted average
const WEIGHTS = {
  noise_ratio: 30, // lower is better → score = (1 - noise_ratio) * weight
  empty_ratio: 20, // lower is better → score = (1 - empty_ratio) * weight
  content_density: 30, // higher is better → score based on chars per segment
  segment_quality: 20, // basic quality: has title, has segments, no errors
};

for (const file of files) {
  const path = join(fixtureDir, file);
  const name = basename(file, ".html");
  console.log(`── ${name} ──`);

  const result = runExtraction(path);
  results[name] = result;

  if (result.error) {
    console.log(`  ERROR: ${result.error}\n`);
    continue;
  }

  // Calculate component scores (0-100 each)
  const noiseScore = (1 - result.noise_ratio) * 100;
  const emptyRatio = result.segment_count > 0 ? result.empty_segments / result.segment_count : 0;
  const emptyScore = (1 - emptyRatio) * 100;

  // Content density: avg chars per text segment (target: 50-200 is ideal)
  const avgChars = result.text_segments > 0 ? result.total_chars / result.text_segments : 0;
  const densityScore = Math.min(100, (avgChars / 80) * 100);

  // Quality: has title + has segments + reasonable count
  let qualityScore = 0;
  if (result.title && result.title !== "(no title)") qualityScore += 40;
  if (result.segment_count > 0) qualityScore += 30;
  if (result.text_segments >= 3) qualityScore += 30;

  const weighted =
    (noiseScore * WEIGHTS.noise_ratio +
      emptyScore * WEIGHTS.empty_ratio +
      densityScore * WEIGHTS.content_density +
      qualityScore * WEIGHTS.segment_quality) /
    100;

  const isLimitation = KNOWN_LIMITATIONS.has(name);
  if (!isLimitation) {
    totalScore += weighted;
    scoredCount++;
  }

  console.log(`  Title:    ${result.title}`);
  console.log(`  Lang:     ${result.lang}`);
  console.log(
    `  Segments: ${result.segment_count} (text: ${result.text_segments}, non-text: ${result.non_text}, empty: ${result.empty_segments})`
  );
  console.log(
    `  Noise:    ${result.noise_segments} segments (${(result.noise_ratio * 100).toFixed(1)}% by chars)`
  );
  console.log(`  Chars:    ${result.total_chars.toLocaleString()}`);
  console.log(
    `  Score:    ${weighted.toFixed(1)} (noise: ${noiseScore.toFixed(0)}, empty: ${emptyScore.toFixed(0)}, density: ${densityScore.toFixed(0)}, quality: ${qualityScore.toFixed(0)})${isLimitation ? " [known limitation — excluded from average]" : ""}`
  );
  if (result.noise_samples.length > 0) {
    console.log(`  Noise samples:`);
    for (const s of result.noise_samples.slice(0, 3)) {
      console.log(`    - "${s}"`);
    }
  }
  console.log();
}

const avgScore = scoredCount > 0 ? totalScore / scoredCount : 0;
console.log(`\n=== Weighted Average Score: ${avgScore.toFixed(1)} / 100 ===`);
if (KNOWN_LIMITATIONS.size > 0) {
  console.log(
    `    (${KNOWN_LIMITATIONS.size} known limitation(s) excluded: ${[...KNOWN_LIMITATIONS].join(", ")})`
  );
}
console.log();

// Save report
mkdirSync(join(import.meta.dirname, "reports"), { recursive: true });
const report = {
  timestamp: new Date().toISOString(),
  fixture_count: files.length,
  scored_count: scoredCount,
  known_limitations: [...KNOWN_LIMITATIONS],
  weighted_average: +avgScore.toFixed(1),
  results,
};

const reportPath = join(import.meta.dirname, "reports/extraction_quality.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Report saved to ${reportPath}`);
