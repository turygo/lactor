---
title: 'Reader 播放状态机建模'
type: 'refactor'
created: '2026-03-24'
status: 'done'
baseline_commit: 'be12a44'
context: ['docs/ref/extension-playback.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 播放状态分散在 reader-core（`currentParaIndex`, `bgConnected`）、Player（`_playing`）、Scheduler（`_connBusy`）、Controls（`_playing`）四处，缺乏统一状态模型。段落切换、取消/重启、跳转等操作各自管理状态，导致 #7 #8 #9 #10 无法可靠地构建在其上。

**Approach:** 提取一个独立的 `playback-state.js` 状态机模块，定义 `idle → loading → playing ⇄ paused → idle` 状态枚举和转换规则，提供段落导航接口（`goTo(index)`）和事件订阅机制（`on(event, cb)`），reader-core 委托状态决策给状态机而非自行管理散落的标志位。

## Boundaries & Constraints

**Always:**
- 遵循项目 DI 模式：`createPlaybackState(deps)` 工厂函数，不引入 singleton
- 状态机是纯逻辑模块，不依赖 DOM/AudioContext/WebSocket
- 所有状态转换通过显式方法调用（`transition(event)`），非法转换抛出或忽略并 log
- reader-core 现有的外部 API（`init`, `cleanup`）和测试不被破坏

**Ask First:**
- 是否需要为状态机引入第三方库（如 xstate）还是手写轻量实现
- 滚动仲裁和快捷键焦点是否纳入本次范围（issue 中提及但属于独立关注点）

**Never:**
- 不改变 WS 协议或后端行为
- 不修改 player.js / scheduler.js / highlight.js 的内部实现
- 不引入全局事件总线或 singleton 模式

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 正常播放流程 | idle + play() | idle → loading → playing → (段落结束) → loading → playing → ... → idle | N/A |
| 用户暂停恢复 | playing + pause() | playing → paused; resume() → playing | N/A |
| 播放中跳转 | playing + goTo(5) | playing → loading(target=5), 取消当前段落 → playing(segment=5) | N/A |
| loading 中取消 | loading + cancel() | loading → idle, 清理 pending requests | N/A |
| 非法转换 | idle + pause() | 忽略，log warning | 不抛异常 |
| TTS 错误 | loading + error event | loading → error → (自动或手动) → idle | 通知订阅者 |
| 连接断开重连 | playing + disconnect | playing → error; reconnect 成功 → idle（需用户重新点击 play） | 通知 UI 显示错误状态 |

</frozen-after-approval>

## Code Map

- `extension/components/playback-state.js` -- 新建：状态机核心（状态枚举、转换规则、事件发射、段落导航）
- `extension/components/playback-state.test.js` -- 新建：状态机单元测试
- `extension/reader/reader-core.js` -- 重构：委托状态管理给 playback-state，移除散落的状态标志
- `extension/reader/reader-core.test.js` -- 更新：适配新的状态管理方式
- `extension/components/controls.js` -- 适配：通过状态机事件订阅更新 UI，移除本地 `_playing`

## Tasks & Acceptance

**Execution:**
- [x] `extension/reader/components/playback-state.js` -- 创建状态机模块：状态枚举（`idle/loading/playing/paused/error`）、转换表、`on(event,cb)` 订阅、段落导航状态（`currentIndex/targetIndex`）、`transition()` 方法
- [x] `extension/reader/components/playback-state.test.js` -- 编写状态机单元测试：39 个测试覆盖所有合法转换、非法转换忽略、事件通知、段落导航状态正确性
- [x] `extension/reader/reader-core.js` -- 重构：注入 `createPlaybackState`，用 `state.transition('play')` 替代直接操作标志位，用 `state.on('stateChange', cb)` 驱动 controls 联动
- [x] `extension/reader/reader-core.test.js` -- 更新现有测试：注入真实 `createPlaybackState`，42 个测试全部通过
- [x] `extension/reader/components/controls.js` -- 保留现有 `_playing` 作为 UI 显示状态，由状态机通过 `stateChange` 事件驱动 `setPlaying()` 同步；reader-core 不再读取 `controls.isPlaying`

**Acceptance Criteria:**
- Given 状态机处于 idle, when 调用 `transition('play')`, then 状态变为 loading 并触发 `stateChange` 事件
- Given 状态机处于 playing, when 调用 `goTo(n)`, then `targetIndex` 更新且状态转为 loading
- Given 状态机处于 idle, when 调用 `transition('pause')`, then 状态不变并 log warning
- Given reader-core 使用状态机, when 执行完整播放流程, then 行为与重构前一致
- Given 所有测试, when 运行 `node --test extension/**/*.test.js`, then 全部通过

## Design Notes

**状态转换表（FSM）：**
```
idle     --play-->     loading
loading  --buffered--> playing
loading  --error-->    error
loading  --cancel-->   idle
playing  --pause-->    paused
playing  --ended-->    loading   (自动下一段)
playing  --finished--> idle      (最后一段结束)
playing  --cancel-->   idle
playing  --jump-->     loading   (goTo 触发)
paused   --resume-->   playing
paused   --cancel-->   idle
paused   --jump-->     loading
error    --retry-->    loading
error    --cancel-->   idle
```

**事件接口：**
```javascript
const state = createPlaybackState({ paragraphCount: 10 });
state.on('stateChange', ({ from, to, currentIndex, targetIndex }) => { ... });
state.on('segmentChange', ({ from, to }) => { ... });
state.transition('play');   // idle → loading
state.goTo(5);              // sets targetIndex, triggers jump
state.current;              // { state: 'loading', currentIndex: 0, targetIndex: 5 }
```

## Verification

**Commands:**
- `node --test extension/**/*.test.js` -- expected: 全部通过，含新增 playback-state 测试
- `npx eslint extension` -- expected: 无错误

## Suggested Review Order

**状态机核心**

- 转换表 + 事件系统：纯逻辑无依赖，所有播放状态的唯一来源
  [`playback-state.js:1`](../../extension/reader/components/playback-state.js#L1)

- `goTo` 段落跳转：设置 targetIndex 后委托给 transition
  [`playback-state.js:66`](../../extension/reader/components/playback-state.js#L66)

- `advanceIndex` 消费 targetIndex 或顺序递增
  [`playback-state.js:96`](../../extension/reader/components/playback-state.js#L96)

**编排集成**

- `handlePlay`/`handlePause`：isLoading 守卫防并发，loading 时 pause 走 cancel 路径
  [`reader-core.js:323`](../../extension/reader/reader-core.js#L323)

- `playFromParagraph` 循环：以 state machine index 驱动，最后一段用 finished 而非 ended
  [`reader-core.js:357`](../../extension/reader/reader-core.js#L357)

- stateChange → controls.setPlaying 同步
  [`reader-core.js:76`](../../extension/reader/reader-core.js#L76)

- DI 入口注入 createPlaybackState
  [`reader.js:7`](../../extension/reader/reader.js#L7)

**测试**

- 39 个状态机测试：转换、事件、goTo、完整播放循环
  [`playback-state.test.js:1`](../../extension/reader/components/playback-state.test.js#L1)

- 42 个 reader-core 测试：注入真实 createPlaybackState，既有行为不变
  [`reader-core.test.js:6`](../../extension/reader/reader-core.test.js#L6)
