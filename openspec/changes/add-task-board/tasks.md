## 1. Persistence 与共享类型

- [x] 1.1 `tasks` 表（id `task_` 前缀 / title / note / status / source / conversationId? / messageId? / artifactId? / dispatchTaskId? / createdByAgentId? / createdAt / updatedAt）+ bootstrap DDL + drizzle 同步。
- [x] 1.2 共享 `BoardTask` 类型（`src/shared/types.ts`）。`task.update` StreamEvent **已于 v1.1 实现**（见 6.1）：`StreamEvent` 联合已加成员，`TaskBoardPanel` 挂载时 `fetchBoardTasks()` 全量兜底 + `task.update` 增量实时同步（见 specs/02「task.update」专节）。

## 2. 服务与 API

- [x] 2.1 `task-service.ts`：CRUD + 状态流转 + dispatch 同步入口（幂等 upsert by dispatchTaskId）。
- [x] 2.2 `/api/tasks` 路由（list / create / patch / delete），zod 校验。
- [x] 2.3 EventBus 推 `task.update`，store reducer 应用 —— **已于 v1.1 实现**（见 6.1）：task-service 四个 mutation 出口单点发射，`app-store.ts` `applyEvent` 加 `task.update` case 幂等 upsert。

## 3. 工具与 Orchestrator 接线

- [x] 3.1 `create_task` 工具（title 必填 ≤120 字、note ≤2000 字；ctx 自动带 conversationId / agentId）+ registry 注册。
- [x] 3.2 claude-code / codex 的 AgentHub MCP bridge 暴露 create_task；custom adapter 工具集与 builder 勾选项加入。
- [x] 3.3 AgentRunner：plan 批准时登记 dispatch 任务；子任务状态回调同步看板（单向）。

## 4. UI

- [x] 4.1 IconRail 第五导航「任务」（badge = open+blocked 数，从 `boardTasks` store 切片读）。
- [x] 4.2 `task-board-panel.tsx`：按状态分组列表、手动建单、状态切换、任务卡跳回来源会话。
- [ ] 4.3 会话内 agent 建单的确认反馈（工具卡里显示任务 id + 跳转）—— 未做：`create_task` 的 tool_result 目前走通用 `ToolUsePart` JSON 展示，没有专门的任务 id 高亮/跳转 UI。留后续任务。

## 5. 测试与文档

- [x] 5.1 task-service 纯函数与状态流转单测（`mapDispatchStatusToBoard`）；dispatch 同步幂等 DB 集成测试已由 6.2 覆盖（in-memory drizzle 注入，10 用例）。
- [x] 5.2 E2E：mock agent 场景「建任务」关键词 → create_task → 看板出现该任务（`e2e/tasks.spec.ts`）。
- [x] 5.3 specs/01/07/08/09 同步 + OVERVIEW 矩阵；specs/02 已随 v1.1 的 `task.update` 事件同步（见 6.1）。

## 6. v1.1 Backlog（Codex 终审 2026-07-03 排定优先级）

- [x] 6.1 `task.update` StreamEvent（P1：影响 agent 建单/dispatch 同步后的实时可见性与 rail badge 准确性；按 specs/02 扩展流程走 delta spec）。task-service 单点发射 + store reducer + e2e 实时 badge 断言，delete 不发事件（面板内操作 + 挂载全量兜底），specs/02 加「task.update」专节。
- [x] 6.2 dispatch 同步 DB 集成测试（P2：`upsertDispatchTask` 幂等 + `syncDispatchTaskStatus` 全终态）。`task-service.test.ts` 用 `vi.mock('@/db/client')` 注入 in-memory drizzle，实测幂等不产生第二行、title 变更发事件/未变不写不发、状态全终态映射、状态未变不写不发、createBoardTask 发事件；同步收敛 `upsertDispatchTask`/`syncDispatchTaskStatus` 无实质变化时的 updatedAt bump（早退不写库不发事件）。
- [ ] 6.3 create_task 工具卡确认反馈（P3：任务 id 高亮 + 跳转看板）。
- [x] 6.4 评估 create_task 在 SDK 桥上的授权控制——**裁定：接受现状**。SDK agent（claude-code/codex）本就不消费 `toolNames`（强制 `[]`，Spec 01），AgentHub MCP 工具组对 SDK agent 一直是固定集合（write_artifact / deploy / ask_user 等同样全量可用），create_task 加入该集合与既有授权模型一致；单独收敛反而制造特例。风险面（agent 噪音立单）由看板可删、来源徽标、仅 open 态缓解，个人使用场景可接受。若未来引入 per-agent MCP 工具授权机制，create_task 纳入同一机制即可。
- [ ] 6.5 e2e `createSingleChat` 抽共享 fixture（四处重复已达阈值）。
