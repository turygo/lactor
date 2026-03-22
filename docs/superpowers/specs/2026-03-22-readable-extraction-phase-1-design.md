# Readable Extraction Phase 1 Design

**Issue**: #4  
**Date**: 2026-03-22  
**Status**: Draft

## 目标

Phase 1 只解决一个核心问题：让 Reader 页面显示更干净的正文，并在不破坏当前播放链路的前提下保留基础的非文本内容展示能力。

本阶段包含：

1. 过滤导航、侧栏、碎片元数据等明显噪音
2. 将提取结果从“纯文本段落数组”升级为“typed segments”
3. 支持 `text / code / table / image / formula` 的基础渲染
4. 保持现有 TTS / scheduler / player 主链路尽量不变

本阶段不包含：

1. 语言检测库引入
2. 自动语音匹配
3. voice 缓存与偏好持久化
4. 后端 `/voices` API 改造

## 设计原则

- 先收敛正文提取质量，再做播放体验优化
- 复用现有 reader 架构，不为了“可插拔”而引入过多新层
- 对当前代码库保持低侵入，避免同时改动前后端和存储模型
- 非文本内容优先做到“可见且不破坏播放”，暂不追求复杂交互

## 架构

本阶段仍保持现有两层边界：

1. 内容处理层：从 Defuddle HTML 得到可渲染、可朗读的 segments
2. 播放层：继续由 `reader.js + scheduler + player + highlight` 负责播放调度

与旧实现相比，唯一重要变化是：`splitIntoParagraphs(html)` 不再直接输出 `string[]`，而是改为输出：

```js
[
  { type: "text", text: "Paragraph text", html: null },
  { type: "code", text: "Code block.", html: "<pre><code>...</code></pre>" },
];
```

TTS、调度和 buffer 仍然消费 `segments.map((segment) => segment.text)`，因此播放主链路无需重写。

## 内容处理

### 1. Sanitize

先在 DOM 上做高置信噪音过滤：

- 删除 `nav, aside`
- 删除 `[role="navigation"], [role="complementary"]`
- 对 `body` 顶层块做轻量内容评分

评分规则保持保守：

- 空块删除
- 高链接密度且短文本删除
- 极高链接密度删除
- 很短且不是标题的块删除

这里的目标不是“一步提纯所有页面”，而是先把 Defuddle 明显漏过的站点导航、推荐列表、阅读时长等碎片去掉。

### 2. Structure

将清洗后的 DOM 转成 typed segments。

规则：

- `p, h1-h6, blockquote, li` -> `text`
- `pre`, `table`, `img`, 公式容器 -> 对应非文本类型
- 容器节点递归进入
- 空文本 segment 丢弃

本阶段允许结构规则保持简单，不引入复杂 `meta` 设计；首版只保留：

```js
{
  type: "text" | "code" | "table" | "image" | "formula",
  text: string,
  html: string | null,
}
```

`meta` 不是首版必需项，避免提前抽象。

## Reader 渲染

新增 `renderSegments()` 替代 `renderParagraphs()`。

渲染规则：

- `text`：继续拆词渲染为 span，支持逐词高亮
- 非 `text`：渲染原始安全 HTML，容器使用 `<div>`

所有 segment 统一带：

- `data-para`
- `data-segment-type`

这样现有调度仍然按索引工作，只需要把硬编码的 `p[data-para]` 迁移为 `[data-para]`。

## 高亮策略

保留现有 `HighlightEngine` 的逐词高亮模型，只增加一条分支：

- `text` segment：按现有逻辑高亮词 span
- 非 `text` segment：整段容器加一个 active class

这样不会引入新的时间线模型，也不需要改 scheduler。

## 文件变更

### 新增

- `extension/reader/components/pipeline/index.js`
- `extension/reader/components/pipeline/sanitize.js`
- `extension/reader/components/pipeline/structure.js`
- `extension/reader/components/render-segments.js`

### 修改

- `extension/reader/reader.js`
- `extension/reader/components/normalizer.js`
- `extension/reader/components/highlight.js`
- `extension/reader/reader.css`

## 测试策略

本阶段只覆盖最关键的低风险测试：

1. `sanitize.test.js`
2. `structure.test.js`
3. `render-segments.test.js`

fixture 数量保持小而精，优先用 2 到 3 个代表性 HTML 样本，不建立大规模 benchmark corpus。

## 验收标准

满足以下条件即可进入 Phase 2：

1. Reader 页面中的明显导航和推荐噪音显著减少
2. 正文段落、标题、引用仍能正常显示和朗读
3. 代码块、表格、图片等至少能显示，不会破坏段落索引与播放
4. 现有播放、预取、逐词高亮主流程不回退
