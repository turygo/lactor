# Lactor — 沉浸式网页朗读器（同步逐词高亮）

## 概述

Lactor 是一个浏览器扩展（先做 Zen/Firefox，后续适配 Chrome）配合本地 Python 后端，提供沉浸式、无干扰的网页文章朗读体验。它从网页中提取正文，渲染为干净的阅读界面，并通过 TTS 朗读，同时逐词高亮显示当前播放位置。

## 架构

```
┌───────────────────────────────────────────────────┐
│                  原始网页标签页                      │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │  content script (extractor.js)              │  │
│  │  - Defuddle 正文提取                         │  │
│  │  - 注入全屏 iframe 覆盖层                    │  │
│  └──────────────┬──────────────────────────────┘  │
│                 │ 注入                             │
│  ┌──────────────▼──────────────────────────────┐  │
│  │  iframe (reader.html) — extension page      │  │
│  │  position: fixed; 100% × 100%; z-index: max │  │
│  │                                             │  │
│  │  ┌──────────┐ ┌─────────┐ ┌─────────────┐  │  │
│  │  │ 段落拆分  │→│播放队列  │→│ 逐词高亮引擎 │  │  │
│  │  └──────────┘ │(预取1段) │ └─────────────┘  │  │
│  │               └────┬────┘                   │  │
│  │  播放控制条 | 双 WebSocket 连接 (直连后端)    │  │
│  └─────────────────────┬───────────────────────┘  │
│                        │                          │
│  地址栏不变 ✓  历史记录不受影响 ✓  淡入/淡出动画 ✓  │
└────────────────────────┬──────────────────────────┘
                         │ WebSocket × 2
┌────────────────────────┴──────────────────────────┐
│             Python 后端 (lactor serve)              │
│                                                   │
│  FastAPI + uvicorn + WebSocket 端点               │
│  - GET /voices → 可用声音列表                      │
│  - WS  /tts   → 双向 TTS 流                       │
│  - 绑定 127.0.0.1 + Origin 校验                    │
│                                                   │
│  edge-tts (Communicate, boundary=WordBoundary)     │
└────────────────────────────────────────────────────┘
```

### 核心架构决策

**iframe 覆盖层，而非标签页导航：** 点击扩展按钮后，content script 提取正文，然后在当前页面上注入一个全屏 `<iframe>`，`src` 指向扩展内部的 `reader.html`。iframe 使用 `position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2147483647` 覆盖整个页面，并通过 CSS `opacity` 过渡实现淡入动画。

此方案的优势：
- **地址栏不变**——用户看到的仍是原始 URL
- **不影响浏览历史**——没有导航发生
- **关闭即恢复**——移除 iframe 元素即可回到原页面，体验像覆盖层
- **完整扩展权限**——iframe 内部是 extension page，拥有全部扩展 API
- **天然样式隔离**——iframe 与宿主页面互不影响
- **支持动画**——淡入打开、淡出关闭

需要在 `manifest.json` 的 `web_accessible_resources` 中声明 `reader.html` 及其关联资源。

**CSP 降级策略：** 部分网站的 `frame-src` / `child-src` CSP 策略可能阻止加载扩展资源的 iframe。overlay.js 在注入 iframe 后通过两层检测判断是否需要降级：(1) 监听 iframe 的 `error` 事件（快速失败路径），(2) 启动 2 秒超时计时器，等待 reader page 发送 `{type: 'lactor-ready'}` 握手消息——如果超时未收到则判定为 CSP 拦截或其他加载失败（主判据，覆盖浏览器不触发 error 事件的场景）。触发降级时，overlay.js 移除 iframe 并通过 `browser.runtime.sendMessage({type: 'fallback-to-tab', tabId})` 通知 background script，由 background 调用 `browser.tabs.update(tabId, {url: readerURL})` 完成降级（content script 无权调用 `tabs.update`）。降级路径下地址栏会变化，但功能完整。用户关闭 reader 后可通过浏览器后退键返回原页面。

