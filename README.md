# AgentHub

> 把多 Agent 协作做成 IM 群聊体验。Agent 是「联系人」，对话是「工作空间」，Orchestrator 是「群里的项目经理」。

AgentHub 是一个多 Agent 协作平台，通过对话式交互让用户与不同 AI Agent（Claude Code、自建 Agent 等）协同工作 —— 创建网页、写文档、改代码、跑命令。所有交互以 IM 群聊为核心范式：会话即工作空间，消息即指令，产物即落地。

```
┌─ 侧栏 ───────┬─ 当前会话 ────────────────────────┬─ 右侧面板 ────────┐
│ 📁 对话      │ Header: Agent 头像  Token Σ      │ Artifact 预览     │
│ 🎨 产物库     │ ───────────────────────────────  │ Web/Doc/Image     │
│ 🤖 Agents    │ User: 给我做个 todo 网页          │ + 版本切换 v1/v2  │
│ 📊 分析      │ Agent: 已生成 [产物卡片]          │                   │
│              │ ☆ 收藏 + ☑ 重新生成 + 引用片段     │ 文件浏览器 (alt) │
└──────────────┴───────────────────────────────────┴───────────────────┘
              ↑ MessageInput: 附件 / 审批模式 / 选区改写 quote chip
```

---

## ✨ 功能矩阵

### IM 聊天式交互
- 多会话并行 + 搜索 + 置顶 + 未读红点
- 单聊 / 群聊（@ mention）+ Orchestrator 自动协调
- 消息：text / code / thinking / 图片 / 文件 / 产物卡片 / Diff 审批卡 / 调度可视化
- 操作：引用回复、撤回、编辑重发、重新生成、消息收藏 ☆ + 跳转高亮辉光

### 多 Agent 接入
| Adapter | 状态 | 用法 |
|---|---|---|
| **ClaudeCodeAdapter** | ✅ | `@anthropic-ai/claude-agent-sdk` + 全套工具（Bash/Edit/Read/Write/Grep/Glob/WebFetch/Task subagent）+ Session 续接 |
| **CustomAgentAdapter** | ✅ | OpenAI 兼容协议，接 DeepSeek / OpenAI / 火山方舟 |
| **CodexAdapter** | ⏳ | 待接入 |
| **MockAdapter** | ✅ | 开发期不烧 token |
| **自建 Agent** | ✅ | 对话式创建，System Prompt + 工具集 |

支持第三方 API 网关（per-agent `apiBaseUrl` + token），如 anyrouter / DeepSeek 的 Anthropic 兼容 endpoint。

### 工具系统（统一适配层）
| 工具 | 说明 |
|---|---|
| `write_artifact` / `read_artifact` | 创建 / 读取可预览产物（含版本链） |
| `read_attachment` | 读用户上传附件 |
| `fs_read` / `fs_write` / `bash` | Workspace 文件操作 + Shell 命令（沙箱化 + 黑名单） |
| `plan_tasks` | Orchestrator 三阶段 DAG 调度 |
| `ask_user` | 结构化弹窗问答（2-4 选项 / 多选 / 自由输入） |

Claude Code Agent 通过 SDK MCP server 同样可以用这套工具。

### 产物预览与编辑
- 内联卡片 + 全屏预览面板
- web_app：iframe sandbox + 源码切换
- document：Markdown 渲染
- 版本历史链（parentArtifactId）+ 一键 v1↔v2 切换
- 选中文字 → 浮动「让 Agent 改这段」按钮 → 引用块自动注入

### Workspace 沙箱
- 每个会话独立工作目录（sandbox 模式：`.agenthub-data/workspaces/<convId>`；local 模式：绑用户真实项目目录）
- Agent fs_write 审批：Review 模式（默认，diff viewer 确认）/ Auto 模式（直写）
- Bash 黑名单（`rm -rf /` / `sudo` / fork bomb / curl pipe shell 等，详见 `CLAUDE.md` §5.2）

### Token 计量
- 每个 run 落 `agent_runs.usage` 列（input / output / cache 命中 / 模型）
- 单会话 Token 徽章（hover 看拆分 + cache 命中率）
- 全局分析 Tab：今日 / 本周 / 全部 + 按模型 / agent / 会话 排行

### 移动端
- 现有响应式 Web 端仅做小屏适配：≤ md 自动转抽屉 sidebar + 全宽 panels
- 手机 App 规划：Capacitor 伴随客户端，通过 Tailscale / LAN 连接桌面 AgentHub host，用于观察状态、审批修改和对话反馈，详见 Spec 14

---

## 🚀 快速开始

### 环境要求
- Node.js ≥ 20
- pnpm（lockfile 唯一来源）

### 安装运行

```bash
pnpm install

# 把 better-sqlite3 native module rebuild 到 Electron ABI（一次性，配合 ELECTRON_RUN_AS_NODE 跑 dev / build）
pnpm electron:rebuild

# 配置 API key（任一）
cp .env.example .env.local
# .env.local 填入 ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY / ARK_API_KEY
# 或留空，启动后在 UI 右上齿轮「设置」面板里填（见下方「设置面板」）

# 起服务（dev 模式 / web 端）
pnpm dev
# → http://localhost:3000
```

**首次启动会自动建表 + 自动 seed 5 个内置 Agent**（Orchestrator / PM 小灰 / UI 设计师 / 前端工程师 / Reviewer）—— 不再需要 `pnpm db:push` / `pnpm db:seed`。详见 Spec 12 §5.4。

### 桌面版（Electron）

