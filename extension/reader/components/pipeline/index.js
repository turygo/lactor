/**
 * Minimal pipeline runner for content processing stages.
 * Usage:
 *   const pipeline = createPipeline([sanitize, structure]);
 *   const ctx = pipeline.run(html);
 */

export function createPipeline(stages) {
  return {
    run(html, props = {}) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const ctx = { doc, body: doc.body, ...props };
      for (const stage of stages) {
        stage(ctx);
      }
      return ctx;
    },
  };
}