**WebSocket 由 reader 页面持有，不经过 background service worker：** reader 页面（作为 iframe 内的 extension page）直接连接后端 WebSocket。避免了通过扩展消息中转音频数据的开销和复杂度，也绕开了 MV3 中 service worker 无法使用 Web Audio API 的限制。

**内容传递：content script → background → reader page（消息传递，按 tabId 隔离）：**
1. content script 提取正文后，通过 `browser.runtime.sendMessage({type: 'content', tabId, data})` 发送给 background
2. background 以 `tabId` 为键暂存内容到 `Map<tabId, {data, timestamp}>`（不使用 `storage.local`，避免大文章的配额和写入延迟）
3. reader page 加载后，通过 `browser.runtime.sendMessage({type: 'getContent', tabId})` 向 background 请求对应标签页的内容
4. background 响应后删除该 `tabId` 的暂存条目
5. **防护机制：**
   - 同一 `tabId` 重复点击：覆盖旧条目，reader page 始终获取最新提取结果
   - TTL 过期清理：暂存条目超过 60 秒未被读取则自动清除，防止内存泄漏
   - 多标签页并发：每个标签页的内容独立存储、独立读取，互不干扰

**后端地址配置：** 默认端口 7890，host 固定 `localhost`。扩展 popup 提供一个端口号输入框（存入 `browser.storage.local`），用户可在后端端口被占用时修改。reader page 启动时从 storage 读取端口号，拼接为 `ws://localhost:{port}/tts` 和 `http://localhost:{port}/voices`。

**后端安全策略：** Python 后端仅绑定 `127.0.0.1`（不绑定 `0.0.0.0`），并对所有 WebSocket/HTTP 请求校验 `Origin` 头。校验精确到扩展 ID：仅接受 `moz-extension://{lactor-extension-id}` 和 `chrome-extension://{lactor-extension-id}` 来源的请求。扩展 ID 通过 `lactor serve --extension-id <id>` 启动参数显式配置（不支持自动注册，避免 TOFU 抢注风险）。安装引导流程中，扩展 popup 会显示当前扩展 ID，用户复制粘贴到启动命令即可。这防止了本机上其他扩展或网页滥用 TTS 服务。通过 `--dev` 启动参数可关闭 Origin 校验，供 benchmark 脚本和本地开发使用（`lactor serve --port 7890 --dev`）。生产模式（默认）始终强制校验。

## 数据流

1. 用户点击扩展按钮 → background script 注入 content script 到当前页面
2. Content script 运行 Defuddle 提取正文 → 通过 `browser.runtime.sendMessage` 发送给 background
3. Background 暂存内容 → 通知 content script 注入 iframe 覆盖层
4. Content script 创建全屏 iframe（`src = browser.runtime.getURL('reader/reader.html')`），淡入动画
5. Reader page（iframe 内）加载 → 通过消息从 background 获取提取的内容
6. Reader page 规范化文本 → 按段落拆分 → 逐词渲染为 `<span data-word="N" data-char-offset="M">`
7. Reader page 从 `browser.storage.local` 读取用户配置的端口号（默认 7890），打开两条 WebSocket 连接到 `ws://localhost:{port}/tts`，第一条发送首段文本
8. 后端通过 JSON text frame 流式返回音频（base64）+ 逐词时间戳
9. 前端缓冲整段音频 chunk → 拼接 → 解码为完整 MP3 AudioBuffer → 播放
10. 前端根据时间戳事件同步驱动逐词高亮
11. 当前段开始播放时，第二条连接预取下一段（缓冲队列深度 = 1）
12. 当前段播完后，无缝切换到已缓冲的下一段，同时预取再下一段
13. 用户关闭阅读模式 → reader page 通知 content script → 淡出动画 → 移除 iframe → 回到原页面

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 正文提取 | Defuddle | 替代 Readability.js；多轮提取、移动端 CSS 分析、Obsidian 团队活跃维护 |
| TTS 引擎 | edge-tts (Python) | 免费、无需 API key、高质量声音、WordBoundary 逐词时间戳 |
| 通信 | WebSocket | 双向：推送音频+时间戳，接收暂停/恢复/取消指令 |
| 音频播放 | Web Audio API | 低延迟、精确计时控制，适合高亮同步 |
| 后端框架 | FastAPI + uvicorn | 原生异步 WebSocket 支持，轻量 |
| 扩展规范 | Manifest V3 | 兼容 Firefox/Zen 和 Chrome |
| 界面 | 全屏 iframe 覆盖层 | 地址栏不变、不影响历史记录、支持动画、完整扩展权限、天然样式隔离 |

