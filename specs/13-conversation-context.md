# Spec 13 — 对话上下文（Conversation Context）

> 多轮对话里 agent 怎么「记住」之前发生的事。这个 spec 定义从 DB messages 表到 LLM 的 `messages` 数组的序列化契约。

源文件：`src/server/conversation-context.ts`（`buildHistoryFor`），`src/server/adapters/types.ts`（`AdapterInput.history` 字段），`src/server/adapters/custom-agent-adapter.ts`（消费侧）。

---

## 背景

`messages` 表（`schema.ts`）一直完整持久化每一轮对话——user prompt 和 agent 的完整 parts 数组。但 `agent-runner.ts` 调用 adapter 时只传**当前触发消息一条 text prompt**，从来不读历史。结果 agent 每次都像新对话，无法记住上一句。这是 spec 13 要解决的核心问题。

CustomAgentAdapter 已有 within-run 的 turn 累计（一个 run 内 LLM 调用 tool → 收到 tool_result → 再调 LLM，这条链路上的 message 累计正常），但**跨 run 没有**。本 spec 解决的是跨 run（一轮新的用户消息触发新 run）的历史延续。

---

## 设计原则

1. **history 是 OpenAI ChatMessage 数组**：adapter 直接拼用，不做转换。L3 服务层负责序列化。
2. **agent 视角隔离**：每个 agent 看到的 history 是「以该 agent 为 LLM 主体」视角下的版本——它自己的发言是 `assistant`，他人发言（如有）是 `user` 带前缀。
3. **artifact 不内联**：history 里的 `artifact_ref` part 折叠成 `[Artifact: title (id=...)]` 文本占位，agent 真要看内容自己 `read_artifact`。
4. **pinned 永远在**：pinned messages 不计入「最近 N 条」额度，永远注入（去重）。
5. **token 预算 Phase D 才做**：Phase A 用简单 N=20 条上限，超出范围用户自行 pin 关键消息。

---

## 核心函数签名

```typescript
interface BuildHistoryOptions {
  /** 取最近多少条 messages（不含 pinned）。默认 20。 */
  maxTurns?: number
  /** 是否把 pinned messages 注入。默认 true。 */
  includePinned?: boolean
}

export async function buildHistoryFor(
  agentId: string,
  conversationId: string,
  options?: BuildHistoryOptions,
): Promise<ChatCompletionMessageParam[]>
```

返回值类型来自 `openai/resources/chat/completions` 的 `ChatCompletionMessageParam` 联合类型（system / user / assistant / tool）。**不含**当前触发消息——那条由 adapter 自己拼到末尾（保持现状）。

---

## Message 选取

1. 查 conversation：`pinnedMessageIds` 字段（来自 `conversations` 表）
2. 查 `messages` 表：`WHERE conversation_id = ? AND status = 'completed'`，按 `created_at ASC` 取最近 `maxTurns` 条
3. 加上 pinned messages（按 id 查，可能在最近 N 条之外）
4. 合并去重（按 id），按 `created_at` 升序排列
5. **排除**当前触发消息（caller 传 `excludeMessageId` 参数）

`status = 'completed'` 的过滤很关键：streaming / failed 状态的消息不应进历史（部分内容、未完成 tool_use 等）。

---

## Part → ChatMessage 序列化

按消息 `role` 和（若是 assistant）`agentId === 当前 agent` 分支：

### user message（role='user'）

`parts` 可能含 `text` / `image_attachment` / `file_attachment`：

- `text` → 拼到 content 文本
- `image_attachment` → **Phase A 用占位文本** `[图片附件: <fileName>]`；Phase D / 多模态升级时再考虑从 DB 重新读 base64 注入 multimodal blocks（成本高，且大多时候用户后续 prompt 已经文本描述过图片内容）
- `file_attachment` → 占位文本 `[文件附件: <fileName>]`

输出：

```typescript
{ role: 'user', content: '......' }
```

### 自己的 assistant message（role='assistant' && agentId === currentAgentId）

把 parts 数组按出现顺序处理。`thinking` 一律丢（agent 不需要看自己上轮的思考过程，且 reasoning 部分有些模型不接受回传）。

收集：
- `text` / `code` → 拼到 assistant content
- `artifact_ref` → 折叠 `[产物: <title> (id=<artifactId>)]` 文本（需要从 artifacts 表 join 出 title；title 拿不到时退化为 `[产物 art_xxx]`）
- `tool_use` → 收集为 `tool_calls`，pair 对应 callId 的 `tool_result`

输出（按 OpenAI schema）：

```typescript
// 主 assistant message
{
  role: 'assistant',
  content: '......text+code+artifact_ref 折叠后的字符串，可为 null',
  tool_calls: [
    {
      id: '<callId>',
      type: 'function',
      function: { name: '<toolName>', arguments: '<JSON.stringify(args)>' }
    },
    ...
  ]
}
// 每个 tool_use 紧跟一条 tool message
{
  role: 'tool',
  tool_call_id: '<callId>',
  content: '<JSON.stringify(result) | result.error 文本>'
}
```

