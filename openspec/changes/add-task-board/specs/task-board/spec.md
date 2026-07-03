## ADDED Requirements

### Requirement: 任务 SHALL 是跨会话的一等实体

任务拥有独立生命周期与状态（`open` / `in_progress` / `done` / `blocked`），可选回链来源会话、消息、产物、dispatch 子任务。删除会话 SHALL NOT 级联删除其任务（来源链接置空，任务保留）。

#### Scenario: 跨会话聚合
- **WHEN** 用户打开任务看板
- **THEN** 看到所有会话产生的任务按状态分组
- **AND** 任务卡可跳回来源会话定位。

### Requirement: 任务 SHALL 支持三种来源

`source ∈ manual / dispatch / agent`。手动任务由用户在看板创建；dispatch 任务在计划批准时登记并随执行状态自动同步；agent 任务由 `create_task` 工具创建。

#### Scenario: dispatch 状态同步
- **WHEN** Orchestrator 子任务状态变化（running / complete / failed / skipped）
- **THEN** 对应看板任务同步为 in_progress / done / blocked
- **AND** 同步是单向的（看板编辑不反向影响 dispatch 执行）。

#### Scenario: Agent 主动建单
- **WHEN** Agent 调用 `create_task` 报告一个后续事项
- **THEN** 看板出现 source=agent 的 open 任务，标注创建者 agent 与来源会话
- **AND** 工具结果告知 Agent 任务 id，供其在回复中引用。

### Requirement: 看板 SHALL NOT 反向触发执行（第一版）

看板是可视化与备忘层：编辑 / 拖动状态只改任务记录，不创建 run、不发消息。

#### Scenario: 状态拖动
- **WHEN** 用户把任务从 open 拖到 done
- **THEN** 仅任务记录更新，无任何 Agent 被唤起。
