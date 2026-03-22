# Readable Extraction Phase 2 Design

**Issue**: #4  
**Date**: 2026-03-22  
**Status**: Draft

## 目标

Phase 2 在 Phase 1 的 typed segments 基础上，补上“语言感知的播放选择”，但仍然避免引入存储缓存和后端协议改造。

本阶段包含：

1. 从页面或内容中得到文章语言
2. 根据语言选择更合适的默认 voice
3. 让非文本 segment 的占位符语言跟随文章语言

本阶段不包含：

1. voice 列表缓存
2. 用户 voice 偏好持久化
3. `/voices` 接口结构调整

## 设计原则

- 优先使用已有信息，减少外部依赖
- 允许“够用”的语言推断，不追求高复杂度识别
- 不让语言选择反向污染内容提取 pipeline

## 架构

本阶段继续坚持两层边界：

1. 内容层负责产出 `segments + lang`
2. 播放层负责 `resolveVoice(lang, voices)`

`resolveVoice` 仍在 pipeline 外部，避免内容处理层依赖 voice 列表或 storage。

## 语言来源

首选顺序：

1. `document.documentElement.lang`
2. extractor 传到 reader 的 `data.lang`
3. 内容文本的轻量启发式判断
4. 默认 `en`

这里建议先不引入 `tinyld`。如果后续证明仅靠 `html lang` 覆盖率不足，再单独立项评估第三方检测库。

轻量启发式可以只覆盖当前最常见的几类：

- `zh`
- `ja`
- `ko`
- `en`

判断失败时统一回退 `en`，不阻塞页面加载或播放。

## 占位符策略

非文本 segment 的 `text` 仍为占位符，但占位符根据 `lang` 选择：

```js
{
  en: { code: "Code block.", table: "Table.", image: "Image.", formula: "Formula." },
  zh: { code: "代码块。", table: "表格。", image: "图片。", formula: "公式。" },
  ja: { code: "コードブロック。", table: "テーブル。", image: "画像。", formula: "数式。" },
  ko: { code: "코드 블록.", table: "테이블.", image: "이미지.", formula: "수식." },
}
```

语言表先只支持少量高频语言，不做大而全映射。

## Voice 选择

新增 `resolveVoice(lang, voices)` 纯函数。

决策顺序：

1. 硬编码默认 voice 映射
2. `voices` 列表中按 locale 前缀找第一个匹配项
3. 回退 `en-US-AriaNeural`

因为当前 [后端 voice 列表返回 `name`](/Users/turygo/code/tools/lactor/.worktrees/4-optimize-readable-extraction/src/lactor/main.py#L57)，本阶段不改 API 结构，前端仍沿用当前字段，减少联动修改。

## 文件变更

### 新增

- `extension/reader/components/resolve-voice.js`

### 修改

- `extension/content/extractor.js`
- `extension/reader/components/pipeline/structure.js`
- `extension/reader/reader.js`
- `extension/reader/components/controls.js`（仅做最小联动）

## 测试策略

本阶段增加两类测试：

1. `resolve-voice.test.js`
2. `detect-lang` 或等效轻量语言推断测试

测试重点不是“语言识别精度 benchmark”，而是：

- 有 `lang` 时优先使用
- 无 `lang` 时回退稳定
- voice 选择逻辑在缺少匹配项时可预测

## 验收标准

满足以下条件即可进入 Phase 3：

1. 中文、日文、韩文、英文页面能选到合理默认 voice
2. 非文本占位符语言与文章语言一致
3. 没有因为语言逻辑引入新的初始化阻塞
4. 现有后端 API 和播放协议保持兼容
