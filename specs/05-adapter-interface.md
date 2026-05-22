# Spec 05 — AgentPlatformAdapter 接口

> 适配器层屏蔽不同 Agent 平台（Claude Code、Codex、自配置 Agent）的 API 差异，对上层提供统一的事件流。

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
└──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  └──────┬───────┘
       │                 │                   │                    │
   @anthropic-ai/    codex SDK / CLI    Anthropic SDK         预设脚本
   claude-agent-sdk                     / OpenAI SDK
                                        + 自写 tool loop
```

**Adapter 的唯一职责**：把厂商 SDK 的输出翻译成 Spec 02 定义的 `StreamEvent`。

**Adapter 不做的事**：
- 不写数据库
- 不发 SSE
- 不执行工具（只翻译 `tool.call` 事件，工具实际由 L3 的 ToolExecutor 执行后通过 `tool.result` 反馈给 Adapter）
- 不持有跨调用的状态（除厂商 SDK 的 client 实例）

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
  conversationId: string        // 用于事件 tag
  runId: string                 // 用于事件 tag

  prompt: string                // 已被外层拼好的完整 prompt
                                // 群聊场景：上下文已用 XML 包装
                                // (详见 Spec 06)

  workspacePath: string         // 该会话的 workspace 绝对路径
                                // Claude Code/Codex SDK 直接当 cwd

  tools: ToolDef[]              // 当前 agent 可用的工具
                                // Claude Code/Codex 自带 fs/bash 工具，
                                // 这里只传增量工具（write_artifact 等）

  // 仅 CustomAgentAdapter 使用
  customConfig?: {
    systemPrompt: string
    modelProvider: 'anthropic' | 'openai' | 'deepseek'
    modelId: string
  }

  // ID 生成器，确保整个系统 ID 一致
  generateMessageId: () => string
  generatePartId: () => string
}
```

---

## ClaudeCodeAdapter

封装 `@anthropic-ai/claude-agent-sdk`。

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

class ClaudeCodeAdapter implements AgentPlatformAdapter {
  readonly name = 'claude-code' as const

  async *stream(input, signal) {
    const messageId = input.generateMessageId()
    yield { type: 'message.start', messageId, agentId: input.agentId,
            runId: input.runId, conversationId: input.conversationId,
            timestamp: Date.now() }

    const result = query({
      prompt: input.prompt,
      options: {
        cwd: input.workspacePath,
        permissionMode: 'bypassPermissions',
        // 额外工具通过 mcp 或自定义 callback 注入
      },
      abortSignal: signal,
    })

    let partIndex = -1
    for await (const message of result) {
      switch (message.type) {
        case 'assistant':
          // SDK 输出的 assistant message 含 content blocks
          for (const block of message.message.content) {
            partIndex++
            if (block.type === 'text') {
              yield { type: 'part.start', messageId, partIndex,
                      part: { type: 'text', content: block.text }, /* ... */ }
              yield { type: 'part.end', messageId, partIndex, /* ... */ }
            } else if (block.type === 'tool_use') {
              yield { type: 'tool.call', messageId, callId: block.id,
                      toolName: block.name, args: block.input, /* ... */ }
            }
          }
          break

        case 'tool_result':
          yield { type: 'tool.result', messageId, callId: message.tool_use_id,
                  result: message.content, isError: !!message.is_error, /* ... */ }
          break

        case 'result':
          yield { type: 'message.end', messageId, /* ... */ }
          break
      }
    }
  }
}
```

**SDK 帮我们做掉的事**：tool loop、文件读写工具、bash 工具、上下文压缩、错误重试。

**我们要做的事**：事件翻译 + ID 注入 + 增量工具的 callback 注册。

---

## CodexAdapter

封装 OpenAI 的 codex（命令行工具或 SDK，目前以 CLI spawn 为主）。

```typescript
import { spawn } from 'node:child_process'

class CodexAdapter implements AgentPlatformAdapter {
  readonly name = 'codex' as const

  async *stream(input, signal) {
    const messageId = input.generateMessageId()
    yield { type: 'message.start', ... }

    const proc = spawn('codex', ['--json', '--cwd', input.workspacePath], {
      signal,
    })
    proc.stdin.write(input.prompt)
    proc.stdin.end()

    let partIndex = -1
    for await (const line of readLines(proc.stdout)) {
      const evt = JSON.parse(line)
      // codex 输出格式参考 OpenAI 的 streaming chat completion
      // 这里翻译成我们的 StreamEvent
      switch (evt.type) {
        case 'text_delta':
          if (partIndex < 0) {
            partIndex = 0
            yield { type: 'part.start', messageId, partIndex,
                    part: { type: 'text', content: '' }, /* ... */ }
          }
          yield { type: 'part.delta', messageId, partIndex,
                  delta: { type: 'text.append', text: evt.text }, /* ... */ }
          break
        // ... 其他类型
      }
    }

    yield { type: 'message.end', messageId, /* ... */ }
  }
}
```

**注意**：Codex 的接入细节会随官方工具变化迭代。MVP 阶段如果 codex CLI 接入复杂，可以先用 `CustomAgentAdapter` + OpenAI SDK 起 demo，等架构稳定再切真 codex。

---

## CustomAgentAdapter

最复杂的一个：自己实现 tool loop。

```typescript
class CustomAgentAdapter implements AgentPlatformAdapter {
  readonly name = 'custom' as const

