# Spec 07 — 工具系统

> 工具是 Agent 在对话中调用的「副作用入口」：写产物、读附件、调度子任务等。本 spec 定义工具接口、Registry 行为、内置工具清单与新增工具的步骤。

源文件：`src/server/tools/`

---

## 设计原则

1. **工具是无状态函数**：`handler(args, ctx) → ToolResult`，每次调用独立
2. **JSON Schema 同时给两端用**：LLM API 的 function calling 声明 + 我们自己的 zod 运行时校验（zod schema 在 handler 内部，JSON Schema 在 `parameters` 字段）
3. **错误不抛出，包装成 `ToolResult`**：Registry 的 `execute` 会 catch handler 抛出的异常并包成 `{ ok: false, error }`，让 Adapter 把错误注入 tool_result part 给 LLM 看到
4. **工具执行属 L3，不是 Adapter 的事**：但代码现状放宽 —— `CustomAgentAdapter` 直接 `import { toolRegistry }` 并自跑 tool loop（见 Spec 05 的「现状说明」）

---

## 接口定义

```typescript
interface ToolDef {
  name: string                       // 工具名，全局唯一
  description: string                // 给 LLM 看的说明
  parameters: Record<string, unknown> // JSON Schema，描述 args 形状
  handler: (args: unknown, ctx: ToolContext) => Promise<ToolResult>
}

interface ToolContext {
  conversationId: string
  workspacePath: string
  agentId: string
  runId: string
  abortSignal: AbortSignal
}

type ToolResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }
```

**约束**：
- `name` 必须是 LLM 可调用的标识符（`^[a-zA-Z0-9_]+$`，不含点号 / 横线）
- `handler` 内部应当使用 `zod` 二次校验 `args`（即便 LLM 按 JSON Schema 生成，也可能漂移）
- `handler` 必须尊重 `ctx.abortSignal`，长耗时操作应轮询或 `signal.addEventListener('abort', ...)`

---

## Registry 行为

源文件：`src/server/tools/registry.ts`

```typescript
class ToolRegistry {
  register(tool: ToolDef): void         // 重名 throw
  get(name): ToolDef | undefined        // 不存在返回 undefined
  resolve(names: string[]): ToolDef[]   // 任一不存在 throw
  execute(name, args, ctx): Promise<ToolResult>  // 不存在/handler throw → ok:false
}

export const toolRegistry = buildRegistry()
```

**重要**：`toolRegistry` 是**模块级单例**，但**不**用 `globalThis` 跨 HMR 缓存。原因：工具集是静态的（不持有 DB 连接、不订阅事件、无内存状态），每次模块重载重建即可，新增工具在 dev 模式自动生效。这与 `EventBus`（需要跨 HMR 保持订阅）的处理不同，详见 Spec 02 注。

---

## 内置工具清单

| 名称 | 用途 | 副作用 | 谁该装备 |
|---|---|---|---|
| `write_artifact` | 创建产物 | 写 DB | 任何产出代码 / 文档 / 网页的 agent |
| `deploy_artifact` | 为 web_app 生成部署发布状态 | 写 `.agenthub-data/deployments`；可选发布到用户配置的外部静态目录；返回 preview path 与下载路径 | 前端 / web app 产出 agent |
| `read_artifact` | 读已有产物的完整内容 | 读 DB | 跨任务复用产物的 agent（Orchestrator 派的子 agent 常用） |
| `read_attachment` | 读用户上传附件 | 读文件系统 | 处理用户文档 / 文本附件的 agent |
| `plan_tasks` | Orchestrator 拆解子任务 | 无（输出端工具） | **仅 Orchestrator** |
| `report_task_result` | 子任务上报最终语义结果 | 无（输出端工具） | Orchestrator 派发的子 agent（AgentRunner 自动注入） |
| `fs_read` | 读 workspace 内文本文件 | 读文件系统 | 需要看用户项目代码的 agent |
| `fs_write` | 写 workspace 内文本文件 | 写文件系统 | 需要生成 / 修改文件的 agent |
| `bash` | 在 workspace 内跑 shell 命令 | 进程 / 文件系统 | 需要 git / 编译 / 测试的 agent |

### write_artifact

源文件：`src/server/tools/write-artifact.ts`

**当前限制**：`type` 接受 `'web_app' | 'document' | 'image' | 'ppt'`。`diff` 不再由 Agent 通过 `write_artifact` 创建；产物差异由前端版本对比从已存 artifact versions 确定性生成。`code_file` 不由 LLM 直接创建，避免把大文件内容塞进 DB 或绕过 workspace 文件写入路径。

