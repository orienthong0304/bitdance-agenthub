# Spec 08 — 数据库 Schema

> Drizzle ORM + SQLite。本 spec 描述 7 张表的字段、索引、外键级联策略，是 Spec 01 实体的物理映射。**修改字段需先讨论。**

源文件：`src/db/schema.ts`

---

## 设计原则

1. **SQLite 本地文件数据库**，单进程读写，文件位于 `.agenthub-data/agenthub.db`（gitignored）
2. **timestamps 用 `INTEGER` 存 unix ms**（不用 ISO 字符串，省存储 + 比较快）
3. **结构化列用 JSON 文本**（drizzle 的 `text(..., { mode: 'json' })`）。SQLite 不支持原生 JSON 列约束，依赖应用层 zod / 类型校验
4. **boolean 用 `INTEGER 0/1`**（drizzle `mode: 'boolean'`）
5. **外键 + cascade**：会话是 aggregate root，删除时级联清掉 messages / artifacts / workspaces / attachments / agent_runs
6. **不引入复合主键 / 多列唯一约束**（除 workspaces 的 unique conversationId），关系通过 ID 字段维护

---

## 1. agents

```ts
agents {
  id              text PK           // ag_<nanoid>
  name            text NOT NULL
  avatar          text NOT NULL     // emoji 字面量 or URL
  description     text NOT NULL
  capabilities    text JSON         // string[]
  system_prompt   text NOT NULL
  adapter_name    text NOT NULL     // 'claude-code'|'codex'|'custom'|'mock'
  model_provider  text              // 仅 adapter_name='custom' 时填
  model_id        text              // 同上
  api_key         text              // 该 agent 单独的 key；NULL 走 env
  api_base_url    text              // 该 agent 单独的 endpoint（如第三方网关）；NULL 走 SDK 默认
  tool_names      text JSON         // string[]，引用 Spec 07
  is_builtin      int  bool default 0
  is_orchestrator int  bool default 0
  supports_vision int  bool default 0
  created_at      int  NOT NULL
}
```

**约束**：
- `adapter_name='custom'` 时 `model_provider` + `model_id` 必填
- `is_builtin=1` 的 agent 可修改、不可删除（service 层 enforce）
- `api_key` 优先级高于 env var；按 provider 路由：`deepseek→DEEPSEEK_API_KEY` / `openai→OPENAI_API_KEY` / `volcano-ark→ARK_API_KEY` / `anthropic→ANTHROPIC_API_KEY`
- `api_base_url` 非空时（Claude Code adapter），`api_key` 作为 `ANTHROPIC_AUTH_TOKEN` 传 SDK；`ANTHROPIC_BASE_URL` 设为 `api_base_url`；同时清空 `ANTHROPIC_API_KEY` 防覆盖（详见 Spec 05 ClaudeCodeAdapter）

**索引**：无（agent 数量小，全表扫描可接受）

---

## 2. conversations

```ts
conversations {
  id                       text PK           // conv_<nanoid>
  title                    text NOT NULL
  mode                     text NOT NULL     // 'single'|'group'
  agent_ids                text JSON         // string[]
  pinned_message_ids       text JSON         // string[]，default '[]'
  archived                 int  bool default 0
  fs_write_approval_mode   text NOT NULL default 'review'  // 'auto'|'review'，agent fs_write 审批策略
  created_at               int  NOT NULL
  updated_at               int  NOT NULL
}
INDEX idx_conv_updated ON (updated_at)
```

**约束**：
- `mode='single'` 时 `agent_ids.length === 1`，`group` 时 `>= 2`
- 群聊里 `is_orchestrator=1` 的 agent 最多 1 个（service 层 enforce）
- `fs_write_approval_mode`：详见 Spec 07「fs_write 审批模式」。人手编辑文件不走审批，只控制 agent
- `pinned_message_ids` 上限 5（`PIN_LIMIT_PER_CONVERSATION`，service 层 enforce）；toggle 时**不**更新 `updated_at`（pin 不算「会话活跃」）。UI 入口见 Spec 09

**索引说明**：`idx_conv_updated` 用于侧边栏「按最近活跃排序」列表。

---

## 3. messages

