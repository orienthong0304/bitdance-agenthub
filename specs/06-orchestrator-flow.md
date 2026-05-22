# Spec 06 — Orchestrator 工作流

> 「主 Agent 协调器」是 AgentHub 的核心差异化能力。本文档定义其触发条件、工作流和数据流。

---

## 定位

Orchestrator 是「特殊 Agent」（详见 Spec 01）：
- `isOrchestrator: true`
- `toolNames` 必含 `dispatch_to_agent`（实际通过 `plan_tasks` 工具暴露给 LLM）
- 走同一个 `AgentRunner`，与普通 Agent 共享代码路径
- 默认 `adapterName: 'custom'`，由用户在创建时选定底层 LLM

**不要**为 Orchestrator 写独立服务。

---

## 触发条件

```
群聊场景（Conversation.mode === 'group'）:
  收到 user 消息时:
    if message.mentionedAgentIds 非空:
       直接为每个被 @ 的 Agent 创建独立 AgentRun
       Orchestrator 不参与
    else:
       查找该会话中 isOrchestrator: true 的 Agent
       若找到 → 触发 Orchestrator 的 AgentRun
       若未找到 → 报错：「群聊缺少协调者」

单聊场景（Conversation.mode === 'single'）:
  Orchestrator 不参与，直接触发那个 Agent
```

**蕴含规则**：群聊里有人 @ 时跳过 Orchestrator。用户的显式选择优先于自动调度。

---

## 三阶段工作流

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: PLAN                                               │
│ ─────────────────────────────────────────────────────────── │
│ 输入：群聊上下文（XML 包装的最近 N 条 + pin） + 用户消息    │
│       + 可用 Agent 列表（动态注入到 system prompt）         │
│ 行为：调底层 LLM，提供 plan_tasks 工具，强制调用           │
│ 输出：tool.call('plan_tasks', { reasoning, tasks })         │
│        → 发 dispatch.plan 事件（UI 渲染调度卡片）           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: EXECUTE                                            │
│ ─────────────────────────────────────────────────────────── │
│ 输入：plan.tasks                                            │
│ 行为：按 dependsOn 做 DAG 拓扑                              │
│       同一波次无依赖任务并行 Promise.all                   │
│       每个子任务：                                          │
│         dispatch.start                                      │
│         AgentRunner.run(subAgentId, subTask, subContext)   │
│         事件全部转发到主事件流                              │
│         dispatch.end                                        │
│ 输出：Map<taskId, TaskResult>                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 3: AGGREGATE                                          │
│ ─────────────────────────────────────────────────────────── │
│ 输入：所有子任务结果（status / artifacts / 关键消息摘要）   │
│ 行为：再调一次 LLM，让 Orchestrator 生成聚合消息             │
│ 输出：一条 agent message，包含：                            │
│       - 完成情况总结                                        │
│       - 失败任务的原因                                      │
│       - 产物链接（artifact_ref parts）                      │
│       - 下一步建议                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## plan_tasks 工具签名

```typescript
const planTasksTool: ToolDef = {
  name: 'plan_tasks',
  description: '把用户请求拆解为子任务并分派给可用 Agent。一次性输出完整 plan。',
  parameters: {
    type: 'object',
    required: ['reasoning', 'tasks'],
    properties: {
      reasoning: {
        type: 'string',
        description: '简要说明拆解思路，3 句以内',
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'agentId', 'task'],
          properties: {
            id: {
              type: 'string',
              description: '子任务 id，使用 t1/t2/t3 形式',
            },
            agentId: {
              type: 'string',
              description: '执行该子任务的 Agent id，必须在可用列表中',
            },
            task: {
              type: 'string',
              description: '给该 Agent 的具体任务描述，独立可执行',
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: '前置依赖的子任务 id 列表，无依赖则省略',
            },
          },
        },
      },
    },
  },
  handler: async (args, ctx) => {
    // plan_tasks 的 handler 不实际「执行」，
    // 它只是把 plan 透传给 AgentRunner 让其调度。
    // 这里返回的 ok=true 让 LLM 知道 plan 已被接受。
    return { ok: true, value: { acknowledged: true, taskCount: args.tasks.length } }
  },
}
```

