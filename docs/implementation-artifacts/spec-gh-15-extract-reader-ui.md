---
title: '提取 ReaderUI 层 + 拆分 playFromParagraph'
type: 'refactor'
created: '2026-03-26'
status: 'done'
baseline_commit: '284c6a9'
context: ['docs/ref/extension-playback.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** reader-core 直接操作 DOM（querySelectorAll、style.display、classList、createElement），违反 DI 原则，导致测试必须构造 JSDOM HTML。同时 `playFromParagraph` 在 ~80 行内混合了 DOM 操作、缓冲获取、音频解码播放、高亮同步、循环控制 5 个关注点，难以阅读和独立测试。

**Approach:** 1) 提取 `createReaderUI` 模块封装全部 DOM 操作，reader-core 通过 `deps.ui` 接口调用；2) 将 `playFromParagraph` 拆分为 `playSingleSegment`（单段生命周期）+ 纯循环驱动。

## Boundaries & Constraints

**Always:**
- `createReaderUI` 遵循项目 DI 模式：工厂函数，不引入 singleton
- reader-core 重构后不直接引用任何 DOM API（document、querySelector、classList、style）
- `deps.dom` 拆为 `deps.ui`（UI 接口）+ `deps.env`（window/location）
- `renderSegments` 作为构造参数注入 `createReaderUI`，reader-core 只调 `ui.renderContent()`
- 现有外部 API（init、cleanup）和行为不变

**Ask First:**
- 无

**Never:**
- 不改变状态机、WS 协议、player/scheduler/highlight 内部实现
- 不改变 Controls 的接口

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| showError | 任意错误消息 | 隐藏 loading、显示 error 文案 | N/A |
| markCurrent | paraIndex=3 | 清除所有 .current-para、给 [data-para="3"] 加 .current-para | paraEl 不存在时静默跳过 |
| markPlayed | paraIndex=3 | 移除 .current-para、加 .played | paraEl 不存在时静默跳过 |
| renderContent | segments + url | 调用 renderSegments 写入 contentEl | N/A |
| setTitle | "Test" | 创建 h1 并 prepend 到 contentEl | 空 title 时不创建 |
| playSingleSegment 正常 | 有 audio buffer | markCurrent → 缓冲 → 解码 → 播放 → markPlayed → 返回 shouldContinue | N/A |
| playSingleSegment 空 buffer | 无 audio chunks | markCurrent → 缓冲 → 跳过 → 返回 { skipped: true } | N/A |
| playSingleSegment decode 失败 | decodeAudio 抛异常 | 状态机 error→cancel → 返回 shouldContinue | log.error |

</frozen-after-approval>

## Code Map

- `extension/reader/components/reader-ui.js` -- 新建：DOM 操作封装（7 个方法）
- `extension/reader/components/reader-ui.test.js` -- 新建：JSDOM 测试 DOM 操作正确性
- `extension/reader/reader-core.js` -- 重构：deps.dom → deps.ui + deps.env，提取 playSingleSegment
- `extension/reader/reader-core.test.js` -- 简化：mock UI 替代 JSDOM HTML 构造
- `extension/reader/reader.js` -- 更新：组装 createReaderUI 并注入

## Tasks & Acceptance

**Execution:**
- [x] `extension/reader/components/reader-ui.js` -- 创建 `createReaderUI({ contentEl, loadingEl, errorEl, document, renderSegments })`，7 个方法
- [x] `extension/reader/components/reader-ui.test.js` -- 12 个 JSDOM 测试覆盖全部方法 + 边界情况
- [x] `extension/reader/reader-core.js` -- deps.dom → deps.ui + deps.env；提取 playSingleSegment，playFromParagraph 变为 ~15 行循环驱动
- [x] `extension/reader/reader-core.test.js` -- mock UI 替代 JSDOM HTML，移除 jsdom 依赖，43 个测试全部通过
- [x] `extension/reader/reader.js` -- 导入 createReaderUI，组装真实 DOM 实现注入 deps.ui

**Acceptance Criteria:**
- Given reader-core, when 搜索 `querySelector|classList|style\.display|createElement`, then 零匹配
- Given createReaderUI, when 调用 markCurrent(3), then [data-para="3"] 有 .current-para 且其他段落无此 class
- Given createReaderUI, when 调用 markPlayed(3), then [data-para="3"] 无 .current-para 且有 .played
- Given playSingleSegment, when buffer 有 audio, then 返回 { shouldContinue: boolean }
- Given playSingleSegment, when buffer 为空, then 跳过并返回 { skipped: true }
- Given 所有测试, when 运行 `node --test extension/**/*.test.js`, then 全部通过

## Verification

**Commands:**
- `node --test extension/**/*.test.js` -- expected: 全部通过
- `npx eslint extension` -- expected: 无错误