**入参容错（drift 增量）**：handler 会接受 4 种 `content` 形状并归一化到标准 `ArtifactContent`（见 Spec 04）：

| 输入形态 | 处理 |
|---|---|
| `{ files: { ... }, entry: 'index.html' }` | 标准形态，直接用 |
| `{ html: '...', css?, js? }` | 扁平形态，映射到 `index.html` / `style.css` / `script.js` |
| `{ content: '<html>...' }` 或 `{ code: '...' }` | 单文件 HTML，作为 `index.html` |
| `'<html>...'` 裸字符串 | 同上 |

`document` 接受 `{ content }` / `{ markdown }` / `{ text }` / 裸字符串；`image` 接受 `{ url, alt? }` 或裸 URL 字符串；`ppt` 接受 `{ title?, theme?, slides }`。历史 `diff` 内容归一化逻辑仍保留在 `src/server/artifact-content.ts` 给旧数据兼容，但不在 `write_artifact` 的 zod schema、JSON Schema 或 LLM 描述中暴露。

**返回值**：`{ artifactId, title, type }`。**不发布 `artifact.create` 事件**，由 Adapter 在 tool_result 后统一发，AgentRunner 接住后注入 `artifact_ref` part（见 Spec 02 的「artifact_ref 注入路径」）。

### deploy_artifact

源文件：`src/server/tools/deploy-artifact.ts`

**入参**：`{ artifactId: string }`

**作用域**：只能部署当前会话的 artifact。只有 `web_app` 返回 `status:'ready'`；缺失、非 web artifact 或不安全文件路径返回 `status:'failed'` 的部署记录，供 UI 显示失败原因。

**返回值**：`DeployStatusRecord`。无外部发布配置时，`previewPath` 指向稳定 `/deployments/:deploymentId`，记录带 `deploymentType:'local_static'`、`sourceDownloadPath`、`containerDownloadPath`、`summaryInstruction`。如果 `app_settings.deployment_publish_enabled=true` 且配置了 `deployment_publish_dir` / `deployment_public_base_url`，工具会把公开静态文件复制到 `<deployment_publish_dir>/<deploymentId>/`，并返回 `deploymentType:'external_static'`、`previewPath:<publicUrl>`、`publicUrl`、`publishPath`、`localPreviewPath`。Adapter 在 tool_result 后 emit `deploy.status`，AgentRunner 注入 `deploy_status` part。

**本地发布目录**：`src/server/deployment-service.ts` 把 `web_app` 写入 `.agenthub-data/deployments/dep_xxx/`，对外根目录保存可运行静态文件，私有 `.agenthub/source` 保存原始 source 供源码包下载。发布路由拒绝 `.agenthub` 私有目录与路径逃逸。

**外部静态发布目录**：`deployment_publish_dir` 必须是绝对路径且不能是文件系统根目录。发布时只删除 / 覆盖 `<publishDir>/<deploymentId>` 子目录，且复制公开文件时不会带上 `.agenthub` 私有目录。`deployment_public_base_url` 是用户已有静态服务的公开根 URL，AgentHub 只负责写文件，不启动托管服务。

### 确定性部署命令

源文件：`src/server/deploy-command-service.ts`、`src/app/api/conversations/[id]/deploy/route.ts`

用户发送精确命令 `部署` / `发布` / `上线` / `/deploy` 时，`conversation-service.sendMessage` 在 responder 选择前拦截，不启动 AgentRun。命令只作用于当前会话的 `web_app` artifacts：

- 0 个候选：插入 system text message，提示当前会话没有可部署网页产物。
- 1 个候选：复用 `deploy_artifact` 的会话级 helper 直接部署，并插入 `deploy_status` part。
- 多个候选：插入 `deploy_candidates` part，让用户在 UI 中选择。选择后由 `POST /api/conversations/:id/deploy { artifactId }` 部署并插入 `deploy_status` part。

命令可带明确 artifact id：`/deploy art_xxx` / `部署 art_xxx`。服务端仍校验 artifact 必须属于当前会话且是 `web_app`；缺失或类型错误通过 failed `DeployStatusRecord` 展示。

### read_artifact

源文件：`src/server/tools/read-artifact.ts`

**作用域**：只能读**当前会话**的 artifact（`WHERE conversation_id = ctx.conversationId`），防越权。