### 风险：edge-tts 服务依赖

edge-tts 是微软免费 TTS 端点的非官方客户端。微软可能随时变更或限制该端点。后端抽象层（`tts.py`）设计为可替换，必要时可切换到其他 TTS 引擎。

## Python 后端

### 包结构

```
lactor/
├── server/
│   ├── __init__.py
│   ├── main.py          # FastAPI 应用 + CLI 入口
│   ├── tts.py           # edge-tts 封装（可替换抽象）
│   └── ws_handler.py    # WebSocket 消息处理
├── pyproject.toml
└── README.md
```

### 端点

```
GET  /voices     → [{name, locale, gender}, ...]
WS   /tts        → 双向 WebSocket
```

### WebSocket 协议

**帧类型：** 所有消息均使用 JSON text frame。不使用 binary frame，因为每条消息都需要携带 `id` 字段以正确路由到对应段落。

**并发模型：** 后端每条 WebSocket 连接同一时刻只处理一个 `speak` 请求。前端使用**两条独立的 WebSocket 连接**——一条用于当前播放段落，一条用于预取。这从根本上消除了消息交错问题：每条连接上只有一个进行中的 `speak`，该连接上的所有消息都属于同一个段落。

客户端 → 服务端（text frame）：
```json
{"action": "speak", "id": "para-0", "text": "段落文本...", "voice": "en-US-AriaNeural"}
{"action": "cancel", "id": "para-0"}
```

服务端 → 客户端（text frame）：
```json
{"type": "audio", "id": "para-0", "data": "<base64 编码的 MP3 chunk>"}
{"type": "word", "id": "para-0", "text": "Hello", "offset": 500, "duration": 200, "charOffset": 0, "charLength": 5}
{"type": "done", "id": "para-0"}
{"type": "error", "id": "para-0", "message": "..."}
```

**协议细节：**
- 所有消息（包括 `cancel`）都携带 `id` 字段，用于精确定位
- `offset` 和 `duration` 单位为毫秒，相对于当前段落音频流的起始位置（从 edge-tts 100ns ticks 转换）
- `charOffset` 和 `charLength` 指定该词在原始段落文本中的字符位置（来自 edge-tts WordBoundary），用于精确的 span 映射
- `done` 表示当前段落生成完毕
- `cancel` 携带 `id`，仅终止指定的流；服务端丢弃该 `id` 的剩余事件，并回复 `{"type": "done", "id": "..."}`
- 音频以 base64 编码在 JSON text frame 中传输（相比 binary frame 有少量开销，但确保了 `id` 路由的可靠性，无歧义）

**双连接预取模型：**
```
WS 连接 A: para-0 speak → [音频/词/done 流式传输]  ← 正在播放
WS 连接 B: para-1 speak → [音频/词/done 流式传输]  ← 预取中
```
para-0 播完后，连接 A 复用于 para-2 的预取，连接 B 缓冲好的 para-1 开始播放。两条连接交替扮演播放/预取角色。

### 安装与使用

```bash
pip install lactor
lactor serve --port 7890
```

## 浏览器扩展

### 文件结构

