# Gotchas — 踩坑记录

开发过程中遇到的陷阱和非显而易见的问题。**每次踩坑后请更新此文档**。

---

## Firefox 浏览器环境

### ws://localhost 被升级为 wss://

Firefox HTTPS-Only 模式会将 `ws://localhost` 升级为 `wss://localhost`，导致本地后端连接失败。

**解决方案**: 使用 `127.0.0.1` 替代 `localhost`，Firefox 不会升级 IP 地址。（`5658fa0`）

### Extension CSP 默认包含 upgrade-insecure-requests

Firefox MV3 默认 CSP 会强制 `ws://` 升级为 `wss://`，即使用了 `127.0.0.1` 也会被升级。

**解决方案**: 在 `manifest.json` 中显式覆盖 CSP，添加 `connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*`。（`62db5ac`）

### Reader 页面无法直接建 WebSocket

扩展的 reader 页面（`moz-extension://` 协议）受 HTTPS-Only 限制，直接创建 `ws://` 连接会被拦截。

**解决方案**: 通过 `background.js` 的 Port API 代理 WebSocket。Background script 不受 HTTPS-Only 限制。（`8d5bae6`）

---

## WebSocket 并发

### 单连接只能同时处理一个 speak

后端每条 WS 连接维护一个 `current_task`。新的 `speak` 会取消前一个。如果前端在同一条连接上快速发多个 speak，之前的 done 事件会丢失。

**解决方案**: `PrefetchScheduler` 追踪 `_connBusy[0/1]`，确保每条连接同时只有一个 in-flight 请求。（`34fc70a`）

### Prefetch 序号与播放序号脱节

`playFromParagraph(n)` 直接调用 `scheduler.getNextFetch()` 时，如果 prefetcher 已经提前调度了 para n，`getNextFetch` 返回的是 para n+1 而非 para n。

**解决方案**: 引入 `ensureBuffered(paraIndex)` 函数，区分三种状态：已完成（立即 resolve）、in-flight（等 done）、未调度（调度后等）。（`2960ba9`）

### WS 断线后 dispatch 不知道连接已断

`ws.onclose` 触发了 background 端的重连，但 reader 端的 `bgConnected` 没有更新，导致 dispatch 一直重试发送消息到已死的连接。

**解决方案**: `ws-error` 事件设置 `bgConnected = false`；`dispatchFetch` 第一次重试时主动触发 `reconnectBg()`；`handlePlay` 在 resume 前检查并重连。（`7d8e1a6`）

---

## edge-tts

### 默认 SentenceBoundary 没有 word 事件

edge-tts 默认使用 `SentenceBoundary`，只在句子边界产出事件。逐词高亮需要 `WordBoundary`。

**解决方案**: 创建 Communicate 时传入 `boundary="WordBoundary"`。（`ae8222c`）

### offset/duration 单位是 100ns 而非 ms

edge-tts 返回的 offset 和 duration 是 100 纳秒为单位的 ticks，不是毫秒。

**解决方案**: `tts.py` 中统一除以 10,000 转换为毫秒。

---

## Pipeline / 内容提取

### 显式 lang tag 被启发式覆盖

页面设置了 `lang="es"`（西班牙语），但 body 中包含 CJK 字符，启发式检测将其误判为中文。

**解决方案**: 对非 CJK 的显式 lang tag（es, fr, de 等），直接返回 "en"，不走启发式。（`f873453`）

### renderSegments 会清空已插入的 title

`renderSegments` 内部先 `innerHTML = ""` 清空容器。如果先插入 `<h1>` title 再调用 `renderSegments`，title 会被清掉。

**解决方案**: 先调 `renderSegments`，再 `contentEl.prepend(h1)`。（`233cf8b`）

### sanitize 误删公式块

公式块（KaTeX/MathJax）通常文本内容短且无语义标签，被 sanitize 的"短文本"规则误删。

**解决方案**: 检查元素及其后代是否有 `math`/`katex`/`mathjax` 类名，有则跳过所有过滤规则。（`722e7cf`）

---

## Voice / UI

### 异步 voice 加载与用户手动选择竞争

`loadVoices` 是异步操作。用户可能在 fetch 进行中手动切换了 voice，fetch 完成后自动选择会覆盖用户的选择。

**解决方案**: 添加 `userChangedVoice` flag，`onVoiceChange` 时设为 true；`loadVoices` 完成后检查 flag，若用户已手动选择则跳过自动设置。（`233cf8b`, `722e7cf`）

---

## 测试

### LACTOR_MOCK_TTS 环境变量泄漏

如果全局设置了 `LACTOR_MOCK_TTS=1`（如在 pre-commit hook 中），TTS 单元测试会走 mock 路径而非真实路径，遮盖真实代码的 bug。

**解决方案**: `test_tts.py` 添加 `autouse` fixture，在每个测试前清除 `LACTOR_MOCK_TTS` 环境变量。（`3eb106d`）

### management API 不可用导致 logger 静默

`isDebugMode()` 依赖 `browser.management.getSelf()`，在某些环境（如临时 tab）不可用。默认 fallback 为 `false` 会导致所有日志静默，无法调试。

**解决方案**: 默认 fallback 改为 `true`（宁可多日志，不可无日志）。同时在 init 中添加一条无条件 `console.log` 确保至少有一行输出。（`b2b2d0f`）