  async *stream(input, signal) {
    if (!input.customConfig) throw new Error('customConfig required')

    const client = getLLMClient(input.customConfig.modelProvider)
    const messages: LLMMessage[] = [
      { role: 'user', content: input.prompt }
    ]

    while (true) {  // tool loop
      const messageId = input.generateMessageId()
      yield { type: 'message.start', messageId, /* ... */ }

      const llmStream = client.stream({
        model: input.customConfig.modelId,
        system: input.customConfig.systemPrompt,
        messages,
        tools: input.tools.map(toLLMTool),
        signal,
      })

      const toolCalls: ToolCall[] = []
      let partIndex = -1
      let currentTextPart: { content: string } | null = null

      for await (const chunk of llmStream) {
        // 翻译厂商 chunk → 我们的事件
        if (chunk.type === 'text_delta') {
          if (!currentTextPart) {
            partIndex++
            currentTextPart = { content: '' }
            yield { type: 'part.start', messageId, partIndex,
                    part: { type: 'text', content: '' }, /* ... */ }
          }
          currentTextPart.content += chunk.text
          yield { type: 'part.delta', messageId, partIndex,
                  delta: { type: 'text.append', text: chunk.text }, /* ... */ }
        } else if (chunk.type === 'tool_use') {
          toolCalls.push(chunk)
          yield { type: 'tool.call', messageId, callId: chunk.id,
                  toolName: chunk.name, args: chunk.input, /* ... */ }
        }
      }

      yield { type: 'message.end', messageId, /* ... */ }

      if (toolCalls.length === 0) break  // 模型不再调工具，结束

      // 执行工具：由调用方（AgentRunner）通过外部回调执行
      // Adapter 通过 yield tool.call 让外层执行，外层把 result 通过另一个机制喂回
      // ⚠️ 这里需要 Runner 与 Adapter 协作，详见下方"工具执行流"

      // 简化实现：Adapter 直接接受一个 toolExecutor 回调
      const results = await Promise.all(toolCalls.map(tc =>
        executeTool(tc, { conversationId: input.conversationId, /* ... */ })
      ))
      for (let i = 0; i < toolCalls.length; i++) {
        yield { type: 'tool.result', messageId, callId: toolCalls[i].id,
                result: results[i].value, isError: !results[i].ok, /* ... */ }
        messages.push(/* 把 tool_use 和 tool_result 加到 messages */)
      }
    }
  }
}
```

### 工具执行：Adapter 与 Runner 的边界

Adapter 内部 tool loop 需要执行工具。两种设计：

| 方案 | 描述 | 取舍 |
|---|---|---|
| **A. Adapter 调 ToolExecutor** | Adapter 持有 ToolExecutor 引用，在 loop 中直接调用 | 简单，但 Adapter 多了一个依赖 |
| **B. Adapter 只 yield 事件，Runner 执行后注入** | Adapter 必须支持「暂停-等待 result-继续」 | 干净但复杂（async iterator 双向通信） |

**采用方案 A**：CustomAgentAdapter 的构造函数注入 ToolExecutor。CLAUDE.md §3.1 的「Adapter 不执行工具」规则在此放宽——具体执行还是走 ToolExecutor，Adapter 只是调用方。

---

## MockAdapter

```typescript
class MockAdapter implements AgentPlatformAdapter {
  readonly name = 'mock' as const

  constructor(private scripts: Map<string, StreamEvent[]>) {}

  async *stream(input, signal) {
    const script = this.scripts.get(input.agentId) ?? DEFAULT_MOCK_SCRIPT
    for (const event of script) {
      if (signal.aborted) return
      await sleep(50)  // 模拟流式延迟
      yield event
    }
  }
}
```

**用途**：
- 开发期不烧 token
- 单元测试可控可重复
- 演示环境备份

---

## AgentRegistry：根据 Agent 路由到 Adapter

```typescript
class AgentRegistry {
  private adapters: Map<AdapterName, AgentPlatformAdapter>

  constructor(adapters: AgentPlatformAdapter[]) {
    this.adapters = new Map(adapters.map(a => [a.name, a]))
  }

  getAdapter(agent: Agent): AgentPlatformAdapter {
    const adapter = this.adapters.get(agent.adapterName)
    if (!adapter) throw new Error(`Unknown adapter: ${agent.adapterName}`)
    return adapter
  }
}
```

`AgentRunner` 拿到 `Agent` 后通过 registry 路由到对应 Adapter，调用 `adapter.stream(input, signal)`。

---

## 错误处理

- Adapter 内部捕获厂商 SDK 异常，转化为最后一个事件 `run.end` 的 `error` 字段（不抛到 AsyncIterable 之外）
- 网络/速率限制类错误，Adapter 内部重试 1 次（指数退避 1s），仍失败则报错
- LLM 输出无法解析（格式错误）算作 Adapter 错误，不试图自恢复

---

## 新增 Adapter 的步骤

1. 在 `src/server/adapters/` 创建文件
2. 实现 `AgentPlatformAdapter` 接口
3. 在 `AdapterName` 联合类型中加新值
4. 在 `AgentRegistry` 启动注册
5. 在 `agents` 表插入用此 adapter 的 Agent 时设置 `adapter_name`
6. 写至少 1 个单元测试覆盖事件翻译核心路径
7. 更新本 spec 的"实现清单"小节
