# Deferred Work

## From gh-15-reader-state-machine review

- **Controls `_playing` 自行翻转可能与状态机脱同步**: Controls 的 click handler 在调用 onPlay/onPause 回调前就翻转 `_playing`。如果状态转换失败（如 loading 中暂停），UI 按钮状态与实际播放状态会脱同步。需要重构 Controls 使其仅通过 `setPlaying()` 被动响应状态机，不自行管理 `_playing`。
- **`ensureBuffered` 无超时、port 断开时挂死**: 如果 TTS 请求已发出但 background port 断开且无 done/error 回复，`ensureBuffered` 的 Promise 永远不 resolve。`bgPort.onDisconnect` 应 reject 所有 pending requests。

## From gh-15 issue split

- **自动滚动仲裁** → GitHub Issue #21（v1.0.0）
- **快捷键焦点冲突规避** → GitHub Issue #22（backlog）