```
extension/
├── manifest.json          # Manifest V3, 含 web_accessible_resources 声明
├── background.js          # 扩展按钮点击 → 注入 content script → 暂存内容 → 响应 reader 请求
├── popup/
│   ├── popup.html         # 扩展 popup：端口配置 + 后端连接状态
│   └── popup.js           # 端口输入框、保存逻辑、连接检测
├── content/
│   ├── extractor.js       # Defuddle 正文提取 → 发送给 background
│   └── overlay.js         # 注入/移除全屏 iframe 覆盖层，管理淡入/淡出动画
├── reader/
│   ├── reader.html        # 沉浸式阅读页面 (extension page, 在 iframe 中加载)
│   ├── reader.css         # 阅读排版样式
│   ├── reader.js          # 主模块：加载内容、拆段、渲染、协调播放
│   └── components/
│       ├── highlight.js   # 逐词高亮：charOffset 映射 + rAF 调度
│       ├── player.js      # 音频播放：Web Audio API，逐段 buffer-then-decode
│       └── controls.js    # 播放/暂停按钮 + 声音选择下拉菜单 + 关闭按钮
├── lib/
│   └── defuddle.min.js    # Defuddle 核心库（零依赖）
└── icons/
```

### 模块职责

| 模块 | 职责 |
|------|------|
| `background.js` | 监听扩展按钮点击 → 注入 content script（extractor.js + overlay.js）→ 通过消息接收提取的内容 → 以 `tabId` 为键暂存于 `Map`（60s TTL 自动清理）→ 通知 content script 注入 iframe → 响应 reader page 按 `tabId` 请求内容 → 送出后删除该条目 |
| `extractor.js` | Content script：调用 Defuddle 提取正文 HTML → 通过 `browser.runtime.sendMessage` 发送给 background |
| `overlay.js` | Content script：负责创建/移除全屏 iframe 覆盖层。创建时：生成 iframe（`src = browser.runtime.getURL('reader/reader.html')`），设置全屏固定定位样式，通过 opacity 过渡实现淡入。移除时：淡出动画完成后移除 iframe DOM 元素。监听来自 reader page 的关闭消息 |
| `reader.js` | 通过消息从 background 请求提取的内容 → 文本规范化 → 按段落拆分 → 渲染逐词 span → 管理双 WebSocket 连接 + 播放队列 |
| `highlight.js` | 通过 `charOffset`（段落文本中的字符偏移）将词事件映射到 span，用 `requestAnimationFrame` 循环调度高亮切换，自动滚动到可视区域 |
| `player.js` | 接收 JSON 中的 base64 音频 chunk → 解码为二进制 → 按段落缓冲 → 拼接 → `decodeAudioData` 解码完整 MP3 → `AudioBufferSourceNode` 播放，支持暂停/恢复 |
| `popup.js` | 端口号输入框 + 保存按钮，存入 `browser.storage.local`；启动时尝试连接后端显示连接状态；后端未运行时显示启动提示 |
| `controls.js` | UI 交互绑定，启动时从 `GET /voices` 获取声音列表填充下拉菜单，关闭按钮通过 `window.parent.postMessage` 通知 overlay.js 移除 iframe |

### iframe 覆盖层生命周期

```
打开:
  1. overlay.js 创建 iframe 元素，opacity: 0
  2. 设置 src → reader.html 开始加载
  3. 插入 document.documentElement
  4. requestAnimationFrame → opacity: 1（CSS transition 0.3s ease）

关闭:
  1. reader page 发送关闭消息（window.parent.postMessage）
  2. overlay.js 收到消息 → 设置 iframe opacity: 0
  3. transitionend 事件触发 → 移除 iframe 元素
  4. 关闭所有 WebSocket 连接，释放 AudioContext
```

### reader page 与 content script 的通信

iframe 内的 reader page 是 extension page，content script 运行在宿主页面中。它们之间的通信使用两条路径：

