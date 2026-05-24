# Spec 05 — AgentPlatformAdapter 接口

> 适配器层屏蔽不同 Agent 平台（Claude Code、Codex、自配置 Agent）的 API 差异，对上层提供统一的事件流。**修改接口需先讨论。**

源文件：`src/server/adapters/`

---

## 现状说明（先读这段）

| Adapter | 状态 |
|---|---|
| `MockAdapter` | ✅ 已实现，用于开发期不烧 token |
| `CustomAgentAdapter` | ✅ 已实现，覆盖 DeepSeek / OpenAI / 火山方舟（OpenAI 兼容协议）；**Anthropic 路径在 buildClient 里直接 throw，待实装** |
| `ClaudeCodeAdapter` | ❌ **未实现**（registry 注释里标 TODO）。CLAUDE.md §2 的 `@anthropic-ai/claude-agent-sdk` 依赖目前未被任何 adapter 使用 |
| `CodexAdapter` | ❌ **未实现**（同上） |

如果新人按本 spec「ClaudeCodeAdapter」一节去找代码，会找不到 —— 那是设计预案。当前所有 LLM 接入走 `CustomAgentAdapter`。

---

## 定位

```
应用层 (AgentRunner)
       │
       │ stream(input, signal) → AsyncIterable<StreamEvent>
       ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│ ClaudeCode   │  │ Codex        │  │ CustomAgent      │  │ Mock         │
│ Adapter      │  │ Adapter      │  │ Adapter          │  │ Adapter      │
│ (TODO)       │  │ (TODO)       │  │ ✅ 已实现         │  │ ✅ 已实现     │
└──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  └──────┬───────┘
       │                 │                   │                    │
   @anthropic-ai/    codex SDK / CLI    OpenAI SDK            预设脚本
   claude-agent-sdk                     (DeepSeek / 火山方舟 / OpenAI
                                         均走 OpenAI-compat 协议)
                                        + 自写 tool loop
```

**Adapter 的唯一职责**：把厂商 SDK 的输出翻译成 Spec 02 定义的 `StreamEvent`。

**Adapter 不做的事**：
- 不写数据库
- 不发 SSE
- 不持有跨调用的状态（除厂商 SDK 的 client 实例）

**Adapter 现状放宽的事**（与 CLAUDE.md §3.1 铁律有张力）：
- **直接 import `toolRegistry` 自跑 tool loop** —— CustomAgentAdapter 模块顶部 `import { toolRegistry } from '@/server/tools/registry'`，loop 内 `toolRegistry.execute(name, args, ctx)`。设计上工具执行属 L3，但代码现状是 Adapter 自调。本 spec 承认放宽，原因见下方「工具执行」一节

---

## 接口定义

```typescript
interface AgentPlatformAdapter {
  readonly name: AdapterName

  stream(
    input: AdapterInput,
    signal: AbortSignal,
  ): AsyncIterable<StreamEvent>
}

interface AdapterInput {
  agentId: string               // 用于事件 tag
  conversationId: string
  runId: string
  parentRunId?: string          // Orchestrator 派出的子 run

  prompt: string                // 已被外层拼好的完整 prompt（群聊场景含 XML 包装，详见 Spec 06）
  workspacePath: string         // 该会话的 workspace 绝对路径

  // 当前 agent 可用的工具名。Adapter 自行 toolRegistry.resolve(toolNames) 拿 ToolDef。
  // 这是与早期 spec 的偏离：曾经传整个 ToolDef[]，现在只传名字（避免在 input 里塞 handler 函数引用）
  toolNames: string[]

  // 附件（用户上传的文件/图片）— 用于 multimodal 投递
  attachments?: Array<{
    id: string                  // att_<nanoid>
    fileName: string
    mimeType: string
    kind: 'image' | 'file'
    absPath: string             // 服务端绝对路径，Adapter 自读
  }>

  // 仅 CustomAgentAdapter 使用
  customConfig?: {
    systemPrompt: string
    modelProvider: 'anthropic' | 'openai' | 'deepseek' | 'volcano-ark'
    modelId: string

    apiKey?: string             // 该 agent 单独的 key；缺省走 env var（按 provider 路由）
    supportsVision: boolean     // 决定是否把图片附件以 image_url block 投递给 LLM
  }

  // ID 生成器，确保整个系统 ID 一致
  generateMessageId: () => string
  generatePartId: () => string
}
```

**变更点（与早期 spec 差异）**：
- `tools: ToolDef[]` → `toolNames: string[]`：避免把 handler 函数引用塞进 input；Adapter 用 `toolRegistry.resolve` 自查
- 新增 `attachments`：multimodal 路径
- 新增 `customConfig.modelProvider: 'volcano-ark'`：OpenAI-compat 接入
- 新增 `customConfig.apiKey`：per-agent API key（优先级高于 env，见 Spec 08）
- 新增 `customConfig.supportsVision`：决定是否把图片以 multimodal 投递
- 新增 `parentRunId`：Orchestrator 子 run 的父引用

