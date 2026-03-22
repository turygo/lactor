/**
 * Minimal pipeline runner for content processing stages.
 * Usage:
 *   const pipeline = createPipeline([sanitize, structure]);
 *   const ctx = pipeline.run(html);
 */

export function createPipeline(stages) {
  return {
    run(html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const ctx = { doc, body: doc.body };
      for (const stage of stages) {
        stage(ctx);
      }
      return ctx;
    },
  };
}