**返回值**：`{ id, type, title, content, version }`，content 是完整的 `ArtifactContent`（可能很大，调用方自行决定塞回 LLM 多少）。

### read_attachment

源文件：`src/server/tools/read-attachment.ts`

**与 read_artifact 的区分**：
- `att_` 前缀 → attachment（用户上传到文件库）
- `art_` 前缀 → artifact（agent 自己产出）
- 传错前缀时 handler 给友好提示，不静默失败

**按 MIME 分支**：
- 文本类（`text/*` / `application/json` / `application/xml` / `application/javascript` / `application/x-yaml`）：直接 `readFileSync(utf8)`，截断到 50,000 字符（防 prompt 爆炸）
- 图片：返回 metadata + note，告知 LLM 图片已通过 multimodal channel 投递（见 Spec 05 multimodal 部分）
- 其他二进制（PDF / docx / zip）：仅返回 metadata + note。**TODO**：PDF 文本抽取（标 P1，需引入 `pdf-parse` 类依赖，按 CLAUDE.md §6.2 要先讨论）

**容量**：`MAX_TEXT_CHARS = 50_000`。

### plan_tasks

源文件：`src/server/tools/plan-tasks.ts`

**特殊**：这是「输出端工具」—— handler 仅校验参数并返回 `{ acknowledged: true, taskCount }`，**真正的副作用（拆分子 run、DAG 调度）在 AgentRunner 里**（见 Spec 06）。

**参数**：
```typescript
{
  reasoning: string         // 拆分理由，3 句以内
  tasks: Array<{
    id: string              // 't1' / 't2' / 't3'...
    agentId: string         // 群里现有 agent id
    task: string            // 给该子 agent 的完整指令（自包含，子 agent 看不到群聊历史）
    dependsOn?: string[]    // 前置任务 id，省略 = 可立即开始
    expectedOutputs?: Array<{
      id: string            // 真实 artifact 输出的符号 key，不是 artifact id
      type: 'web_app' | 'document' | 'image' | 'ppt'
      required?: boolean    // 默认 true；用于标记交接意图，不直接决定任务状态
      description?: string
    }>
    inputs?: Array<{
      fromTaskId: string
      outputId: string
      required?: boolean    // 默认 true；required 输入缺失会让任务 skipped
      description?: string
    }>
    acceptanceCriteria?: string[] // 非产物型任务的完成条件提示
  }>
}
```

`expectedOutputs` 只用于真实 artifact 交接：下游要读、用户要预览、或任务本身要求写入可独立产物时才声明。审查、验证、诊断、状态检查、解释、总结等文字型任务不要为了“完成状态”声明 `expectedOutputs`；这类任务用 `acceptanceCriteria` 描述完成条件，并由 child agent 通过 `report_task_result.acceptanceResults` 逐项上报。

**装备约束**：只有 `isOrchestrator=true` 的 agent 才应装备 `plan_tasks`（service 层未强制，但前端 UI 不允许给非 Orchestrator agent 勾选）。

### report_task_result

源文件：`src/server/tools/report-task-result.ts`

**特殊**：这是「输出端工具」——handler 只校验并回传结构化结果，不写 DB、不写 workspace、不创建 artifact。AgentRunner 只在 Orchestrator 派发的子任务 run 中自动注入该工具；普通单聊 agent 不需要手动装备。

**参数**：

```typescript
{
  status: 'complete' | 'failed' | 'blocked'
  summary: string
  acceptanceResults?: Array<{
    criterion: string
    passed: boolean
    evidence: string
  }>
  blockers?: string[]
}
```

**语义**：
- 子任务结束前必须调用一次 `report_task_result`。普通文本回复不能单独证明任务成功。
- `status='complete'` 只表示该子任务真的完成、`acceptanceCriteria` 已逐项通过；不要因为产出了一条普通回复或一个 artifact 就自动标 complete。
- `status='failed'` 表示已尝试但未满足任务；`status='blocked'` 表示缺少外部输入 / 前置条件导致无法推进。
- 如果测试失败、实现不完整、有未解决错误、找不到必要文件 / 依赖，必须上报 `failed` 或 `blocked`，不能上报 `complete`。
- 当 plan 含 `acceptanceCriteria` 时，child agent 必须在 `acceptanceResults` 中复制每条 criterion 原文，并给出 `passed/evidence`。AgentRunner 缺项或发现 `passed=false` 时，把该任务判为 `failed`。
- 由于 `DispatchTaskStatus` 当前没有 `blocked`，`blocked` report 在 dispatch 层映射为 `failed`，错误原因保留 blocked summary / blockers；下游任务照常 skipped。