**说明**：`plan_tasks` 是「输出端工具」——它的目的是让 LLM 用结构化方式输出 plan，而不是真的去做什么副作用。

---

## Orchestrator 的 system prompt 模板

```
你是 AgentHub 的 Orchestrator，负责把用户请求拆解并分派给合适的 Agent。

【你的工作流】
1. 阅读群聊上下文与用户最新请求
2. 调用 plan_tasks 工具，输出结构化 plan
3. 等待系统执行 plan（你不需要做任何事）
4. 系统会再次唤起你做聚合总结

【可用 Agent 列表】
{{AGENT_LIST}}
（每个 Agent 包含 id、name、capabilities、description）

【拆解原则】
- 充分利用每个 Agent 的 capabilities
- 能并行的尽量并行（不写 dependsOn）
- 有依赖关系的明确写 dependsOn
- 每个子任务给出独立可执行的描述（被分派的 Agent 看不到完整群聊上下文）
- 不要重复拆解已有产物已满足的需求

【输出规则】
- 你只能调用 plan_tasks 工具，不要直接回复用户文字
- plan 一次性输出完整，不要分多次调用
```

---

## 子 Agent 看到的上下文

子 Agent 收到的 prompt 由 Orchestrator 的 `task` 字段 + 摘要包装而成：

```xml
<context>
  <recent_conversation>
    <!-- 最近 5 条群聊消息，按 Spec 03 的 XML 包装 -->
    <message from="user">帮我做一个番茄钟网站</message>
    <message from="orchestrator">[Orchestrator 的上一条消息]</message>
  </recent_conversation>

  <pinned_messages>
    <!-- 用户 pin 的关键消息 -->
  </pinned_messages>

  <existing_artifacts>
    <!-- 仅列 id/title/type，不内联内容 -->
    <artifact id="art_001" type="document" title="番茄钟 PRD" by="PM"/>
    <artifact id="art_002" type="image" title="UI 设计稿" by="Designer"/>
  </existing_artifacts>
</context>

<your_task>
  {{ Orchestrator plan 里指派给这个 agent 的 task 字段 }}
</your_task>
```

**lazy load**：子 Agent 需要某个产物详情时，调用 `read_artifact(id)` 工具按需获取。

**上下文截断**：`recent_conversation` 取最近 5 条 + 所有 pin。超出可配置上限（默认 5）的不传。

---

## DAG 调度算法

```typescript
async function executePlan(
  plan: DispatchPlanItem[],
  ctx: { parentRunId: string, conversationId: string }
): Promise<Map<string, TaskResult>> {
  const completed = new Map<string, TaskResult>()
  const remaining = new Set(plan.map(t => t.id))

  while (remaining.size > 0) {
    // 找出所有依赖已满足的任务
    const ready = plan.filter(t =>
      remaining.has(t.id) &&
      (t.dependsOn ?? []).every(d => completed.has(d))
    )

    if (ready.length === 0) {
      throw new Error('Circular dependency or missing dependency in plan')
    }

    // 同一波并行执行
    const results = await Promise.all(
      ready.map(t => runSubTask(t, completed, ctx))
    )

    for (let i = 0; i < ready.length; i++) {
      completed.set(ready[i].id, results[i])
      remaining.delete(ready[i].id)
    }
  }

  return completed
}

async function runSubTask(
  task: DispatchPlanItem,
  upstream: Map<string, TaskResult>,
  ctx: { parentRunId: string, conversationId: string }
): Promise<TaskResult> {
  const subRunId = generateRunId()
  publish({ type: 'dispatch.start', parentRunId: ctx.parentRunId,
            childRunId: subRunId, taskId: task.id, agentId: task.agentId, ... })

  try {
    const result = await AgentRunner.run({
      agentId: task.agentId,
      conversationId: ctx.conversationId,
      runId: subRunId,
      parentRunId: ctx.parentRunId,
      prompt: buildSubAgentPrompt(task, upstream, ctx.conversationId),
    })
    publish({ type: 'dispatch.end', childRunId: subRunId, taskId: task.id,
              status: 'complete', ... })
    return { taskId: task.id, status: 'complete', artifacts: result.artifacts }
  } catch (err) {
    publish({ type: 'dispatch.end', childRunId: subRunId, taskId: task.id,
              status: 'failed', ... })
    return { taskId: task.id, status: 'failed', error: String(err) }
  }
}
```