```bash
pnpm electron:dev          # 并发跑 Next dev + tsc watch + Electron 窗口
pnpm electron:build        # 出 release/AgentHub-<ver>-arm64.dmg + AgentHub-<ver>.dmg（x64） + AgentHub-<ver>-setup.exe
```

详见 Spec 12（含 ABI 选型、打包流程、验证清单）。

### 设置面板（推荐）
Sidebar 顶部齿轮 → 「API 设置」，填 Anthropic / OpenAI / DeepSeek / 火山方舟 key 与 Anthropic base URL。优先级高于 `.env.local`、低于 agent 自配 key；明文存 SQLite 单行表 `app_settings`（本地单用户场景，不引入 keychain）。详见 Spec 08 §8 与 CLAUDE.md §5.4。

### Claude Code 零配置
本机装过 Claude Code CLI 并登录过的话，SDK 会自动读 `~/.claude/.credentials.json` OAuth token，**不需要单独配 `ANTHROPIC_API_KEY`**。

---

## 🏗 架构概览

```
┌─ L5 UI 组件（React / shadcn）
│
├─ L4 State + Transport
│  ├─ Zustand store（normalized entities + 关系桶）
│  └─ SSE 单连接（/api/stream，全局事件流）
│
├─ L3 Application Services
│  ├─ AgentRunner（per-run 生命周期）
│  ├─ ConversationService / ToolExecutor
│  ├─ EventBus（HMR-safe globalThis 单例）
│  └─ PendingWrites / PendingQuestions 等中转 store
│
├─ L2 Agent Platform Adapters
│  ├─ ClaudeCodeAdapter（SDK query() + canUseTool 桥 + MCP 工具）
│  ├─ CustomAgentAdapter（OpenAI 协议 stream + 自驱 tool loop）
│  └─ MockAdapter
│
└─ L1 Persistence
   ├─ Drizzle ORM + better-sqlite3
   └─ Workspace 文件系统
```

事件粘合：所有 Adapter / 工具产生的事件都走 **`StreamEvent` 联合类型** → AgentRunner 持久化 → EventBus 推 SSE → 前端 reducer 应用。详见 `specs/02-stream-events.md`。

---

## 📐 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 16 App Router + React 19 + TypeScript strict |
| 样式 | Tailwind CSS v4 + shadcn/ui（base-ui） |
| 状态 | Zustand + Immer + `useShallow` |
| ORM | Drizzle |
| DB | SQLite (`better-sqlite3`) |
| 流式 | SSE（一条全局连接，event-bus 单例） |
| LLM SDK | `@anthropic-ai/claude-agent-sdk`、`@anthropic-ai/sdk`、`openai` |
| 代码高亮 | `shiki`（双主题）+ `react-diff-viewer-continued`（diff 审批） |
| 包管理 | pnpm |

---

## 📚 项目规格（specs/）

| Spec | 内容 |
|---|---|
| `01-core-entities.md` | 7 个核心实体字段定义（Agent / Conversation / Message / Artifact / Workspace / Tool / AgentRun） |
| `02-stream-events.md` | StreamEvent 完整事件类型 + 持久化策略 |
| `03-message-parts.md` | MessagePart 各类型详解 |
| `04-artifacts.md` | Artifact 类型与渲染契约 |
| `05-adapter-interface.md` | AgentPlatformAdapter 接口 + 各 adapter 实现要点 |
| `06-orchestrator-flow.md` | Orchestrator 三阶段工作流 |
| `07-tools.md` | 内置工具清单与签名 |
| `08-db-schema.md` | Drizzle schema 与索引（含 app_settings 全局 key 表） |
| `09-frontend-architecture.md` | 前端状态结构与事件应用 |
| `10-agent-builder.md` | 自建 Agent 流程 |
| `11-platform.md` | 平台抽象（POSIX / Windows shell、命令黑名单、路径校验、子进程清理） |
| `12-desktop-electron.md` | 桌面版（Electron 打包 DMG / EXE） |
| `14-mobile-remote.md` | 移动端伴随 App（Capacitor / Tailscale / 远程审批） |

AI 协作约定见 `CLAUDE.md`。

---

## 🛠 常用命令

```bash
pnpm dev            # 启动 dev server（ELECTRON_RUN_AS_NODE 包装）
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm build          # 生产构建（Next standalone）
pnpm db:push        # 同步 schema 到 SQLite（如手工改 schema.ts）
pnpm db:seed        # 重灌 builtin agents（首次启动会自动 seed，这里是手动重灌入口）
pnpm electron:rebuild  # better-sqlite3 → Electron ABI（pnpm install 后必做一次）
pnpm electron:dev   # 启动 Electron 桌面壳 + 加载 dev server
pnpm electron:build # 出 DMG / EXE
```

DB 文件位于 `.agenthub-data/agenthub.db`。Workspace 默认在 `.agenthub-data/workspaces/<conv_xxx>/`。

---

## 🎯 已知限制 / 待办

- [ ] Codex adapter（OpenAI codex CLI 集成；目前可用 `gpt-5-codex` 模型 + CustomAgent 走 OpenAI 协议替代）
- [ ] Pin LLM 上下文的 UI 入口（schema 字段 `pinnedMessageIds` 已有，agent-runner 已读，缺前端入口；当前 ☆ 是纯导航书签，独立于 LLM Pin）
- [ ] sandbox 模式的总量配额对 Claude Code SDK 失效（SDK 自己写盘绕过我们的 quota）
- [ ] 移动端伴随 App（Capacitor 客户端 + Tailscale/LAN 配对通信，详见 Spec 14）
- [ ] 测试覆盖

---

## License

教学项目，仅作学习用途。