### fs_read

源文件：`src/server/tools/fs-read.ts`

读 workspace 内文本文件。

**参数**：`{ path: string }`，相对（基于 effective cwd）或绝对路径，resolve 后必须落在 effective cwd 子树内（`assertPathWithinWorkspace`，详见 `src/server/workspace-utils.ts`）。

**限制**：
- 文件大小上限 **1 MB**（`statSync.size > 1_048_576` 拒）
- 文本截断到 **50,000 字符**（同 `read_attachment` 风格）
- 仅 utf-8

**返回**：`{ path, absolutePath, cwd, size, content, truncated }`

### fs_write

源文件：`src/server/tools/fs-write.ts`

写 workspace 内文本文件。

**参数**：`{ path: string, content: string }`。路径同 `fs_read` 沙箱规则；父目录自动 `mkdir -p`。

**限制**：
- 单文件大小上限 **100 KB**（`Buffer.byteLength`）
- **sandbox 模式**额外检查 workspace 总量：累计 size > 100 MB 或文件数 > 1000 拒（递归扫 `rootPath`）
- **local 模式**跳过总量检查（用户自管理）

**返回**：`{ path, absolutePath, cwd, bytes, applied: 'auto' | 'review' }`。`applied` 标识用户审批路径还是直接写。

**冲突追踪**：写入成功后记录 `(runId, absolutePath, 内容 hash)`（`dispatch-file-writes.ts`），供 Orchestrator 检测同波次多个子 Agent 写同一文件（详见 Spec 06「代码冲突检测」）。bash / SDK adapter 自写盘不经 `fs_write`，是已知盲区。

#### fs_write 审批模式

人手编辑（FileTab 内自己改保存）**不走审批** —— 用户改自己的代码不需要审批自己。
**Agent** 调 `fs_write` 才走审批，由 `conversation.fsWriteApprovalMode` 决定：

- `'auto'`：直接写，工具立即返回 `applied: 'auto'`。适合反复改、信任度高的场景
- `'review'`（默认）：注册 PendingWrite，发 `fs_write.pending` SSE，前端弹 `PendingWriteApprovalDialog`
  显示 `react-diff-viewer-continued` 双栏 diff。用户决定后：
  - **应用** → handler 调 `writeFileInWorkspace` 真写盘，发 `fs_write.resolved { applied: true }`，工具返回 `applied: 'review'`
  - **拒绝** → 不写盘，发 `fs_write.resolved { applied: false }`，工具返回 `{ ok: false, error: 'User rejected the file change' }`
  - **run abort** → 静默取消（不发 SSE），工具返回 rejected

实现细节：
- `pendingWrites` 是模块级单例（HMR-safe via globalThis），见 `src/server/pending-writes.ts`
- handler 注册后 `await new Promise(resolve => pendingWrites.attachResolver(id, resolve))` 阻塞，直到 approve / reject / abort 触发 resolver
- pending 队列**纯内存**，dev server 重启即丢失。前端 `PendingWriteApprovalDialog` mount 时 `GET /api/conversations/[id]/pending-writes` 拉一次兜底（处理刷新场景）

切换模式：`PATCH /api/conversations/[id]` body `{ fsWriteApprovalMode: 'auto' | 'review' }`。Chat panel header 有 Shield/Zap 图标 toggle 按钮。

### bash

源文件：`src/server/tools/bash.ts`

在 workspace 内跑 shell 命令。

**参数**：`{ command: string }`。

**流程**：
1. 命中 `getBannedPatterns(currentPlatform())` 黑名单（POSIX / Windows 各一套，详见 Spec 11）→ 拒
2. `child_process.spawn(shell.cmd, shell.args(command), { cwd: getEffectiveCwd(workspace), windowsHide: true })`
   - 跨平台 shell（详见 Spec 11 「Shell 选择」节）：
     - POSIX：`sh -c <command>`
     - Windows：`powershell.exe -NoProfile -NonInteractive -Command "chcp 65001 > $null; <command>"`（用系统自带 PS 5.1，chcp 65001 强制 UTF-8 输出）
3. stdout + stderr 合并截断 **10000 字符**
4. **30s 超时**：进程清理走 `killProcessTree`
   - POSIX：`child.kill('SIGTERM')`
   - Windows：`taskkill /F /T /PID <pid>` 递归杀进程树（Node 的 SIGTERM 在 Windows 杀不到孙子进程）