**注意**：tool_calls 数组里所有 callId 必须有对应 tool role message 跟随，否则 OpenAI API 报错。`buildHistoryFor` 必须保证 tool_use / tool_result 配对完整；若某个 tool_use 找不到对应 tool_result（极少情况，如 run abort 留下半截工具），跳过整条 assistant message 不进历史。

### 别 agent 的 assistant message（role='assistant' && agentId !== currentAgentId）

**Phase A / B 跳过**（单聊场景不会出现；群聊在 Phase C 处理）。

---

## Pinned messages 注入

`conversation.pinnedMessageIds` 是用户在 UI 上长按消息 → 「pin」 的消息 id 列表。它们的语义是「无视截断，永远在 context 里」。

实现：和最近 N 条合并到同一个查询，按 id 去重，按 `created_at` 升序排序。**不**做特殊位置注入（不放头部、不加 `[Pinned]` 标记）——保持时间序列连贯性。

如果用户 pin 了一条很老的消息，它会出现在 history 数组的早期位置（按时间）。LLM 看到的就是「这条老消息 + 之后的最近 N 条」的混合时间线。

---

## 序列化纯函数边界

`buildHistoryFor` 应**只做 DB 读 + 纯转换**，不发起 LLM 调用、不查 artifact 全文（只查 title）、不访问 workspace。这样：
- 单测好写
- 缓存友好（DB 读结果可以 memo per conversation/turn）
- 失败不影响主流程（捕获异常返回空数组，agent 退化到「无历史」模式）

---

## AgentRunner 集成

`agent-runner.ts:buildAdapterInput` 调用 `buildHistoryFor`，把结果塞进 `AdapterInput.history`（新字段）：

```typescript
const history = await buildHistoryFor(agent.id, args.conversationId, {
  maxTurns: 20,
  includePinned: true,
}).catch((err) => {
  console.warn('[agent-runner] buildHistoryFor failed, falling back to no history', err)
  return []
})
```

并把 `excludeMessageId` 设为当前触发的 user message id，避免触发消息被同时计入历史。

---

## Adapter 消费

### CustomAgentAdapter

`messages` 数组组装从：
```typescript
[
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userContent },
]
```
改为：
```typescript
[
  { role: 'system', content: systemPrompt },
  ...input.history,             // ← spec 13 注入点
  { role: 'user', content: userContent },
]
```

`input.history` 为空数组时行为与现状一致（向后兼容）。

### ClaudeCodeAdapter

**忽略** `input.history`，因为它已经通过 `previousSessionId` resume 走 SDK 内部 session 续接（见 `claude-code-adapter.ts:50` 的 `claudeSessions` map）。spec 13 不重复实现这条路径。

未来 Phase E 会把 sessionId 从内存 map 挪到 DB 持久化，但仍走 SDK 续接、不走 `input.history`。

### MockAdapter

忽略，无影响。

---

## 群聊 / Orchestrator（Phase C，本 spec 现在不实现，但提前定好契约）

`buildHistoryFor` 在群聊场景下要根据 agent 角色返回不同视图：

- **isOrchestrator agent**：看见所有 worker 的**文本输出**（折叠 thinking/tool_use/tool_result）+ user 消息。自己的 plan_tasks 调用还原 tool_calls。
- **普通 worker agent**：看自己的完整 history + user 消息 + **其他 agent 的文本摘要**，其他 agent 文本作为 `user` role 注入，前缀 `[<Agent名>]:`。worker 的 system prompt 自动追加一段说明这套前缀语义。

`BuildHistoryOptions` 在 Phase C 会扩展 `policy: 'self-only' | 'shared-text'`，默认 `shared-text`。

---

## Token 预算

`buildHistoryFor` 的 `tokenBudget` 选项（单位：tokens）控制 history 的总 token 上限，**不含** system prompt / current user / output reserve。AgentRunner 算预算：

```typescript
const limits = getModelLimits(agent.modelProvider, agent.modelId)  // src/shared/model-registry.ts
const promptEstimate = estimateTokens(systemPrompt) + estimateTokens(currentUser) + 512  // safety margin
const historyBudget = Math.max(0, limits.contextWindow - limits.outputReserve - promptEstimate)
```

### 截断算法

序列化全部 N 条候选消息（每条 → 1 个 user message OR 1 个 assistant + K 个 tool messages），按 chronological order 排好。每个序列化组算出 token 数（粗粒度：4 字符 ≈ 1 token，外加每条 message 4 token metadata margin）。

如果总 token 超 budget，**从老到新**遍历，跳过 pinned 项，丢非 pinned 项直到符合预算。pinned 永远保留（即便总数仍超 budget——用户的 pin 是显式契约）。

### 模型上下文窗口表

`src/shared/model-registry.ts:KNOWN_MODELS` 列出常见 modelId 的精确 contextWindow + outputReserve。不在表里的 modelId 走 provider fallback：

