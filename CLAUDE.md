# CLAUDE.md

## Development Workflow

### Quality Gates — 第一优先级

所有功能开发前，先确保质量覆盖到位。开发顺序：**写测试/benchmark → 跑通 → 再写功能代码**。

```bash
# Benchmark（需要后端运行）
python benchmark/run_all.py --port 7890      # TTS: latency, integrity, stability, memory
node benchmark/bench_extraction.js           # 提取质量评分（无需后端）

# 单元测试（无需网络）
LACTOR_MOCK_TTS=1 pytest                     # Python 全量
node --test extension/**/*.test.js           # JS 全量

# Pre-commit hooks 自动执行: format → lint → pytest → node --test
```

### 新功能开发流程

1. 确认质量覆盖需求（需要 benchmark fixture? 单元测试? E2E?）
2. **先写测试 / benchmark**
3. 实现功能代码
4. 跑通所有测试
5. 如涉及架构变更 → **同步更新 CLAUDE.md 或 docs/ref/**

### 测试规范

- **Python**: pytest + pytest-asyncio, `LACTOR_MOCK_TTS=1` 消除网络依赖
- **JS**: `node:test` + `node:assert/strict`, 依赖通过参数注入（mock storage 等）
- 新模块必须有对应 `*.test.js` 或 `test_*.py`
- Benchmark fixtures 在 `benchmark/fixtures/`

## 文档维护规则

CLAUDE.md 和 `docs/ref/` 是**活文档**，架构变更后必须同步更新。过时的文档比没有文档更危险。

触发更新条件：
- 模块新增/删除/重命名 → 更新本文件模块地图
- WS 接口协议变更 → 更新 `docs/ref/ws-protocol.md`
- Pipeline 阶段变更 → 更新 `docs/ref/extension-pipeline.md`
- 播放/高亮/预取逻辑变更 → 更新 `docs/ref/extension-playback.md`
- fix 类提交涉及非显而易见的坑 → 更新 `docs/ref/gotchas.md`

## Commands

```bash
# One-time setup
git config core.hooksPath .githooks
pip install -e ".[dev]"
npm install

# Format
ruff format .                                # Python
npx prettier --write "extension/**/*.js"     # JS

# Lint
ruff check src/ tests/                       # Python
npx eslint extension                         # JS

# Run backend
lactor serve --port 7890 --extension-id <id>
lactor serve --port 7890 --dev               # skip origin checks
```

## Architecture

Lactor = 本地 Python TTS 后端 + 浏览器扩展，通过 WebSocket 通信，实现网页文章的语音朗读 + 逐词高亮。

### Python Backend (`src/lactor/`)

| File | Responsibility |
|------|---------------|
| `main.py` | FastAPI app factory + CLI, Origin 验证（HTTP middleware + WS check） |
| `ws_handler.py` | WS 连接处理：speak/cancel 调度，asyncio.Event 取消机制 |
| `tts.py` | edge-tts 封装，流式产出 audio/word/done 事件，`LACTOR_MOCK_TTS=1` mock |

### Browser Extension (`extension/`)

| Layer | Files | Responsibility |
|-------|-------|---------------|
| Config | `config.js` | DI 工厂：`createConfig(overrides)`, `loadConfig(storage)` |
| Proxy | `background.js` | 纯 WS 中转代理，双连接（conn 0/1），接收 `wsEndpoint` URL，零业务逻辑 |
| Extraction | `content/extractor.js`, `overlay.js` | Defuddle 解析 → background → iframe overlay（CSP 失败自动降级为全标签页） |
| Orchestration | `reader/reader.js`, `reader/reader-core.js` | `reader-core.js`：`createReader(deps)` 工厂，全部编排逻辑（可单元测试）；`reader.js`：薄入口，组装真实依赖并调用 init() |
| Pipeline | `components/pipeline/` | `sanitize`（噪声过滤）→ `structure`（typed segments + 语言检测） |
| Playback | `components/player.js`, `highlight.js`, `scheduler.js` | AudioContext 播放、charOffset 二分查找高亮、自适应预取调度 |
| Voice | `components/voice-cache.js`, `voice-prefs.js`, `resolve-voice.js` | 24h 缓存、per-language 偏好、5 级 fallback 解析链 |
| UI | `components/controls.js`, `render-segments.js` | 播放控制、分段渲染 + URL rebasing |
| Infra | `components/logger.js`, `normalizer.js` | 分级日志、文本规范化 |

## Conventions

- **Config DI**: 不直接 import 常量。用 `createConfig`/`loadConfig` 创建 config 对象，通过参数传递给消费方
- **模块边界**: `components/` 内部模块间不互相 import，统一由 `reader.js` 编排
- **background.js**: 纯代理，不依赖 config，只接收 `wsEndpoint` URL 并中转消息

## WebSocket Protocol（精简版）

```
Client → Server:  { action: "speak"|"cancel", id, text, voice }
Server → Client:  { type: "audio"|"word"|"done"|"error", id, ... }
```

详细协议规范见 `@docs/ref/ws-protocol.md`

## Reference Docs

修改相关子系统时，加载对应文档获取详细设计：

- 修改 pipeline / 提取逻辑 → `@docs/ref/extension-pipeline.md`
- 修改播放 / 高亮 / 预取 / voice → `@docs/ref/extension-playback.md`
- 修改 WS 通信协议 → `@docs/ref/ws-protocol.md`
- 遇到非显而易见的坑 → 更新 `@docs/ref/gotchas.md`

## Docs Archiving

- 工作过程中产生的设计稿、实现计划等文档，完成后移入 `docs/archived/`。
- 发版前统一整理：将 `docs/archived/` 下的文件按版本号分子目录（如 `docs/archived/v0.1.0/`），再在版本目录内按产品需求/功能点分子文件夹，而非按技术模块区分。