---

## CustomAgentAdapter

源文件：`src/server/adapters/custom-agent-adapter.ts`

最复杂的 adapter：自己实现 tool loop，覆盖 4 个 provider（其中 Anthropic 仍 TODO）。

### 高层流程

```
1. buildClient(provider, apiKey) → OpenAI 兼容 client
   provider → baseURL 映射：
     deepseek    → https://api.deepseek.com/v1
     volcano-ark → https://ark.cn-beijing.volces.com/api/v3
     openai      → https://api.openai.com/v1
     anthropic   → throw (TODO)
   
2. 初始化 messages:
   [
     { role: 'system', content: customConfig.systemPrompt },
     { role: 'user',   content: buildMultimodalUserContent(prompt, attachments) },
   ]
   
   buildMultimodalUserContent: 
     - supportsVision=true 且有图片附件：用 OpenAI content blocks 数组
       [{ type: 'text', text }, { type: 'image_url', image_url: { url: 'data:<mime>;base64,...' } }, ...]
     - 否则纯文本字符串
   
3. tool loop（最多 MAX_TURNS=8 轮）:
   每轮：
     yield message.start (新 partIndex 重置)
     client.chat.completions.create({ model, messages, tools, stream: true })
     for await chunk:
       - delta.content → text part
       - delta.reasoning_content → thinking part (DeepSeek 思维链)
       - delta.tool_calls → 累积 tool_calls
     yield message.end
     
     若无 tool_calls：跳出循环
     若有 tool_calls：
       并行 toolRegistry.execute(name, args, ctx)
       逐个 yield tool.result
       检测 result.value.artifactId 存在 → yield artifact.create (拉 DB 详情)
       把 assistant 消息（含 tool_calls + reasoning_content）和 tool result 推回 messages
       继续下一轮
```

### Reasoning 内容（DeepSeek thinking mode）

DeepSeek 等支持思考链的模型在 stream 中会单独输出 `delta.reasoning_content`。Adapter 处理：

1. 第一次见到 reasoning_content 时 emit `part.start` (type='thinking', content='')
2. 后续累积到 `reasoningBuffer`，emit `part.delta` (type='thinking.append')
3. **关键**：assistant 消息推回 messages 时必须带上 `reasoning_content` 字段，否则 DeepSeek 会报：

> `400 The reasoning_content in the thinking mode must be passed back to the API.`

这是 DeepSeek 特殊协议要求；其它 provider 忽略此字段。

### Multimodal

`buildMultimodalUserContent`（`custom-agent-adapter.ts:337-358`）：

- agent `supportsVision=true` 且 attachments 含 `kind='image'`：把 prompt 包成 OpenAI content blocks 数组，图片走 `image_url` block（base64 data URI），mimeType 来自 attachment row
- agent `supportsVision=false` 或无图片：纯文本字符串（沿用 OpenAI legacy 单字符串 content）

DeepSeek 的多模态模型（`deepseek-v4-flash`）走标准 OpenAI image_url 协议。

### Artifact 注入路径

不在 Adapter 自己发 `artifact_ref` part。流程：

1. Adapter 检测 `tool_result.value.artifactId` 非空 → `yield { type: 'artifact.create', artifact: <DB row> }`
2. AgentRunner 接到 `artifact.create` 事件 → 在当前 message 末尾插入 `artifact_ref` part 并补发 `part.start`
3. 这样 message.parts 里 tool_use → tool_result → artifact_ref 顺序排列，前端按 callId 合并工具卡片，artifact_ref 单独渲染为卡片

详见 Spec 02 的「artifact_ref 注入路径」一节。

---

## 工具执行：Adapter 与 Runner 的边界

源文件：`src/server/adapters/custom-agent-adapter.ts:47`

```typescript
import { toolRegistry } from '@/server/tools/registry'
// ...
const result = await toolRegistry.execute(name, args, ctx)
```

**为什么放宽 §3.1 铁律**：

| 方案 | 描述 | 取舍 |
|---|---|---|
| **A. Adapter 自调 toolRegistry**（现状） | 模块顶部 import，loop 中直接 execute | 代码简单；Adapter 多一个依赖 |
| **B. Adapter 只 yield 事件，Runner 执行后注入** | Adapter 必须支持「暂停-等待 result-继续」 | 干净；async iterator 双向通信复杂 |

方案 A 已落地。本 spec 承认放宽 —— Adapter **可以**调用 `toolRegistry`，但仍不**直接写 DB / 发 SSE**。Runner 仍是唯一的「event → 持久化 + 广播」入口。

