# WebSocket Protocol — 完整规范

## 概述

扩展通过 `background.js` 维护每个标签页 **两条并行 WS 连接**（conn 0 和 conn 1）到后端 `ws://{host}:{port}/tts`。两条连接消除 head-of-line blocking，允许播放和预取同时进行。

## 消息格式

### Client → Server

```json
{ "action": "speak", "id": "para-0", "text": "段落文本", "voice": "en-US-AriaNeural" }
{ "action": "cancel", "id": "para-0" }
```

- `id`: 段落标识符，格式 `para-{index}`
- `voice`: edge-tts voice name
- 每条 WS 连接同一时间只处理一个 speak 请求；新 speak 会取消之前的 in-flight 请求

### Server → Client

```json
{ "type": "audio", "id": "para-0", "data": "<base64 MP3 chunk>" }
{ "type": "word",  "id": "para-0", "text": "Hello", "offset": 500, "duration": 200, "charOffset": 0, "charLength": 5 }
{ "type": "done",  "id": "para-0" }
{ "type": "error", "id": "para-0", "message": "TTS error description" }
```

### 字段语义

| Field | Unit | Description |
|-------|------|-------------|
| `offset` | ms | 该词在音频中的起始时间（edge-tts 100ns ticks ÷ 10,000） |
| `duration` | ms | 该词的发音时长 |
| `charOffset` | char index | 该词在源文本中的字符起始位置 |
| `charLength` | char count | 该词的字符数 |

`charOffset` 用于 HighlightEngine 的二分查找，将 word 事件映射到渲染的 `<span data-char-offset>` 元素。

## 双连接模型

### background.js 中转协议

background.js 是**纯代理**，不依赖 config，不做业务逻辑。

```
Reader → Background:
  { action: "connect", wsEndpoint: "ws://127.0.0.1:7890/tts" }
  { action: "speak", conn: 0, id, text, voice }
  { action: "cancel", conn: 1, id }
  { action: "close" }

Background → Reader:
  { type: "connected" }                    // 两条连接都 OPEN 后发送
  { type: "ws-error", conn: 0, message }   // 连接错误
  { type: "audio"|"word"|"done"|"error", conn: 0, id, ... }  // 加上 conn 字段
```

- `wsEndpoint`: reader 通过 `config.wsUrl()` 构建完整 URL 传入
- `conn` 字段由 background 添加（标识消息来自哪条连接）
- 重连策略：每条连接最多 3 次重连（`MAX_RECONNECT`），间隔 1 秒

### 连接分配

由 `PrefetchScheduler` 管理 conn 0/1 的分配。`getNextFetch()` 返回 `{ conn, index, text }`，reader 在 speak 消息中携带 `conn` 字段。

## 取消语义

### 后端 (`ws_handler.py`)

- 每条 WS 连接维护一个 `cancel_event` (`asyncio.Event`)
- 收到 `cancel` → 设置 event → `_stream_paragraph` 在每次迭代检查 `cancel_event.is_set()`，及时退出
- 收到新 `speak` → 先取消当前 task，再启动新 task
- 客户端断开 → 设置 cancel_event，停止 in-flight 流

### 前端 (`reader.js`)

- `cleanup()` → 发送 `{ action: "close" }`，断开 port
- 页面 `beforeunload` 触发 cleanup
- 用户关闭 overlay → cleanup + postMessage "lactor-close"

## Origin 验证

### HTTP — `OriginMiddleware` (`main.py`)

- 检查 `Origin` header 是否在 `allowed_origins` 中
- `allowed_origins` 从 `--extension-id` 构建：`moz-extension://{id}`, `chrome-extension://{id}`
- `--dev` 模式跳过所有 Origin 检查
- 不匹配返回 403

### WebSocket — `check_ws_origin` (`main.py`)

- 同样检查 Origin header
- 不匹配关闭连接（close code 4003）

### CORS

- `CORSMiddleware` 配置 `allowed_origins`，允许扩展发起 HTTP 请求（如 GET /voices）
- `--dev` 模式设为 `["*"]`