---

## 失败降级

**策略**：记录上报，由 Orchestrator 在聚合阶段决定向用户的措辞。

```
子 Agent run 失败:
  AgentRunner 内重试 1 次（仅对网络/速率限制类错误，识别条件：error message 含
  'rate limit' / 'timeout' / 'network' / 'ECONNRESET'）
  仍失败 → TaskResult.status = 'failed'，error 字段记录原因

Stage 3 聚合时，Orchestrator 看到的 prompt 包含所有任务状态：
  <task_results>
    <result task="t1" agent="pm" status="complete">
      <artifact_ref id="art_001"/>
    </result>
    <result task="t2" agent="design" status="failed">
      <error>Rate limited by upstream provider, retry exhausted</error>
    </result>
  </task_results>

Orchestrator 据此生成聚合消息。
```

**不做的事**：
- ❌ AgentRunner 层不做「换个 Agent 重试」的逻辑（Orchestrator 决定，必要时再次 plan）
- ❌ 不做无限重试

---

## 数据流（完整一次群聊请求）

```
1. user 发消息（无 @）→ POST /api/conversations/:id/messages
2. ConversationService 写 user message
3. 找到该会话的 Orchestrator agent，触发 AgentRunner.run(orch, ...)
4. AgentRunner: run.start
5. AgentRegistry.getAdapter(orch) → CustomAgentAdapter (假设 Orchestrator 用 Claude)
6. Adapter.stream() → LLM 调用 plan_tasks 工具
   - 发 tool.call('plan_tasks', { ... })
   - ToolExecutor 执行 plan_tasks handler（实际只是确认）
   - 发 tool.result
7. AgentRunner 在 tool.call 是 plan_tasks 时，
   解析 args.tasks → 转发为 dispatch.plan 事件
   并接管控制，进入 Stage 2
8. AgentRunner.executePlan(...):
   for each wave:
     Promise.all(ready.map(task =>
       AgentRunner.run(subAgent, ..., parentRunId=orchRunId)
     ))
9. 所有子 run 结束 → AgentRunner 回到 Orchestrator，
   把 task_results 作为新一轮 prompt 喂给 Adapter，跑 Stage 3
10. Orchestrator 输出聚合消息
11. run.end
```

---

## Orchestrator 的 LLM 选型

Orchestrator 的 `adapterName: 'custom'`，`modelProvider` 和 `modelId` 在创建时由用户选定。

推荐默认值：
- `modelProvider: 'anthropic'`
- `modelId: 'claude-opus-4-7'`

理由：Orchestrator 重度依赖 tool use + structured output + 多步推理，Claude Opus 在这三项上当前最稳。如用户选其他模型，行为可能下降但接口不变。

---

## 不要做的事

- ❌ 不在 Orchestrator system prompt 里硬编码具体 Agent 名字（动态注入 `{{AGENT_LIST}}`）
- ❌ 不为 Orchestrator 开辟独立的 API 端点或服务类
- ❌ 不让 Orchestrator 在 plan 阶段直接调用子 Agent（必须通过 plan_tasks 透传 plan，AgentRunner 负责实际调度）
- ❌ 不在 plan 中允许循环依赖（DAG 调度器会拒绝并报错）
- ❌ 不让子 Agent 看到完整群聊历史（隔离 + lazy load）

---

## 单元测试关注点

- DAG 拓扑排序的正确性（diamond、链、并行的混合）
- 循环依赖检测
- 重试逻辑只对网络类错误生效
- plan 中引用不存在的 agentId 时的报错路径
- Orchestrator system prompt 注入 `{{AGENT_LIST}}` 后的格式
