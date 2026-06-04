# Spec 10 — 自建 Agent

> 用户在前端通过表单创建 / 编辑 Agent，不需要改代码。本 spec 定义可配置字段、Provider 支持矩阵、API key 优先级、内置 vs 自建的差异。

源文件：`src/components/create-agent-dialog.tsx`、`src/server/agent-service.ts`、`src/db/seed.ts`、`src/app/api/agents/`

---

## 定位

自建 Agent 默认 `adapterName='custom'`，也可以选择 `claude-code` 或 `codex` SDK adapter（详见 Spec 05）。用户配置：

- 身份：name / avatar / description / capabilities
- 行为：systemPrompt
- 模型：custom 走 modelProvider + modelId；SDK adapter 走 modelId
- 凭据：可选 apiKey / apiBaseUrl（per-agent override）
- 能力：custom 走 toolNames（勾选）+ supportsVision；SDK adapter 使用各自内置工具集

**自建不可成为 Orchestrator**：当前 service 把 `isOrchestrator` 写死为 `false`（`agent-service.ts:44`）。Orchestrator 只能通过 seed 数据预置（`src/db/seed.ts`）。UI 没有创建 Orchestrator 的入口。**TODO**：未来如要支持「自建 Orchestrator」，需要：
1. CreateAgentDialog 加 `isOrchestrator` toggle
2. service 加约束「装备了 plan_tasks 才能 isOrchestrator=true」
3. 群聊新建对话时 enforce 「最多 1 个 Orchestrator」

---

## 可配置字段

源：`src/components/create-agent-dialog.tsx`

| 字段 | 类型 | 必填 | 默认 | 备注 |
|---|---|---|---|---|
| `name` | string | ✓ | — | trim 后非空 |
| `description` | string | ✓ | — | trim 后非空，UI 一句话简介 |
| `capabilities` | string[] | — | `[]` | 用逗号 / 空格 / 中文逗号分隔，自动 split |
| `systemPrompt` | string | ✓ | — | 决定 agent 行为 |
| `modelProvider` | enum | — | `'deepseek'` | 见下方 Provider 矩阵 |
| `modelId` | string | — | provider 默认 | 切换 provider 时自动重置 |
| `apiKey` | string | — | `''` | 留空走 env var |
| `apiBaseUrl` | string | — | `''` | Claude Code 可填 Anthropic 兼容 endpoint；Codex 仅可填 Codex/Responses 兼容 endpoint |
| `toolNames` | string[] | — | 默认产物工具 | 当前可勾选：`write_artifact` / `deploy_artifact` / `read_artifact` / `read_attachment` / `fs_read` / `fs_write` / `bash` |
| `supportsVision` | boolean | — | `true` | 决定是否把图片 base64 注入 messages |
| `avatar` | string | — | `'🤖'` | service 层默认（UI 当前不暴露） |
| `isBuiltin` | boolean | — | `false` | service 写死，UI 不可改 |
| `isOrchestrator` | boolean | — | `false` | service 写死，UI 不可改 |

---

## Provider 支持矩阵

源：`src/components/create-agent-dialog.tsx:26-33`、`src/server/adapters/custom-agent-adapter.ts`

| Provider | UI label | 默认 modelId | Adapter 状态 |
|---|---|---|---|
| `deepseek` | DeepSeek | `deepseek-v4-flash` | ✅ 已接（OpenAI-compat）+ 支持 reasoning_content |
| `volcano-ark` | 火山方舟 (豆包) | `doubao-seed-2-0-lite-260428` | ✅ 已接（OpenAI-compat） |
| `openai` | OpenAI | `gpt-4o` | ✅ 已接 |
| `anthropic` | Anthropic | `claude-opus-4-7` | ❌ buildClient 里 throw（TODO） |

**OpenAI-compat 接入说明**：DeepSeek / 火山方舟都对外暴露 OpenAI-compatible Chat Completions API，所以共用 `openai` npm 包 + 改 `baseURL`。这类 provider 应选择 `custom` adapter。详见 Spec 05 的「CustomAgentAdapter」一节。

**SDK adapter 说明**：
- `claude-code`：使用 `@anthropic-ai/claude-agent-sdk`，`toolNames=[]`，SDK 内置工具集；Review 模式通过 `canUseTool` 桥到 AgentHub 审批。
- `codex`：使用 `@openai/codex-sdk`，`toolNames=[]`，SDK 内置本地命令 / 文件变更 / MCP / 计划事件；Review 模式以 read-only sandbox 运行，Auto 模式以 workspace-write sandbox 运行；自定义 Base URL 必须支持 Codex/Responses，DeepSeek 没有 `/responses`，不能走 Codex adapter。

**用户选 Anthropic 会发生什么**：创建 / 编辑成功（DB 行写入），但发消息时 Adapter throw → run 失败 → 错误消息显示在对话里。**TODO**：UI 应该在选 Anthropic 时给警告 banner，或者干脆暂时下掉这个选项。

---

## API Key 优先级

```
agent.apiKey (per-agent 自定义)
       │
       ├─ 非空 → 用这个
       │
       └─ NULL / 空 → fallback 到 env var：
            deepseek    → DEEPSEEK_API_KEY
            volcano-ark → ARK_API_KEY
            openai      → OPENAI_API_KEY
            anthropic   → ANTHROPIC_API_KEY
            codex       → CODEX_API_KEY / OPENAI_API_KEY（AgentHub 隔离 CODEX_HOME，不读 ~/.codex）
```

Custom provider 实现在 `custom-agent-adapter.ts` 的 `buildClient(provider, overrideKey)`；SDK adapter 的 key 解析由 `agent-runner.ts:buildAdapterInput` 统一注入。