| Provider | Fallback contextWindow |
|---|---|
| anthropic | 200K |
| openai | 128K |
| deepseek | 64K |
| volcano-ark | 32K |

Provider 也未知（ClaudeCode adapter 没 modelProvider 字段）→ 兜底 200K。

reasoning 模型（DeepSeek R1 / OpenAI o1 等）`outputReserve` 加大到 16K-32K，因为 thinking 内容也吃输出 token。

### Token 估算

`estimateTokens(s) = ceil(s.length / 4)`。中英混合实测误差 10-20% 量级，对预算决策足够。Phase D 不引入 tiktoken / @anthropic/tokenizer 等真正 tokenizer 包（依赖大、性能开销大、对粗粒度截断收益小）。

---

## UI：用量在 UsageBadge popover 里展示

聊天 header 的 `UsageBadge`（`src/components/usage-badge.tsx`）原本就在显示「Σ N.Nk tok」累计；点开 popover 看 input/output/cache 拆分 + per-agent / per-model 拆分。Phase D 把「上下文容量」这件事并进同一个 popover：

- 「当前 ctx」行从单 token 数升级为「used / ceiling (pct%)」+ 进度条；颜色分档 <50% 灰 / 50-80% 黄 / >80% 红
- popover 底部那条「所有 token 都计费」提示后追加一句「Pin 消息可避免被预算自动截断」

**Why 不做底部独立指示器**：早期 Phase D 加过一个聊天底部的 `ContextUsageIndicator` 一行 UI，跟 UsageBadge 信息高度重叠 + 数据源不稳定（runsByConv 只在 streaming 时填，刷新后无数据时只能显占位），用户反馈视觉占位但没增量价值，已删。

数据来源：
- `lastInputTokens`：`useConversationUsageTotal` 给出的最近一次 streaming run 的 input token 数（只在当前 session streaming 过的 conversation 才有；旧会话刷新后为 0，此时 popover 隐藏整个 badge）
- `contextWindow`：会话内所有 agent 中 contextWindow 的最大值

**未显示场景**：`useConversationUsageTotal.runCount === 0` 时整个 badge 隐藏（沿用原行为）。

---

## 故意不做的事

| 项目 | 不做的理由 |
|---|---|
| **多模态 image 重传** | 老 user message 里的 image_attachment 现在只放占位文本，不重新读 base64。99% 场景用户已经在新 prompt 里复述过 |
| **thinking part 回传** | 一律丢。OpenAI 不支持回传 reasoning，DeepSeek 等模型回传也无意义 |
| **artifact 全文注入** | 永远只放 `[产物: title (id=art_xxx)]` 占位，agent 用 `read_artifact` 按需取 |
| **跨 conversation 记忆** | 不做。每个 conversation 是独立 sandbox |
| **精确 tokenizer**（tiktoken / @anthropic/tokenizer） | 粗粒度 4 字符≈1 token 估算误差 10-20%，对预算决策够用；引入真 tokenizer 增加 ~MB 级依赖 + 启动开销，性价比低 |
| **省流 / 全量 模式开关** | 让用户判断「该开省流还是全量」是错误的抽象——真实需求是「成本透明 + 自动稳定」。Phase D 的用量指示器 + 自动预算已经覆盖；用户主动管理走 pin / unpin 细粒度 |

---

## 验证清单（Phase A + B + D 合并前）

**Phase A + B**：
- [ ] 单聊：连续两轮对话，第二轮 agent 能正确引用第一轮的内容
- [ ] 单聊：agent 上一轮用过 bash 工具，下一轮 agent 看到自己的 tool_calls 历史，不会重复运行同样的命令
- [ ] 单聊：把消息 pin 之后，即使发了 25+ 条新消息，pinned 那条仍在 history 里
- [ ] 单聊：tool_use 与 tool_result 配对正确，OpenAI 没报「tool_call_id not found」之类错
- [ ] 单聊：artifact_ref 折叠为占位文本，agent 没把整个产物吐出来
- [ ] 群聊：不报错（即便 worker 现在没有跨 agent 视野，至少不能 crash）
- [ ] Claude Code agent：行为不变（不消费 history）

**Phase D**：
- [ ] 跑 20+ 轮对话后，最新对话不会因为超 contextWindow 报 LLM API 错
- [ ] 用量指示器显示「上下文 X / Y」与「上轮 Z」，数据非 0 时可见
- [ ] 用量超 50% 字体转黄，超 80% 转红
- [ ] 一个超长老消息被 pin 之后，即便和它在同一会话里跑了 5K-token 级别的新对话，它仍在 history 里（pin 不被 budget 截断）

---

## 与其他 spec 的关系

- Spec 03（MessagePart）：本 spec 是 MessagePart → OpenAI ChatMessage 的反向映射
- Spec 05（adapter interface）：`AdapterInput.history` 字段在 spec 05 描述
- Spec 06（orchestrator flow）：Phase C 时本 spec 与 spec 06 「子 Agent 看到的上下文」节合并去重
- Spec 09（frontend）：pinned 消息的 UI 操作不变，本 spec 仅消费其结果