5. `ctx.abortSignal` 触发同样的 `killProcessTree`
6. **不支持** stdin / 环境变量定制 / pty / TUI

**工具 description 按平台变体**（详见 Spec 11 「工具描述按平台变体」节）：description 字段在模块加载时根据 `currentPlatform()` 拼接，POSIX 展示 sh 示例与 POSIX 黑名单文案，Windows 展示 PowerShell 示例与 Windows 黑名单文案。这是 LLM 选择命令语法的关键提示。

**返回**：`{ cwd, command, exitCode, output, truncated, timedOut }`

---

## 工具调用生命周期

```
LLM 决定调用 →  Adapter emit  tool.call (StreamEvent)
                              │
                              ▼
                  AgentRunner 持久化为 tool_use part
                              │
                              ▼
   Adapter 自跑 ToolExecutor: toolRegistry.execute(name, args, ctx)
                              │
                              ▼
                  Adapter emit  tool.result (StreamEvent)
                              │
                              ▼
                  AgentRunner 持久化为 tool_result part
                              │
                  （前端把同 callId 的 tool_use + tool_result
                    合并为一个工具卡片，见 Spec 03 / 09）
```

**callId 串联**：`call_<nanoid>`，由 Adapter 在 tool.call 时分配，tool.result 必须带回相同 callId（用于前端合并 + LLM 的下一轮 turn）。

---

## 错误处理契约

| 场景 | handler 应该 | Registry 表现 | LLM 看到的 |
|---|---|---|---|
| args 不符合 schema | 返回 `{ ok: false, error }` | 透传 | tool_result.isError=true，error 文字 |
| 业务校验失败（如 artifact 不存在） | 返回 `{ ok: false, error }` | 透传 | 同上 |
| handler 内部 throw（不该发生） | — | catch 包成 `{ ok: false, error: err.message }` | 同上 |
| AbortSignal 触发 | handler 应尽早返回（行为不强制） | 透传 | 同上 |

**反模式**：不要在 handler 里 `throw new Error('failed')` 来表示业务错误，应当 `return { ok: false, error: ... }`。throw 用于真正的「不该发生」的内部异常。

---

## 新增工具步骤

> 详见 `skills/新增一个工具.md`（待写）。下面是 outline。

1. **决定工具是否需要**：三处重复后才提抽象（CLAUDE.md §4.3）
2. **新建文件** `src/server/tools/<my-tool>.ts`：
   ```typescript
   import { z } from 'zod'
   import type { ToolDef } from './types'
   
   const ArgsSchema = z.object({ ... })
   
   export const myTool: ToolDef = {
     name: 'my_tool',
     description: '...',
     parameters: { type: 'object', required: [...], properties: { ... } },
     async handler(args, ctx) {
       const parsed = ArgsSchema.safeParse(args)
       if (!parsed.success) return { ok: false, error: ... }
       // ...
       return { ok: true, value: ... }
     },
   }
   ```
3. **在 `registry.ts` 注册**：`reg.register(myTool)`
4. **决定哪些 agent 装备**：
   - 改 `src/db/seed.ts` 把工具加到对应 agent 的 `toolNames`（影响新种子）
   - 已存在的 agent 通过「编辑 Agent」对话框勾选（影响数据库现状）
   - 在 `src/components/create-agent-dialog.tsx` 的 `AVAILABLE_TOOLS` 数组加上工具名（UI 才能勾选）
5. **JSON Schema 注意点**：
   - 用 `type: 'object'` 而不是 `oneOf`（DeepSeek / OpenAI 对复杂 schema 兼容性差）
   - `description` 越具体越好，LLM 主要靠这个判断什么时候调用
   - 必填字段必须列入 `required`
6. **测试**：跑一个挂了该工具的 agent，验证调用 / 错误路径 / Abort

---

## 安全 / 沙箱约束

参考 CLAUDE.md §5。任何涉及文件系统 / 命令执行的工具必须：

- **路径解析后落在 `ctx.workspacePath` 子树内**（用 `path.resolve` + `startsWith` 检查）
- **bash cwd 强制为 `ctx.workspacePath`**
- **bash 命令前匹配双平台黑名单**（详见 Spec 11；POSIX：rm -rf /、sudo、fork bomb、curl pipe shell 等；Windows：Remove-Item -Recurse -Force、format、shutdown、iex(iwr ...)、reg delete 等）
- **不引入新依赖而不在 PR 中说明**（CLAUDE.md §4.3）

