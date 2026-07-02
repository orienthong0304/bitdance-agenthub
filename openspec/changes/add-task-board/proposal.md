## Why

对标 Helio 的差距分析（`docs/helio-gap-analysis.md`）指出：AgentHub 的「任务」只活在单次 Orchestrator dispatch 卡里，跨会话不可见、run 结束即沉没；Agent 也无法把「发现该做的事」沉淀成待办。个人用户同时开多个会话跑多个项目时，缺一个「我现在有哪些事在跑 / 卡着 / 做完了」的全局入口。

## What Changes

- 新增 `tasks` 一等实体与 `task-board` 能力：跨会话聚合的任务看板（侧栏第五导航），状态 `open` / `in_progress` / `done` / `blocked`，可回链来源会话 / 消息 / 产物。
- 任务三种来源：
  1. **用户手动**：看板内直接创建 / 编辑 / 拖动状态。
  2. **Orchestrator dispatch 自动登记**：plan 批准时每个子任务登记为看板任务，dispatch 状态流转自动同步（pending→open、running→in_progress、complete→done、failed/blocked→blocked）。
  3. **Agent 主动建单**：新工具 `create_task`（title、note?、conversationId 自动带上），Agent 在对话中发现后续事项时立单——Helio 的标志性能力。
- 看板任务不是调度指令：看板不反向触发 run（第一版），它是可视化与备忘层；用户从任务卡跳回会话继续推进。
- UI：二级面板新增「任务」视图（分组列表按状态），设计语言沿用 redesign-ui-shell 的 token 体系。

## Capabilities

### New Capabilities

- `task-board`：任务实体、三种来源、状态流转、跨会话看板视图、`create_task` 工具边界。

### Modified Capabilities

- `persistence`：新增 `tasks` 表。
- `tools`：新增 `create_task` 工具（所有 adapter 可用，走 toolRegistry + SDK MCP bridge）。
- `orchestrator`：dispatch 子任务登记 / 状态同步到看板。
- `frontend`：IconRail 第五导航 + 任务面板视图。

## Impact

- `src/db/schema.ts` + bootstrap：`tasks` 表（id/title/note/status/source/conversationId?/messageId?/artifactId?/dispatchTaskId?/createdAt/updatedAt）。
- `src/server/task-service.ts`（新）：CRUD + dispatch 同步入口。
- `src/server/tools/create-task.ts`（新）+ registry + claude-code/codex MCP bridge 注册。
- `src/server/agent-runner.ts`：plan 批准与 dispatch 状态回调处登记 / 同步。
- `src/app/api/tasks/**`（新）。
- `src/components/icon-rail.tsx` / `sidebar.tsx`：第五导航 + 任务面板组件（新 `task-board-panel.tsx`）。
- StreamEvent：新增 `task.update` 事件推前端（遵循 specs/02 契约扩展流程）。
- Docs：specs/01（实体）、02（事件）、07（工具）、08（schema）、09（前端）同步。
