# Extension Playback — 播放、高亮、预取、语音

## PrefetchScheduler (`components/scheduler.js`)

自适应预取调度器，管理双 WS 连接的并发请求。

### 核心状态

- `_connBusy[0], _connBusy[1]` — 每个连接当前处理的段落索引（null = 空闲）
- `_bufferedCount` — 已完成但未播放的段落数
- `_nextFetchIndex` — 下一个待请求的段落索引
- `metrics` — `MetricsTracker` 滑动窗口（最近 5 个样本的 ms/char 速率）

### 调度决策 (`shouldPrefetch(remainingPlaybackMs)`)

```
返回 false 的条件（任一满足）：
1. 所有段落已调度
2. 无空闲连接
3. inflight + buffered >= maxBuffer (默认 3)

返回 true 的条件（按序检查）：
4. inflight + buffered === 0 → 冷启动，立即预取
5. 预估生成时间 > 剩余播放时间 × 80% → 触发预取
```

### 重连恢复 (`resetConnections`)

WS 断线重连后调用，回退 `_nextFetchIndex` 到丢失的 in-flight 段落，清空连接忙碌状态，保留 metrics 和 buffered count。

## Player (`components/player.js`)

Web Audio API 封装。

- `decodeAudio(base64Chunks)` — base64 → Uint8Array → 拼接 → `AudioContext.decodeAudioData`
- `play(audioBuffer, onEnded)` — 创建 BufferSource，设置 onended 回调，记录 `_startTime`
- `pause()` / `resume()` — 通过 `_pauseOffset` 追踪暂停位置
- `getCurrentTimeMs()` — 返回当前播放时间（ms），用于 HighlightEngine 同步
- `destroy()` — 关闭 AudioContext

## HighlightEngine (`components/highlight.js`)

逐词高亮引擎，将 TTS word 事件映射到 DOM spans。

### 工作流程

```
loadParagraph(paraIndex)
  → 查找 [data-para="{i}"] 元素
  → 收集所有 span[data-char-offset]
  → 构建 _offsets 数组（用于二分查找）

addWordEvents(events)
  → 按 offset 排序存储

start(getTimeMs)
  → 启动 rAF 循环：
    → 取当前播放时间
    → 遍历 wordEvents，offset <= currentTime 的逐个高亮
    → _highlightByCharOffset(charOffset):
      → 二分查找 _offsets 中 <= charOffset 的最大 span
      → 添加 "active" class
      → auto-scroll（span 不在视口时 smooth scroll to center）
```

### 非文本段落

`data-segment-type !== "text"` 时，整个容器元素添加 "active" class（`_isWholeSegment = true`）。

## Voice 系统

### voice-cache.js

- 缓存 `/voices` 端点响应到 `browser.storage.local`
- TTL: 24 小时 (`CACHE_TTL_MS`)
- `loadCachedVoices(storage)` — 命中返回 voices 数组，过期/异常返回 null
- `cacheVoices(voices, storage)` — 写入带 `cachedAt` 时间戳

### voice-prefs.js

- Per-language 偏好持久化：`{ en: "en-US-AriaNeural", zh: "zh-CN-XiaoxiaoNeural" }`
- `loadVoicePrefs(storage)` / `saveVoicePref(lang, voice, storage)`
- Storage 注入，支持测试 mock

### resolve-voice.js

5 级 fallback 链：

```
resolveVoice(lang, voices, userPref):
  1. userPref 在 voices 列表中 → 返回 userPref
  2. Extended tag 精确匹配（如 zh-TW） → 返回
  3. PREFERRED 字典中的默认 voice → 返回
  4. lang 前缀匹配（如 "zh-"） → 返回第一个
  5. English fallback（"en-"） → 返回第一个
  6. 终极 fallback → voices[0].name
```

### 加载策略（reader.js）

Cache-first：先用缓存的 voices 填充 UI，后台异步刷新。若用户在刷新期间手动选择了 voice，跳过自动选择（`skipUI` flag）。

## Controls (`components/controls.js`)

- `loadVoices(config, opts)` — 通过 DI 接收 config 对象，调用 `config.httpUrl("/voices")`
- `populateVoices(voices)` — 填充 `<select>` 下拉框
- `setVoice(name)` / `setPlaying(bool)` — 程序化控制 UI 状态