**`getBannedPatterns(platform)` 跨 adapter / 工具共享**：定义在 `src/server/security.ts`，由 `findBannedPattern(command, platform?)` 暴露（platform 省略时取 `currentPlatform()`）。`bash` 工具和 `ClaudeCodeAdapter`（用 SDK Bash 工具时）都走同一份名单，新增模式同步 Spec 11 「命令黑名单」节并只改 `security.ts` 这一处。

**TODO 工具（CLAUDE.md 提到但仍未实装）**：

- `web_fetch` —— 抓取 URL 内容（SSRF 防护：禁止 localhost / 内网 IP / file://）

**bash / fs_read / fs_write 已实装**（详见上方各自小节）。

新人不要以为未实装的工具已经存在；要么先实现，要么按 Spec 07 §「新增工具步骤」走。

---

## Claude Code agent 的工具集（不走 AgentHub 工具表）

`adapterName === 'claude-code'` 的 agent 不消费上面的「内置工具清单」。它通过 Claude Agent SDK 直接使用 SDK preset 工具集：`Bash` / `Read` / `Write` / `Edit` / `Grep` / `Glob` / `WebFetch` / `WebSearch` / `Task` / `TodoWrite` / `NotebookEdit` / `Mcp` 等（命名为 PascalCase，与 AgentHub 的 snake_case 区分）。

**审批 / 沙箱 / 黑名单仍由 AgentHub 接管**，但接缝在 adapter 的 `canUseTool` 钩子（详见 Spec 05 「ClaudeCodeAdapter / canUseTool 桥」一节）：

- 路径检查走 `assertPathWithinWorkspace`（共享）
- Bash 黑名单走 `findBannedPattern`（共享）
- `fs_write` 审批走同一个 `pendingWrites` store —— 但 `register` 传 `skipWrite: true`，approve 后由 SDK 自己写盘（不调 `writeFileInWorkspace`）。前端 UI（`PendingWritesPanel` / `PendingWriteDiffTab`）对这两条路径完全无感

**副作用**：sandbox 模式 quota（`SANDBOX_TOTAL_BYTES` / `SANDBOX_TOTAL_FILES`）对 Claude Code agent 失效（SDK 自己写盘绕过 quota 检查）。Claude Code agent 实际场景都是 `workspace.mode === 'local'`（绑真实项目），quota 不适用，可接受。

**AgentHub MCP 工具**：Claude Code adapter 通过 SDK in-process MCP server 暴露 `write_artifact` / `read_artifact` / `deploy_artifact` / `ask_user`。其中 `write_artifact` 和 `deploy_artifact` 的结果会被 adapter 翻译为 `artifact.create` / `deploy.status`。

---

## Codex agent 的工具集（不走 AgentHub 工具表）

`adapterName === 'codex'` 的 agent 不消费上面的「内置工具清单」。它通过 `@openai/codex-sdk` 暴露 Codex 自身的本地命令、文件变更、MCP、web search、todo/plan 等事件。

AgentHub 额外给 Codex 注入一个 stdio MCP bridge，只暴露 allowlist：`write_artifact` / `read_artifact` / `deploy_artifact`。bridge 通过受保护的内部 API 调用 `toolRegistry`，不会把 `bash` / `fs_write` 等 AgentHub 工具开放给 Codex。

**审批策略**：当前 Codex TypeScript SDK 没有 Claude `canUseTool` 等价 hook。AgentHub 因此不在 Review 模式下开放自动写盘：

- Review 模式：`sandboxMode='read-only'`
- Auto 模式：`sandboxMode='workspace-write'`
- 所有模式：`approvalPolicy='never'`、`networkAccessEnabled=false`、`webSearchMode='disabled'`
- 运行时：使用 AgentHub 隔离的 `CODEX_HOME=<dataDir>/codex-home`，不读取用户本机 `~/.codex` 配置 / 登录态

后续若 SDK 暴露 patch / exec approval hook，再桥到 `pendingWrites`、`assertPathWithinWorkspace` 和 `findBannedPattern`。

---

## 与 Spec 01 / 05 / 06 的关系

- Spec 01：定义了 `Agent.toolNames`（引用本 spec 的工具名；Claude Code / Codex agent 强制 `[]`）
- Spec 05：定义了 `AdapterInput.toolNames`（同上）；说明 Custom / Claude Code / Codex 路径如何分别使用工具
- Spec 06：`plan_tasks` 工具是 Orchestrator 三阶段工作流的核心
