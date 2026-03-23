# Extension Permissions Audit

最终权限列表及商店审核 justification。

## Permissions

| Permission | Justification |
|---|---|
| `activeTab` | 用户点击扩展图标时，注入内容提取脚本到当前标签页。仅在用户主动点击时激活，不持续访问任何页面。 |
| `scripting` | 动态注入内容脚本（`extractor.js`、`overlay.js`），提取文章正文并打开阅读器覆盖层。 |
| `storage` | 通过 `browser.storage.local` 持久化用户偏好设置（语音选择、后端端口号、debug 日志开关）。 |

## Host Permissions

| Pattern | Justification |
|---|---|
| `http://localhost/*` | 与用户本机运行的 Python TTS 后端通信。 |
| `http://127.0.0.1/*` | 同上，覆盖 IP 地址形式。 |
| `ws://localhost/*` | WebSocket 连接本地 TTS 后端，用于流式传输音频和词边界事件。 |
| `ws://127.0.0.1/*` | 同上，覆盖 IP 地址形式。 |

所有网络通信仅限 localhost，不连接任何外部服务器。

## 隐私与数据流说明

1. **数据流向**: 用户在浏览器中打开的文章文本被提取后，仅发送至 `127.0.0.1:<port>`（本地 Python 后端）。扩展本身不向任何外部服务器发起网络请求。
2. **TTS 合成**: 本地后端通过 `edge-tts` 库连接微软 TTS 服务进行语音合成。合成后的音频通过 WebSocket 流回扩展播放。
3. **数据存储**: 仅通过 `browser.storage.local` 存储用户偏好（语音选项、端口号、debug 开关），不存储文章内容或用户浏览历史。
4. **无远程收集**: 不收集、远程存储或与第三方分享任何用户数据。
5. **localhost 连接说明**: 扩展需要 `localhost` / `127.0.0.1` 的 host permission，因为 TTS 后端作为独立进程运行在用户本机。这是纯本地架构，确保用户数据不离开设备（TTS 服务连接除外）。