- **reader → content script（关闭指令）：** `window.parent.postMessage({type: 'lactor-close'}, '*')`。overlay.js 监听 `message` 事件，接收时必须同时校验：(1) `event.source === iframe.contentWindow`（确认消息来自自己注入的 iframe），(2) `event.data.type === 'lactor-close'`（确认消息类型）。两项都通过才执行关闭
- **reader → background（获取内容、消息传递）：** `browser.runtime.sendMessage`，标准扩展消息通道

### 播放队列

```
WS-A → 段落 0: [缓冲中] → [解码] → [播放中]  ← 当前
WS-B → 段落 1: [缓冲中] → [解码] → [就绪]    ← 预取
         段落 2: [等待]
```

- 两条 WebSocket 连接 (A 和 B) 在播放和预取角色之间交替
- 当前段在 WS-A 上开始播放后，立即在 WS-B 上发送下一段的 `speak` 请求
- 段落 0 播完后：WS-B 的段落 1 开始播放，WS-A 发送段落 2 的预取请求
- 如果预取尚未返回，显示一个小的加载指示器
- 已播完的段落释放音频数据，仅保留文本渲染

### 音频组装策略

每个段落的音频作为完整单元处理：
1. 接收该段落的所有 base64 音频 chunk（直到收到 `done` 事件）
2. 解码 base64 → 拼接为单个 MP3 blob
3. 通过 `AudioContext.decodeAudioData()` 解码为一个 `AudioBuffer`
4. 通过 `AudioBufferSourceNode` 播放

此方案简单可靠——`decodeAudioData` 需要完整的音频文件，而非任意的 MP3 帧片段。预取模型确保下一段在当前段播完之前已解码就绪。

## 逐词高亮同步

### 文本预处理

渲染时，每个段落的每个词用 span 包裹，并记录字符偏移：

```html
<p data-para="0">
  <span data-word="0" data-char-offset="0">The</span>
  <span data-word="1" data-char-offset="4">quick</span>
  <span data-word="2" data-char-offset="10">brown</span>
  <span data-word="3" data-char-offset="16">fox</span>
</p>
```

### 文本规范化契约（Canonical Text）

charOffset 映射的可靠性依赖于 TTS 输入文本和渲染 span 偏移量基于**完全相同的字符串**计算。这通过共享的规范化管线来保证：

1. Defuddle 提取文章 HTML
2. 按块级元素拆分为段落（`<p>`、`<h1>`-`<h6>`、`<blockquote>`、`<li>`）
3. 对每个段落提取纯文本：去除 HTML 标签、解码实体、折叠空白（多个空格/制表符/换行 → 单个空格）、修剪首尾、应用 NFC Unicode 规范化
4. 这个**规范文本**字符串是唯一的事实来源——它同时用于：
   - 作为 `speak` 消息中的 `text` 发送给后端
   - 前端拆词并计算 span 上的 `data-char-offset`

因为双方操作的是同一个字符串，edge-tts WordBoundary 事件中的 `charOffset` 值直接映射到 span 位置。

### 同步策略：字符偏移映射

edge-tts WordBoundary 事件报告 `charOffset`（发送给 TTS 的源文本中的字符偏移）。由于规范文本是共享的，这直接映射到前端的 span 偏移。

**映射算法：**
1. 后端随每个词事件发送 `{charOffset, charLength}`
2. 前端在排序的偏移数组中二分查找，找到 `data-char-offset` 范围包含报告偏移值的 span
3. 这处理了 edge-tts 分词与前端空白分割不一致的边界情况（如连字符词、标点）

**降级方案：** 如果 charOffset 映射未找到对应的 span（在共享规范文本下不应发生，但作为防御性措施），退回到顺序指针模式。

### 高亮调度

使用单个 `requestAnimationFrame` 循环（而非逐词 `setTimeout`），持续检查当前音频播放时间与排序的词事件列表：

