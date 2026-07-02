## 1. Persistence 与共享类型

- [ ] 1.1 `tasks` 表（id `task_` 前缀 / title / note / status / source / conversationId? / messageId? / artifactId? / dispatchTaskId? / createdByAgentId? / createdAt / updatedAt）+ bootstrap DDL + drizzle 同步。
- [ ] 1.2 共享 `BoardTask` 类型与 `task.update` StreamEvent（specs/02 扩展流程）。

## 2. 服务与 API

- [ ] 2.1 `task-service.ts`：CRUD + 状态流转 + dispatch 同步入口（幂等 upsert by dispatchTaskId）。
- [ ] 2.2 `/api/tasks` 路由（list / create / patch / delete），zod 校验。
- [ ] 2.3 EventBus 推 `task.update`，store reducer 应用。

## 3. 工具与 Orchestrator 接线

- [ ] 3.1 `create_task` 工具（title 必填 ≤120 字、note ≤2000 字；ctx 自动带 conversationId / agentId）+ registry 注册。
- [ ] 3.2 claude-code / codex 的 AgentHub MCP bridge 暴露 create_task；custom adapter 工具集与 builder 勾选项加入。
- [ ] 3.3 AgentRunner：plan 批准时登记 dispatch 任务；子任务状态回调同步看板（单向）。

## 4. UI

- [ ] 4.1 IconRail 第五导航「任务」（badge = open+blocked 数）。
- [ ] 4.2 `task-board-panel.tsx`：按状态分组列表、手动建单、状态切换、任务卡跳回来源会话。
- [ ] 4.3 会话内 agent 建单的确认反馈（工具卡里显示任务 id + 跳转）。

## 5. 测试与文档

- [ ] 5.1 task-service 纯函数与状态流转单测；dispatch 同步幂等单测。
- [ ] 5.2 E2E：mock agent 场景「建任务」关键词 → create_task → 看板出现该任务。
- [ ] 5.3 specs/01/02/07/08/09 同步 + OVERVIEW 矩阵。
