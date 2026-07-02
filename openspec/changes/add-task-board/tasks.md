## 1. Persistence 与共享类型

- [x] 1.1 `tasks` 表（id `task_` 前缀 / title / note / status / source / conversationId? / messageId? / artifactId? / dispatchTaskId? / createdByAgentId? / createdAt / updatedAt）+ bootstrap DDL + drizzle 同步。
- [x] 1.2 共享 `BoardTask` 类型（`src/shared/types.ts`）。`task.update` StreamEvent **deferred v1.1**：v1 没有跨面板实时推送，`TaskBoardPanel` 挂载时 `fetchBoardTasks()` 全量兜底（见 specs/09 Lazy load 策略）。

## 2. 服务与 API

- [x] 2.1 `task-service.ts`：CRUD + 状态流转 + dispatch 同步入口（幂等 upsert by dispatchTaskId）。
- [x] 2.2 `/api/tasks` 路由（list / create / patch / delete），zod 校验。
- [ ] 2.3 EventBus 推 `task.update`，store reducer 应用 —— **deferred v1.1**（依赖 1.2 的 StreamEvent，同一原因未做）。

## 3. 工具与 Orchestrator 接线

- [x] 3.1 `create_task` 工具（title 必填 ≤120 字、note ≤2000 字；ctx 自动带 conversationId / agentId）+ registry 注册。
- [x] 3.2 claude-code / codex 的 AgentHub MCP bridge 暴露 create_task；custom adapter 工具集与 builder 勾选项加入。
- [x] 3.3 AgentRunner：plan 批准时登记 dispatch 任务；子任务状态回调同步看板（单向）。

## 4. UI

- [x] 4.1 IconRail 第五导航「任务」（badge = open+blocked 数，从 `boardTasks` store 切片读）。
- [x] 4.2 `task-board-panel.tsx`：按状态分组列表、手动建单、状态切换、任务卡跳回来源会话。
- [ ] 4.3 会话内 agent 建单的确认反馈（工具卡里显示任务 id + 跳转）—— 未做：`create_task` 的 tool_result 目前走通用 `ToolUsePart` JSON 展示，没有专门的任务 id 高亮/跳转 UI。留后续任务。

## 5. 测试与文档

- [ ] 5.1 task-service 纯函数与状态流转单测（`mapDispatchStatusToBoard`，已覆盖）；dispatch 同步幂等单测（`upsertDispatchTask` / `syncDispatchTaskStatus` 的 DB 集成测试）**未覆盖**，留后续任务。
- [x] 5.2 E2E：mock agent 场景「建任务」关键词 → create_task → 看板出现该任务（`e2e/tasks.spec.ts`）。
- [x] 5.3 specs/01/07/08/09 同步 + OVERVIEW 矩阵。specs/02 本次不改动 —— v1 无 `task.update` StreamEvent（见 1.2 / 2.3 deferred v1.1）。