```
rAF 循环:
  currentTime = audioContext.currentTime - paragraphStartTime
  while (nextWord && nextWord.offset <= currentTime):
    激活 nextWord 对应的 span（添加 .active 类）
    取消上一个 span 的激活
    如果 span 不在视口内：平滑滚动到可见
    推进到下一个词
```

此方案的优势：
- 抗时序抖动（不存在 setTimeout 的累积漂移）
- 暂停极简（停止 rAF 循环）
- 恢复极简（重启 rAF 循环，指针位置已正确）

### 暂停/恢复

- **暂停：** 挂起 AudioContext（`audioContext.suspend()`），停止 rAF 循环，高亮冻结
- **恢复：** 恢复 AudioContext（`audioContext.resume()`），从当前指针位置重启 rAF 循环

## MVP 控件

- **播放 / 暂停 / 恢复** 按钮
- **声音选择** 下拉菜单（从 `/voices` 端点填充）
- **关闭** 按钮（淡出动画移除覆盖层，回到原页面）

## 错误处理

| 场景 | 行为 |
|------|------|
| 后端未运行 | 扩展 popup 显示"请先启动 `lactor serve --port {port}`"提示；reader 页面内也显示连接失败提示 |
| WebSocket 断开 | 自动重连（最多 3 次），暂停播放，通知用户 |
| WebSocket 连接被拒（端口错误、Origin 校验失败） | 显示与"后端未运行"不同的错误信息 |
| Defuddle 提取结果为空 | 显示"无法提取正文"，不注入 iframe |
| 某段 TTS 生成失败 | 后端发送 `{"type": "error", "id": "..."}`，前端跳过该段，继续下一段，UI 标记跳过的段落 |
| 音频数据损坏/格式错误 | `decodeAudioData` 失败 → 跳过该段，显示错误指示，继续 |
| 用户关闭覆盖层 | reader page 通知 overlay.js → 淡出动画 → 移除 iframe → 关闭 WebSocket、释放 AudioContext |
| 用户在播放中离开页面 | `beforeunload` 处理器：移除 iframe、关闭 WebSocket、释放 AudioContext |
| 快速连续的播放/取消操作 | 协议中的 `id` 字段确保过期响应被丢弃 |
| 已选声音不再可用 | 降级到第一个可用声音，通知用户 |
| 长文章 | 不限段落数量；内存中仅保留当前 + 1 个预取段的音频；已播完的段落音频释放 |

## Benchmark

### 目的

在 MVP 阶段建立性能基线，通过自动化测试脚本提前发现长文章卡顿、内存泄漏和数据丢失问题。脚本可重复运行，适合本地开发和 CI 集成。

### 测试工具

```
benchmark/
├── fixtures/                       # 测试用的文本素材
│   ├── short.txt                   # ~500 词
│   ├── medium.txt                  # ~3000 词
│   ├── long.txt                    # ~10000 词
│   └── extra-long.txt              # ~30000 词
├── bench_latency.py                # 延迟测试：首段出声延迟、段间切换延迟
├── bench_memory.py                 # 后端内存测试：峰值、泄漏趋势
├── bench_frontend_memory.html      # 前端内存测试：JS 堆、AudioBuffer GC、base64 解码开销
├── bench_integrity.py              # 数据完整性测试：词事件完整性、音频解码成功率
├── bench_stability.py              # 并发稳定性测试：快速取消/切换
├── run_all.py                      # 运行全部后端 benchmark，输出汇总报告
├── reports/                        # 报告输出目录
└── README.md
```

### 测试维度与指标

#### 1. 延迟（bench_latency.py）

通过 Python WebSocket 客户端直接连接后端（需 `--dev` 模式跳过 Origin 校验），模拟前端行为，测量关键延迟。

| 场景 | 指标 | 通过标准 |
|------|------|---------|
| 各长度文章首段 | 首个 audio chunk 返回延迟 | < 1s |
| 各长度文章首段 | 首个 word 事件返回延迟 | < 1s |
| 连续段落切换 | 段落间 done → 下一段首个 audio chunk 延迟 | < 500ms |
| 预取命中率 | 段落切换时预取已就绪的比例 | > 90% |

