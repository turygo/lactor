# Extension Pipeline — 内容提取与分段

## Overview

Pipeline 将 HTML 文章内容转换为 typed segments 数组，供 reader 渲染和 TTS 朗读。

```
HTML string → DOMParser → sanitize(ctx) → structure(ctx) → { segments, lang }
```

## Pipeline Runner (`components/pipeline/index.js`)

```js
const pipeline = createPipeline([sanitize, structure]);
const ctx = pipeline.run(htmlString, { lang: "zh" });
// ctx.segments = [{ type, text, html }, ...]
// ctx.lang = "zh"
```

- `run(html, props)`: 将 HTML 解析为 DOM (`DOMParser`)，初始化 `ctx = { doc, body, ...props }`，依次调用每个 stage
- Stage 是 `(ctx) => ctx` 函数，直接修改 ctx 并返回

## Sanitize Stage (`components/pipeline/sanitize.js`)

移除语义噪声和低质量内容块。

**规则：**
1. 移除 `<nav>`, `<aside>`, `[role="navigation"]`, `[role="complementary"]`
2. 跳过 headings（`H1-H6` 永远保留）
3. 跳过含媒体（`img, video, pre, table, figure, svg`）的块
4. 跳过含公式类名（`math`, `katex`, `mathjax`）的块（递归检查子元素）
5. 移除空块（`textContent.trim().length === 0`）
6. 移除链接密度 > 80% 的块
7. 移除链接密度 > 60% 且文本 < 100 字符的块
8. 移除非 heading 的短块（< 30 字符）

## Structure Stage (`components/pipeline/structure.js`)

遍历 DOM 树，产出 typed segments。

### Segment Types

| Type | Tag/Condition | `text` 字段 | `html` 字段 |
|------|--------------|-------------|-------------|
| `text` | Leaf block element | 规范化文本 | `null` |
| `code` | `<pre>` | 本地化占位符 | `outerHTML` |
| `table` | `<table>` | 本地化占位符 | `outerHTML` |
| `image` | `<img>`, `<picture>`, `<video>`, `<audio>` | alt/title 或占位符 | `outerHTML` |
| `formula` | 元素含 `math`/`katex`/`mathjax` 类名 | 本地化占位符 | `outerHTML` |

### Block/Inline 分类

采用 **反向白名单** 策略：定义 `INLINE_TAGS`（HTML 规范默认内联元素），不在白名单中的视为块级。

**Leaf block 启发式：**
- 无块级子元素 → leaf block → 提取文本，产出 `text` segment
- 有块级子元素 → container → 递归遍历
- `<br>` 在提取前替换为分隔符，按 `<br>` 边界拆分文本

### 语言检测 (`resolveLang`)

```
优先级：
1. context.lang（显式传入）→ 标准化为 zh/ja/ko/en
   ├─ 精确匹配 PLACEHOLDERS 键
   ├─ 前缀匹配（zh-TW → zh, ja-JP → ja）
   ├─ CJK_TAG_MAP（cmn → zh, jpn → ja, kor → ko）
   └─ 非 CJK 显式标签（es, fr, de）→ "en"
2. Unicode 启发式（采样前 500 字符）
   ├─ Hangul → "ko"
   ├─ Kana → "ja"
   └─ CJK Ideographs → "zh"
3. 默认 "en"
```

本地化占位符支持 en/zh/ja/ko 四种语言。

## renderSegments (`components/render-segments.js`)

将 segments 数组渲染到 DOM：

- `text` segment → `<p data-para={i}>` + `<span data-word={j} data-char-offset={n}>word</span>`
- 非 text segment → `<div data-para={i} data-segment-type={type}>` + innerHTML
- **URL rebasing**: 处理 `[src]`, `[href]`, `[poster]`, `[srcset]` 属性，基于 `pageUrl` 转换相对路径
- `data-char-offset` 用于 HighlightEngine 的二分查找定位