```ts
messages {
  id                  text PK           // msg_<nanoid> / msg_err_<nanoid>
  conversation_id     text NOT NULL  FK→conversations.id  ON DELETE CASCADE
  role                text NOT NULL     // 'user'|'agent'|'system'
  agent_id            text  FK→agents.id  (no cascade)
  parts               text JSON         // MessagePart[]，见 Spec 03
  status              text NOT NULL     // 'streaming'|'complete'|'error'|'aborted'
  parent_message_id   text              // 引用回复目标（同会话内自由引用，不建外键以容忍删除）
  mentioned_agent_ids text JSON         // string[]，default '[]'
  run_id              text              // 关联 agent_runs.id（不建外键，agent run 删除不影响消息保留）
  created_at          int  NOT NULL
}
INDEX idx_messages_conv_created ON (conversation_id, created_at)
```

**约束**：
- `role='agent'` 时 `agent_id` 必填
- `parts` 是数组，类型见 Spec 03（每种 part 的字段）

**特殊 ID 命名**：错误降级消息 ID 用 `msg_err_<nanoid>` 前缀（由 `AgentRunner.emitErrorVisualisation` 生成），便于日志区分。

**索引说明**：`idx_messages_conv_created` 是 hot path —— `MessageList` 拉取一个会话的全部消息按时间排。

---

## 4. artifacts

```ts
artifacts {
  id                  text PK           // art_<nanoid>
  conversation_id     text NOT NULL  FK→conversations.id  ON DELETE CASCADE
  type                text NOT NULL     // 'web_app'|'code_file'|'diff'|'document'|'image'
  title               text NOT NULL
  content             text JSON NOT NULL // ArtifactContent，见 Spec 04
  version             int  NOT NULL default 1
  parent_artifact_id  text              // 版本链（v2 引用 v1），不建外键
  created_by_agent_id text NOT NULL FK→agents.id
  created_at          int  NOT NULL
}
INDEX idx_artifacts_conv ON (conversation_id)
```

**索引说明**：`ArtifactLibrary` 列表 + 单会话 artifact 卡片渲染都走这个索引。

---

## 5. workspaces

```ts
workspaces {
  id              text PK              // ws_<nanoid>
  conversation_id text NOT NULL UNIQUE FK→conversations.id  ON DELETE CASCADE
  root_path       text NOT NULL        // 绝对路径，物理位于 .agenthub-data/workspaces/<conversationId>/
  mode            text NOT NULL default 'sandbox'  // 'sandbox' | 'local'
  bound_path      text                 // mode='local' 时填，绝对路径；sandbox 时为 null
  created_at      int  NOT NULL
}
```

**1:1 与 conversations**：`UNIQUE(conversation_id)` 保证。

**mode 语义**（详见 Spec 01 + Spec 07）：
- `sandbox`：bash / fs_read / fs_write 的 cwd 用 `root_path`（隔离目录），强制 100MB / 1000 文件配额
- `local`：cwd 用 `bound_path`（用户本机真实目录），不强制配额

**物理目录**：DB 行删除时 cascade 由 SQLite 处理；`root_path` 目录由 `conversation-service.deleteConversation` 手动 `rmSync(...)` 清除（容错：失败仅 warn）。`bound_path` 不删（那是用户的真实项目）。

---

## 6. attachments

```ts
attachments {
  id              text PK              // att_<nanoid>
  conversation_id text NOT NULL FK→conversations.id  ON DELETE CASCADE
  kind            text NOT NULL        // 'image'|'file'
  file_name       text NOT NULL
  file_path       text NOT NULL        // 相对 workspace.root_path，例如 'attachments/<id>-<filename>'
  size            int  NOT NULL
  mime_type       text NOT NULL
  created_at      int  NOT NULL
}
INDEX idx_attachments_conv ON (conversation_id)
```

**约束**：
- `file_path` 始终在 `workspace.rootPath` 子树内（防越权，由上传 handler enforce）
- 单会话上限：100MB / 1000 文件（详见 CLAUDE.md §5.3）

**与 Message 的关系**：发消息时把附件 ID 传给 `sendMessage`，service 把每个附件转成对应的 `image_attachment` / `file_attachment` MessagePart 塞到 message.parts 里（见 Spec 03）。附件本身不删除，可被多条消息引用。