`apiBaseUrl` 不是跨 adapter 通用的“OpenAI 兼容”开关。Claude Code 的 Base URL 走 Anthropic 兼容协议；Codex 的 Base URL 走 Codex/Responses runtime；DeepSeek / 火山方舟等 Chat Completions-only endpoint 走 Custom adapter。

**UI 行为**：
- 输入框默认 password 类型，旁边有「显示 / 隐藏」按钮（`create-agent-dialog.tsx:267-302`）
- 输入框下方动态显示「留空则 fallback 到 `<ENV_VAR_NAME>`」提示，跟随当前 provider 切换
- 编辑模式回填已保存的 key（password 形式）

**安全**：
- `.env.local` 是 gitignored（CLAUDE.md §5.4）
- DB 里 api_key 是明文存的（SQLite 本地文件 + 单用户场景；如果未来 multi-user 需要加密）
- 前端 GET /api/agents 当前**会返回 apiKey 字段**给 UI（用于编辑回填），不暴露给非用户场景即可

---

## 工具勾选

源：`create-agent-dialog.tsx:35`

```typescript
const AVAILABLE_TOOLS = ['write_artifact', 'deploy_artifact', 'read_artifact', 'read_attachment', 'fs_read', 'fs_write', 'bash'] as const
```

UI 当前允许勾选产物、附件和 workspace 相关常用工具。`plan_tasks` 不在列表里 —— 因为它是 Orchestrator 专用，自建 agent 不应装备。

**新增工具时**：除了在 `src/server/tools/registry.ts` 注册，还要在这里 `AVAILABLE_TOOLS` 加上才能在 UI 勾选（详见 Spec 07 「新增工具步骤」）。

---

## 内置 Agent vs 自建 Agent

`agents.is_builtin` 列区分。差异：

| 行为 | 自建 (is_builtin=false) | 内置 (is_builtin=true) |
|---|---|---|
| 创建 | UI / API | seed 数据（`src/db/seed.ts`）+ `pnpm db:seed` |
| 编辑配置 | ✅ | ✅（早期不允许，已开放） |
| 删除 | ✅ | ❌ service 层 throw `'Built-in agents cannot be deleted'` |
| `isOrchestrator` | 写死 false | seed 可设 true |

**为什么内置可改但不可删**：用户可能想换 API key / 改 system prompt（合理需求），但内置是「应用预设角色」，删了会破坏 demo 体验。如要重置内置 agent，跑 `pnpm db:seed` 重新种子（seed 脚本是 upsert）。

---

## 创建 / 编辑流程

源：`create-agent-dialog.tsx`（UI）+ `agent-service.ts`（service）+ `app/api/agents/`（API）

### 创建

```
[用户点 + 新建 Agent]
       │
       ▼
CreateAgentDialog (open, agent=undefined)
       │
       │ 填表 → submit
       ▼
POST /api/agents { name, description, ..., modelProvider, modelId, apiKey? }
       │
       ▼
createCustomAgent: avatar='🤖' 默认，adapterName='custom'，isBuiltin=false, isOrchestrator=false
       │
       ▼
返回 AgentRow → upsertAgent(row) 入 store
```

### 编辑

```
[用户在 sidebar / popover 点编辑]
       │
       ▼
CreateAgentDialog (open, agent=existingRow)
       │
       │ 初始化表单 useEffect 回填字段
       │ 提交 → submit
       ▼
PATCH /api/agents/:id { ...patch, adapterName? }  // 编辑弹窗会提交当前 adapterName
       │
       ▼
updateCustomAgent: 部分更新；切到 SDK adapter 时 modelProvider=null、toolNames=[]；apiKey null 显式清空
       │
       ▼
返回 AgentRow → upsertAgent(row) 入 store
```

**重要**：apiKey 字段语义是三态：
- `undefined` → 不改
- `null` → 显式清空（fallback 到 env）
- `string` → 设值（trim 后空字符串等价 null）

---

## API 路由清单

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/api/agents` | 列出全部 agent（按 is_builtin desc + created_at desc） |
| `POST` | `/api/agents` | 创建自建 agent |
| `PATCH` | `/api/agents/[id]` | 更新（内置也可） |
| `DELETE` | `/api/agents/[id]` | 删除（内置拒绝） |

zod 校验 body 在每个 route 文件内。

---

## 表单 UX 注意点

- **Provider 切换重置 modelId**：避免 `provider=openai, modelId=deepseek-v4-flash` 这种串味（`create-agent-dialog.tsx:99-103`）
- **API key 输入是 password 类型 + autocomplete=off**：防止浏览器把它存进 form autofill
- **错误提示就近显示**：submit 失败时在 footer 上方显示 inline red banner，不用 toast
- **打开 / 切换 agent 时 reset 表单**：用 `useEffect([open, agent])` 重置 state，避免编辑 A 后切到编辑 B 时残留 A 的输入

---

## 待补功能 (TODO)

- **自建 Orchestrator**：UI 不能创建带 `isOrchestrator=true` 的 agent；需要 plan_tasks 工具 + 群聊约束
- **Avatar 选择器**：当前自建 agent 默认 `'🤖'`，用户不能改。UI 可加 emoji picker / 上传图
- **导入 / 导出 agent 配置**：JSON 格式导出，分享配置；导入时校验
- **删除自建 agent 的二次确认**：当前一键删除，加 Dialog 确认更稳
- **Anthropic 路径实装**：buildClient 不要 throw，接入 `@anthropic-ai/sdk` 的 messages API

---

## 与其它 spec 的关系

- Spec 01：Agent 实体字段定义
- Spec 05：CustomAgentAdapter 是自建 agent 的运行时
- Spec 07：toolNames 引用的工具系统
- Spec 08：agents 表的 `api_key` / `supports_vision` 等列
