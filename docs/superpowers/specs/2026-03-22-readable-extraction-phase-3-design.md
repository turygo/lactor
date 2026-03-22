# Readable Extraction Phase 3 Design

**Issue**: #4  
**Date**: 2026-03-22  
**Status**: Draft

## 目标

Phase 3 处理播放体验优化和长期维护问题，而不是正文提取本身。

本阶段包含：

1. voice 列表本地缓存
2. 用户 voice 偏好持久化
3. 必要时精简 `/voices` 返回结构
4. 对前两阶段规则做补充 fixture 和回归测试

## 设计原则

- 体验优化独立于内容提取主链路
- 所有缓存都应可失效、可回退
- 后端接口改造只在前端确有收益时再做

## Voice 缓存

在 `browser.storage.local` 中缓存：

```js
{
  voiceCache: {
    voices: [...],
    timestamp: 1711036800000
  }
}
```

启动时：

1. 优先读缓存
2. 用缓存结果初始化下拉框和默认 voice
3. 后台静默刷新

如果缓存缺失或失效，仍允许走现有在线获取流程，不影响播放功能。

## 用户偏好

用户手动切换 voice 后，按语言持久化：

```js
{
  voicePreferences: {
    en: "en-US-GuyNeural",
    ja: "ja-JP-KeitaNeural"
  }
}
```

`resolveVoice()` 在本阶段扩展为：

1. 优先用户偏好
2. 再走默认映射
3. 再走 locale 前缀匹配
4. 最后回退英文默认 voice

## `/voices` API

只有在前端已经明确受益时，才进行后端 API 微调。

允许的最小改动：

1. 增加 `lang` 查询参数过滤
2. 将 `name` 语义整理为 `id`
3. 增加 UI 友好的 `displayName`

但这不是本阶段的前置条件。若前端缓存和偏好逻辑在现有 API 上已经足够工作，则 API 可以继续保持现状。

## 回归测试

本阶段补足的测试主要是回归和样本覆盖，不是继续扩张核心抽象：

1. voice cache / preference 测试
2. 少量新增 fixture，覆盖不同站点类型
3. 前两阶段关键路径回归

不建议在这个阶段再新建一整套复杂 benchmark 系统，除非后续真的要做提取质量量化比较。

## 文件变更

### 可能新增

- `extension/reader/components/voice-cache.js` 或等价小模块

### 主要修改

- `extension/reader/reader.js`
- `extension/reader/components/controls.js`
- `src/lactor/main.py`（仅当 API 微调确有必要）

## 验收标准

1. Reader 首屏可用性不再被 `/voices` 请求阻塞
2. 用户切换 voice 后，下次打开同语言页面可保持选择
3. 缓存失效、voice 下线、请求失败时都能稳定回退
4. 不影响 Phase 1/2 已完成的正文提取和播放行为