如果未来要重新隔离（比如要给 Adapter 跑在 worker thread / 子进程），再切方案 B。

---

## MockAdapter

源文件：`src/server/adapters/mock-adapter.ts`

```typescript
class MockAdapter implements AgentPlatformAdapter {
  readonly name = 'mock' as const

  async *stream(input, signal) {
    const script = this.scripts.get(input.agentId) ?? DEFAULT_MOCK_SCRIPT
    for (const event of script) {
      if (signal.aborted) return
      await sleep(50)
      yield event
    }
  }
}
```

**用途**：开发期不烧 token、单元测试、演示环境备份。

---

## ClaudeCodeAdapter（TODO）

设计预案（不在当前代码中）。封装 `@anthropic-ai/claude-agent-sdk` 的 `query()` API。

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

class ClaudeCodeAdapter implements AgentPlatformAdapter {
  readonly name = 'claude-code' as const

  async *stream(input, signal) {
    // ... 见早期 spec 草稿
  }
}
```

**SDK 自带的能力**（不用我们写）：tool loop、文件读写工具、bash 工具、上下文压缩、错误重试。
**我们要做**：事件翻译 + ID 注入 + 增量工具的 callback 注册。

**实施前需要决定**：
- `AdapterInput.toolNames` 里的工具（write_artifact / read_artifact / read_attachment）如何透传给 Claude Agent SDK（自定义 MCP server 还是 callback）
- Claude Agent SDK 的 bash / fs 工具与 CLAUDE.md §5.2/§5.3 黑名单的接缝

---

## CodexAdapter（TODO）

设计预案。封装 OpenAI 的 codex（CLI spawn 或 SDK）。

```typescript
const proc = spawn('codex', ['--json', '--cwd', input.workspacePath], { signal })
proc.stdin.write(input.prompt)
// 读 stdout 行式 JSON → 翻译为 StreamEvent
```

**注意**：Codex 接入细节会随官方工具变化迭代。如果 codex CLI 接入复杂，可以先用 `CustomAgentAdapter` + OpenAI SDK 起 demo。

---

## AgentRegistry：根据 Agent 路由到 Adapter

源文件：`src/server/adapters/registry.ts`

```typescript
class AgentRegistry {
  private adapters: Map<AdapterName, AgentPlatformAdapter>

  getAdapter(agent: Agent): AgentPlatformAdapter {
    const adapter = this.adapters.get(agent.adapterName)
    if (!adapter) throw new Error(`Unknown adapter: ${agent.adapterName}`)
    return adapter
  }
}
```

当前注册的 adapter：`mock`、`custom`。`claude-code` / `codex` 在 `AdapterName` 联合类型里有，但 registry 里**没注册**，新建 agent 选这两个会报错。

---

## 错误处理

- Adapter 内部捕获厂商 SDK 异常 → throw 出 stream；AgentRunner 接住后写 `run.end({ status: 'failed', error })`，并通过 `emitErrorVisualisation` 注入一条 `msg_err_*` 错误消息让用户在对话里看到（见 Spec 09 / Spec 02）
- **网络/速率限制类错误的重试**：CustomAgentAdapter 通过 OpenAI SDK 的 `maxRetries=2`（在 `buildClient` 中显式声明，常量 `MAX_API_RETRIES`）自动重试，对 408 / 429 / >= 500 / `APIConnectionError` 走指数退避。注意：**重试只对初始连接生效**，stream 一旦开始 emit chunks 就不再重试。如果要按 provider 调整次数（比如火山方舟更宽松），改这个常量
- LLM 输出 JSON Schema 不符 / tool args 解析失败 → 由 `toolRegistry.execute` 内部 catch 成 `tool.result.isError=true`，**不**视作 Adapter 错误

---

## 新增 Adapter 的步骤

1. 在 `src/server/adapters/` 创建 `<name>-adapter.ts`
2. 实现 `AgentPlatformAdapter` 接口
3. 在 `src/shared/types.ts` 的 `AdapterName` 联合类型加新值
4. 在 `adapters/registry.ts` 注册
5. （UI 路径）在 `src/components/create-agent-dialog.tsx` 加新 provider 选项
6. （seed）若是内置 agent，在 `src/db/seed.ts` 加种子
7. 写至少 1 个单元测试覆盖事件翻译核心路径
8. 更新本 spec 的「现状说明」表格

---

## 与其它 spec 的关系

- Spec 01：Agent.adapterName 决定路由到哪个 Adapter
- Spec 02：StreamEvent 是 Adapter 的输出 schema
- Spec 06：Orchestrator 给子 agent 拼 prompt 时也走 CustomAgentAdapter（Orchestrator 本身也是一个 custom agent）
- Spec 07：toolNames 引用的工具定义
- Spec 08：customConfig.apiKey / supportsVision 的存储字段