#### 2. 内存（bench_memory.py + bench_frontend_memory.html）

**后端内存（bench_memory.py）：** 启动后端进程，通过 WebSocket 发送超长文章全部段落，监控后端进程内存。

| 场景 | 指标 | 通过标准 |
|------|------|---------|
| 超长文章完整播放 | 后端进程峰值 RSS | < 200MB |
| 超长文章完整播放 | 播放结束后 RSS 回落到基线的倍数 | < 1.5x |
| 连续播放 3 篇超长文章 | RSS 增长趋势（线性回归斜率） | 斜率 ≈ 0（无泄漏） |

**前端内存（bench_frontend_memory.html）：** 一个独立的测试页面，模拟 reader page 的完整工作流（WebSocket 接收 base64 音频 → 解码 → AudioBuffer 播放 → 段落轮转释放），通过 `performance.memory`（Chrome）或 `performance.measureUserAgentSpecificMemory()`（跨浏览器）采集前端内存。

| 场景 | 指标 | 通过标准 |
|------|------|---------|
| 超长文章完整播放 | JS 堆峰值 | < 150MB |
| 超长文章完整播放 | 段落轮转后堆是否回落（已播完段的 AudioBuffer 是否被 GC） | 回落到峰值的 50% 以下 |
| 连续播放 3 篇超长文章 | 堆增长趋势 | 斜率 ≈ 0（无泄漏） |
| base64 解码峰值 | 单段音频 base64 解码时的瞬时内存增量 | < 单段音频大小的 3 倍 |

#### 3. 数据完整性（bench_integrity.py）

全文播放完成后校验数据是否有丢失。

| 场景 | 指标 | 通过标准 |
|------|------|---------|
| 各长度文章完整播放 | word 事件覆盖的字符范围 vs 原文可发音字符数（排除标点/空白） | 覆盖率 ≥ 99%（hard fail） |
| 各长度文章完整播放 | 标点/空白等不可映射字符占原文总字符数的比例（仅统计，不判定） | 记录值（预期 < 15%） |
| 各长度文章完整播放 | 所有段落的 audio chunk 拼接后 MP3 解码是否成功 | 100% 成功 |
| 各长度文章完整播放 | word 事件的 charOffset 是否单调递增（段内） | 100% 单调 |
| 各长度文章完整播放 | 每段是否收到恰好一个 done 事件 | 100% |

#### 4. 并发稳定性（bench_stability.py）

模拟用户快速操作的极端场景。

| 场景 | 指标 | 通过标准 |
|------|------|---------|
| 快速连续 cancel + speak（50 次） | cancel 后是否还收到旧 id 的 audio/word 消息 | 0 条泄漏消息 |
| 快速连续 cancel + speak（50 次） | 所有 cancel 是否收到对应的 done 响应 | 100% |
| 双连接交替 speak（模拟预取切换 20 轮） | 连接是否稳定、无僵尸连接 | 0 僵尸 |
| 后端突然断开再重连 | 重连后功能是否恢复正常 | 恢复成功 |

### 运行方式

```bash
# 以 dev 模式启动后端（关闭 Origin 校验，允许 benchmark 脚本直连）
lactor serve --port 7890 --dev &

# 运行全部 benchmark
python benchmark/run_all.py --port 7890

# 运行单个维度
python benchmark/bench_latency.py --port 7890
python benchmark/bench_memory.py --port 7890
python benchmark/bench_integrity.py --port 7890
python benchmark/bench_stability.py --port 7890
```

### 输出格式

每次运行生成 JSON 报告（`benchmark/reports/YYYY-MM-DD-HHMMSS.json`），包含所有指标的原始数值和 PASS/FAIL 判定。`run_all.py` 在终端输出人类可读的汇总表格，非零退出码表示有测试未通过。