---

## 7. agent_runs

```ts
agent_runs {
  id                  text PK           // run_<nanoid>
  conversation_id     text NOT NULL FK→conversations.id  ON DELETE CASCADE
  agent_id            text NOT NULL FK→agents.id
  trigger_message_id  text              // 可空：错误降级 run 没有触发消息
  status              text NOT NULL     // 'queued'|'running'|'complete'|'failed'|'aborted'
  error               text              // failed 时存错误概要
  parent_run_id       text              // Orchestrator 派出的子 run 指向父 run
  usage               text JSON         // RunUsage：{ inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, lastInputTokens?, model? }；null = 该 run 未上报（mock / 中途失败）
  started_at          int  NOT NULL
  finished_at         int               // null = 仍在 running
}
INDEX idx_runs_parent ON (parent_run_id)
```

**索引说明**：`idx_runs_parent` 用于 DispatchPlanCard 聚合子 run 状态（按 parent_run_id 拿子 run 列表）。

**生命周期**：`queued → running → (complete|failed|aborted)`，单向流转，service 层 enforce 不允许回退。

---

## Cascade 关系图

```
conversations  ─── CASCADE ──┬─► messages
                             ├─► artifacts
                             ├─► workspaces  (1:1)
                             ├─► attachments
                             └─► agent_runs

agents ──(no cascade)──── messages.agent_id
                          artifacts.created_by_agent_id
                          agent_runs.agent_id
```

**为什么 agents 不 cascade**：删除 agent 不应抹掉历史消息/产物（用户期望「已停用 agent」的灰态保留记录）。前端展示时检测 `agentId` 找不到 → 渲染 stub。

---

## JSON 列规范

所有 `text JSON` 列存的是 **trusted internal data**，由服务端写入，前端读出。不存任意用户输入；用户输入（message content / agent description）走单独的 text 列。

| 列 | 类型 | 说明 |
|---|---|---|
| `agents.capabilities` | `string[]` | 能力标签 |
| `agents.tool_names` | `string[]` | 引用 Spec 07 的工具名 |
| `conversations.agent_ids` | `string[]` | 参与的 agent |
| `conversations.pinned_message_ids` | `string[]` | 用户 pin 的消息 |
| `messages.parts` | `MessagePart[]` | 见 Spec 03 |
| `messages.mentioned_agent_ids` | `string[]` | @ 的 agent |
| `artifacts.content` | `ArtifactContent` | 见 Spec 04，按 type 分发的可辨联合 |

**修改 JSON 列结构时**：旧数据按旧 schema 解析仍合法（向后兼容），否则需要写 migration 脚本（见下节）。

---

## 迁移规范

**开发期**：直接 `pnpm db:push` 让 drizzle-kit 推 schema 到 SQLite。**注意**：drizzle-kit 对带 FK 的列类型变更有时会失败（SQLite 限制），此时写一次性 ALTER TABLE 脚本，命名格式 `src/db/migrate-<topic>.ts`（如 `migrate-add-read-attachment.ts`），用 `tsx src/db/migrate-xxx.ts` 跑。这些脚本跑完不删除（留作历史 + 用 `IF NOT EXISTS` 可重入）。

**生产期**：暂无（项目为本地运行）。如未来要 ship 给用户，应改用 drizzle-kit 的 generate + journal 模式。

---

## ID 前缀对照表

| 实体 | 前缀 | 例 |
|---|---|---|
| Agent | `ag_` | `ag_uQp4Vs8z` |
| Conversation | `conv_` | `conv_KbN6xq2L` |
| Message | `msg_` / `msg_err_` | `msg_xY3w...` |
| Artifact | `art_` | `art_OPbgvF9x` |
| Workspace | `ws_` | `ws_h7Ld...` |
| Attachment | `att_` | `att_qWeR...` |
| AgentRun | `run_` | `run_xT9m...` |
| ToolCall (内存中) | `call_` | `call_aBc...` |

ID 生成器统一在 `src/server/ids.ts`，nanoid 长度 12，URL-safe alphabet。
