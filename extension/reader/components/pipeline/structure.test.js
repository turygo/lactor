import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;

const { structure } = await import("./structure.js");

/** Helper: build a context from an HTML string. */
function ctx(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { doc, body: doc.body };
}

describe("structure", () => {
  // ── Text extraction (leaf-block heuristic) ───────────────────

  it("converts <p> to text segment", () => {
    const c = ctx("<p>Hello world</p>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.deepEqual(c.segments[0], { type: "text", text: "Hello world", html: null });
  });

  it("converts <h1> through <h6> to text segments", () => {
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      const c = ctx(`<${tag}>Heading</${tag}>`);
      structure(c);
      assert.equal(c.segments.length, 1, `expected 1 segment for <${tag}>`);
      assert.equal(c.segments[0].type, "text");
      assert.equal(c.segments[0].text, "Heading");
    }
  });

  it("converts <blockquote> to text segment", () => {
    const c = ctx("<blockquote>Quoted text</blockquote>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "text");
    assert.equal(c.segments[0].text, "Quoted text");
  });

  it("converts <li> to text segment", () => {
    const c = ctx("<ul><li>Item one</li></ul>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "text");
    assert.equal(c.segments[0].text, "Item one");
  });

  it("converts <figcaption> to text segment (no hardcoded tag needed)", () => {
    const c = ctx("<figure><img><figcaption>Caption text</figcaption></figure>");
    structure(c);
    const textSegs = c.segments.filter((s) => s.type === "text");
    assert.equal(textSegs.length, 1);
    assert.equal(textSegs[0].text, "Caption text");
  });

  it("handles any unknown/custom block element as text leaf", () => {
    const c = ctx("<my-widget>Custom element content</my-widget>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "text");
    assert.equal(c.segments[0].text, "Custom element content");
  });

  it("handles <address>, <dd>, <dt>, <summary> without hardcoding", () => {
    const c = ctx("<address>123 Main St</address><dl><dt>Term</dt><dd>Definition</dd></dl>");
    structure(c);
    const texts = c.segments.map((s) => s.text);
    assert.ok(texts.includes("123 Main St"));
    assert.ok(texts.includes("Term"));
    assert.ok(texts.includes("Definition"));
  });

  // ── <br> splitting ───────────────────────────────────────────

  it("splits text at <br> boundaries", () => {
    const c = ctx("<div>Line one<br>Line two<br>Line three</div>");
    structure(c);
    assert.equal(c.segments.length, 3);
    assert.equal(c.segments[0].text, "Line one");
    assert.equal(c.segments[1].text, "Line two");
    assert.equal(c.segments[2].text, "Line three");
  });

  it("splits at consecutive <br><br> and discards empty parts", () => {
    const c = ctx("<div>Para one<br><br>Para two</div>");
    structure(c);
    assert.equal(c.segments.length, 2);
    assert.equal(c.segments[0].text, "Para one");
    assert.equal(c.segments[1].text, "Para two");
  });

  it("handles figcaption with <br> (Zhihu answer pattern)", () => {
    const c = ctx(
      "<figure><img><figcaption>First paragraph.<br><br>Second paragraph.<br><br>Third.</figcaption></figure>"
    );
    structure(c);
    const textSegs = c.segments.filter((s) => s.type === "text");
    assert.equal(textSegs.length, 3);
    assert.equal(textSegs[0].text, "First paragraph.");
    assert.equal(textSegs[1].text, "Second paragraph.");
    assert.equal(textSegs[2].text, "Third.");
  });

  // ── Special types ────────────────────────────────────────────

  it("converts <pre><code> to code segment", () => {
    const c = ctx("<pre><code>const x = 1;</code></pre>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "code");
    assert.equal(c.segments[0].text, "Code block.");
    assert.ok(c.segments[0].html.includes("<pre>"));
  });

  it("converts <table> to table segment", () => {
    const c = ctx("<table><tr><td>Cell</td></tr></table>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "table");
    assert.equal(c.segments[0].text, "Table.");
  });

  it("converts <img> to image segment with alt text", () => {
    const c = ctx('<img alt="photo">');
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "image");
    assert.equal(c.segments[0].text, "photo");
  });

  it("converts <img> without alt to image segment with fallback", () => {
    const c = ctx("<img>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "image");
    assert.equal(c.segments[0].text, "Image.");
  });

  it("converts formula container to formula segment", () => {
    const c = ctx('<span class="math">x^2</span>');
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].type, "formula");
    assert.equal(c.segments[0].text, "Formula.");
  });

  // ── Container recursion ──────────────────────────────────────

  it("recurses into container divs", () => {
    const c = ctx("<div><p>Inside div</p></div>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "Inside div");
  });

  it("recurses into nested divs with direct text", () => {
    const c = ctx("<div><div>Para one</div><div>Para two</div></div>");
    structure(c);
    assert.equal(c.segments.length, 2);
    assert.equal(c.segments[0].text, "Para one");
    assert.equal(c.segments[1].text, "Para two");
  });

  it("recurses into <a> wrapping block elements", () => {
    const c = ctx('<a href="#"><p>Link paragraph</p></a>');
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "Link paragraph");
  });

  // ── Filtering ────────────────────────────────────────────────

  it("skips empty text elements", () => {
    const c = ctx("<p>   </p><p>Real content</p>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "Real content");
  });

  it("skips script and style elements", () => {
    const c = ctx("<script>alert(1)</script><style>body{}</style><p>Visible</p>");
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "Visible");
  });

  it("skips SVG elements", () => {
    const c = ctx('<svg viewBox="0 0 1 1"><rect/></svg><p>After SVG</p>');
    structure(c);
    assert.equal(c.segments.length, 1);
    assert.equal(c.segments[0].text, "After SVG");
  });

  // ── Ordering and mixed content ───────────────────────────────

  it("returns segments in document order", () => {
    const c = ctx("<h1>Title</h1><p>First</p><p>Second</p>");
    structure(c);
    assert.equal(c.segments.length, 3);
    assert.equal(c.segments[0].text, "Title");
    assert.equal(c.segments[1].text, "First");
    assert.equal(c.segments[2].text, "Second");
  });

  it("mixed segments produce correct output", () => {
    const html = [
      "<h2>Intro</h2>",
      "<p>Paragraph one.</p>",
      "<pre><code>let a = 1;</code></pre>",
      '<img alt="diagram">',
      "<table><tr><td>data</td></tr></table>",
      '<div class="math">E=mc^2</div>',
      "<blockquote>A quote</blockquote>",
    ].join("");
    const c = ctx(html);
    structure(c);

    assert.equal(c.segments.length, 7);
    assert.equal(c.segments[0].type, "text");
    assert.equal(c.segments[1].type, "text");
    assert.equal(c.segments[2].type, "code");
    assert.equal(c.segments[3].type, "image");
    assert.equal(c.segments[4].type, "table");
    assert.equal(c.segments[5].type, "formula");
    assert.equal(c.segments[6].type, "text");
  });

  it("returns context for chaining", () => {
    const c = ctx("<p>Test</p>");
    const result = structure(c);
    assert.equal(result, c);
  });

  // ── Language resolution ──────────────────────────────────────

  describe("language resolution", () => {
    // Default (English) — backward compatibility
    it("sets context.lang to 'en' when not specified", () => {
      const c = ctx("<p>Hello world</p>");
      structure(c);
      assert.equal(c.lang, "en");
    });

    it("keeps English placeholders when lang is not set and content is ASCII", () => {
      const c = ctx("<pre><code>const x = 1;</code></pre>");
      structure(c);
      assert.equal(c.segments[0].text, "Code block.");
    });

    // Explicit lang — Chinese
    it("uses Chinese placeholders when context.lang is 'zh'", () => {
      const c = ctx("<pre><code>代码</code></pre><table><tr><td>数据</td></tr></table>");
      c.lang = "zh";
      structure(c);
      assert.equal(c.segments[0].text, "代码块。");
      assert.equal(c.segments[1].text, "表格。");
    });

    it("uses Chinese image placeholder when lang is 'zh' and img has no alt", () => {
      const c = ctx("<img>");
      c.lang = "zh";
      structure(c);
      assert.equal(c.segments[0].text, "图片。");
    });

    it("uses Chinese formula placeholder when lang is 'zh'", () => {
      const c = ctx('<span class="math">x^2</span>');
      c.lang = "zh";
      structure(c);
      assert.equal(c.segments[0].text, "公式。");
    });

    it("uses Chinese media placeholder when lang is 'zh' and video has no title", () => {
      const c = ctx("<video></video>");
      c.lang = "zh";
      structure(c);
      assert.equal(c.segments[0].text, "媒体。");
    });

    it("still uses alt text for img even when lang is 'zh'", () => {
      const c = ctx('<img alt="照片">');
      c.lang = "zh";
      structure(c);
      assert.equal(c.segments[0].text, "照片");
    });

    it("still uses title for video even when lang is 'zh'", () => {
      const c = ctx('<video title="演示视频"></video>');
      c.lang = "zh";
      structure(c);
      assert.equal(c.segments[0].text, "演示视频");
    });

    // Explicit lang — Japanese
    it("uses Japanese placeholders when context.lang is 'ja'", () => {
      const c = ctx("<pre><code>コード</code></pre><table><tr><td>データ</td></tr></table>");
      c.lang = "ja";
      structure(c);
      assert.equal(c.segments[0].text, "コードブロック。");
      assert.equal(c.segments[1].text, "表。");
    });

    it("uses Japanese image placeholder when lang is 'ja'", () => {
      const c = ctx("<img>");
      c.lang = "ja";
      structure(c);
      assert.equal(c.segments[0].text, "画像。");
    });

    it("uses Japanese formula placeholder when lang is 'ja'", () => {
      const c = ctx('<span class="math">x^2</span>');
      c.lang = "ja";
      structure(c);
      assert.equal(c.segments[0].text, "数式。");
    });

    it("uses Japanese media placeholder when lang is 'ja'", () => {
      const c = ctx("<video></video>");
      c.lang = "ja";
      structure(c);
      assert.equal(c.segments[0].text, "メディア。");
    });

    // Explicit lang — Korean
    it("uses Korean placeholders when context.lang is 'ko'", () => {
      const c = ctx("<pre><code>코드</code></pre><table><tr><td>데이터</td></tr></table>");
      c.lang = "ko";
      structure(c);
      assert.equal(c.segments[0].text, "코드 블록.");
      assert.equal(c.segments[1].text, "표.");
    });

    it("uses Korean image placeholder when lang is 'ko'", () => {
      const c = ctx("<img>");
      c.lang = "ko";
      structure(c);
      assert.equal(c.segments[0].text, "이미지.");
    });

    it("uses Korean formula placeholder when lang is 'ko'", () => {
      const c = ctx('<span class="math">x^2</span>');
      c.lang = "ko";
      structure(c);
      assert.equal(c.segments[0].text, "수식.");
    });

    it("uses Korean media placeholder when lang is 'ko'", () => {
      const c = ctx("<video></video>");
      c.lang = "ko";
      structure(c);
      assert.equal(c.segments[0].text, "미디어.");
    });

    // Prefix matching for lang subtags
    it("resolves 'zh-TW' to zh placeholders", () => {
      const c = ctx("<pre><code>繁體中文</code></pre>");
      c.lang = "zh-TW";
      structure(c);
      assert.equal(c.segments[0].text, "代码块。");
    });

    it("resolves 'zh-Hans' to zh placeholders", () => {
      const c = ctx("<pre><code>简体中文</code></pre>");
      c.lang = "zh-Hans";
      structure(c);
      assert.equal(c.segments[0].text, "代码块。");
    });

    it("resolves 'ja-JP' to ja placeholders", () => {
      const c = ctx("<pre><code>日本語</code></pre>");
      c.lang = "ja-JP";
      structure(c);
      assert.equal(c.segments[0].text, "コードブロック。");
    });

    it("resolves 'ko-KR' to ko placeholders", () => {
      const c = ctx("<pre><code>한국어</code></pre>");
      c.lang = "ko-KR";
      structure(c);
      assert.equal(c.segments[0].text, "코드 블록.");
    });

    it("stores resolved lang on context (e.g. 'zh-TW' → context.lang becomes 'zh')", () => {
      const c = ctx("<p>Hello</p>");
      c.lang = "zh-TW";
      structure(c);
      assert.equal(c.lang, "zh");
    });

    it("stores resolved lang on context (e.g. 'ja-JP' → context.lang becomes 'ja')", () => {
      const c = ctx("<p>Hello</p>");
      c.lang = "ja-JP";
      structure(c);
      assert.equal(c.lang, "ja");
    });

    // Character heuristics — CJK detection when lang is absent
    it("detects Chinese from body text when lang is absent (CJK ideographs, no kana)", () => {
      const c = ctx(
        "<p>这是一篇关于技术的文章，包含很多汉字内容。</p><pre><code>代码</code></pre>"
      );
      structure(c);
      assert.equal(c.lang, "zh");
      assert.equal(c.segments[1].text, "代码块。");
    });

    it("detects Japanese from body text when lang is absent (contains hiragana/katakana)", () => {
      const c = ctx(
        "<p>これは日本語の記事です。とても面白いと思います。</p><pre><code>コード</code></pre>"
      );
      structure(c);
      assert.equal(c.lang, "ja");
      assert.equal(c.segments[1].text, "コードブロック。");
    });

    it("detects Korean from body text when lang is absent (contains Hangul)", () => {
      const c = ctx(
        "<p>이것은 한국어 기사입니다. 매우 흥미롭습니다.</p><pre><code>코드</code></pre>"
      );
      structure(c);
      assert.equal(c.lang, "ko");
      assert.equal(c.segments[1].text, "코드 블록.");
    });

    it("defaults to 'en' for Latin content without lang", () => {
      const c = ctx(
        "<p>This is an English article with no CJK content.</p><pre><code>x</code></pre>"
      );
      structure(c);
      assert.equal(c.lang, "en");
      assert.equal(c.segments[1].text, "Code block.");
    });

    it("unknown lang tag falls back to 'en' placeholders", () => {
      const c = ctx("<pre><code>código</code></pre>");
      c.lang = "es";
      structure(c);
      assert.equal(c.lang, "en");
      assert.equal(c.segments[0].text, "Code block.");
    });

    it("non-CJK lang tag does not fall through to heuristics (e.g. 'es' page with CJK quotes)", () => {
      const c = ctx("<p>中文引用内容</p><pre><code>x</code></pre>");
      c.lang = "es";
      structure(c);
      assert.equal(c.lang, "en");
      assert.equal(c.segments[1].text, "Code block.");
    });

    // ── CJK-family ISO 639-3 tags ──────────────────────────────

    it("resolves 'cmn-Hans' to zh placeholders", () => {
      const c = ctx("<pre><code>x</code></pre>");
      c.lang = "cmn-Hans";
      structure(c);
      assert.equal(c.lang, "zh");
      assert.equal(c.segments[0].text, "代码块。");
    });

    it("resolves 'yue-Hant' to zh placeholders", () => {
      const c = ctx("<table><tr><td>x</td></tr></table>");
      c.lang = "yue-Hant";
      structure(c);
      assert.equal(c.lang, "zh");
      assert.equal(c.segments[0].text, "表格。");
    });

    it("resolves 'jpn' to ja placeholders", () => {
      const c = ctx("<pre><code>x</code></pre>");
      c.lang = "jpn";
      structure(c);
      assert.equal(c.lang, "ja");
      assert.equal(c.segments[0].text, "コードブロック。");
    });

    it("resolves 'kor' to ko placeholders", () => {
      const c = ctx("<pre><code>x</code></pre>");
      c.lang = "kor";
      structure(c);
      assert.equal(c.lang, "ko");
      assert.equal(c.segments[0].text, "코드 블록.");
    });

    // ── Undetermined / multiple tags → heuristics ───────────────

    it("'und' falls through to heuristics and detects CJK", () => {
      const c = ctx("<p>这是中文内容</p><pre><code>x</code></pre>");
      c.lang = "und";
      structure(c);
      assert.equal(c.lang, "zh");
      assert.equal(c.segments[1].text, "代码块。");
    });

    it("'mul' falls through to heuristics and detects Japanese", () => {
      const c = ctx("<p>これはテスト</p><pre><code>x</code></pre>");
      c.lang = "mul";
      structure(c);
      assert.equal(c.lang, "ja");
      assert.equal(c.segments[1].text, "コードブロック。");
    });

    it("'und' with no CJK content defaults to 'en'", () => {
      const c = ctx("<p>Hello world</p><pre><code>x</code></pre>");
      c.lang = "und";
      structure(c);
      assert.equal(c.lang, "en");
      assert.equal(c.segments[1].text, "Code block.");
    });
  });
});
