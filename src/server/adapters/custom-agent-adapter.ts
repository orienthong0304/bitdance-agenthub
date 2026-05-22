import OpenAI from 'openai'

import { newMessageId } from '@/server/ids'
import { toolRegistry } from '@/server/tools/registry'
import type { ToolContext } from '@/server/tools/types'
import type { StreamEvent } from '@/shared/types'

import type { AdapterInput, AgentPlatformAdapter } from './types'

/**
 * CustomAgentAdapter —— 自配置 Agent 的适配器。
 *
 * 通过 openai SDK 调用底层模型（当前仅接 DeepSeek，未来扩展 Anthropic/OpenAI），
 * 自己实现 tool loop：流式拉模型输出 → 解析 tool_calls → 调用 ToolExecutor →
 * 把结果回灌到 messages → 续写下一轮，直到模型不再调工具。
 *
 * 详细规格见 specs/05-adapter-interface.md。
 */

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

interface AccumulatingToolCall {
  id: string
  name: string
  argsBuffer: string
}

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'

export class CustomAgentAdapter implements AgentPlatformAdapter {
  readonly name = 'custom' as const

  async *stream(input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent> {
    if (!input.customConfig) {
      throw new Error('CustomAgentAdapter requires customConfig')
    }
    const { systemPrompt, modelProvider, modelId } = input.customConfig

    const client = buildClient(modelProvider)

    const toolDefs = toolRegistry.resolve(input.toolNames)
    const apiTools = toolDefs.map(toApiTool)

    const ctx: ToolContext = {
      conversationId: input.conversationId,
      workspacePath: input.workspacePath,
      agentId: input.agentId,
      runId: input.runId,
      abortSignal: signal,
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input.prompt },
    ]

    const MAX_TURNS = 8
    let turn = 0

    while (turn < MAX_TURNS) {
      if (signal.aborted) return
      turn++

      const messageId = newMessageId()
      yield baseEvent(input, {
        type: 'message.start',
        messageId,
        agentId: input.agentId,
        runId: input.runId,
      })

      let textPartIndex = -1
      let textBuffer = ''
      const toolCallBuffer = new Map<number, AccumulatingToolCall>()

      let stream: Awaited<ReturnType<typeof client.chat.completions.create>>
      try {
        stream = await client.chat.completions.create(
          {
            model: modelId,
            messages,
            tools: apiTools.length > 0 ? apiTools : undefined,
            stream: true,
          },
          { signal },
        )
      } catch (err) {
        yield baseEvent(input, { type: 'message.end', messageId })
        throw err
      }

      let finishReason: string | null = null

      for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        if (signal.aborted) return
        const choice = chunk.choices[0]
        if (!choice) continue
        const delta = choice.delta

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          if (textPartIndex < 0) {
            textPartIndex = 0
            yield baseEvent(input, {
              type: 'part.start',
              messageId,
              partIndex: textPartIndex,
              part: { type: 'text', content: '' },
            })
          }
          textBuffer += delta.content
          yield baseEvent(input, {
            type: 'part.delta',
            messageId,
            partIndex: textPartIndex,
            delta: { type: 'text.append', text: delta.content },
          })
        }

        if (delta.tool_calls) {
          for (const tcd of delta.tool_calls) {
            const idx = tcd.index
            let entry = toolCallBuffer.get(idx)
            if (!entry) {
              entry = { id: '', name: '', argsBuffer: '' }
              toolCallBuffer.set(idx, entry)
            }
            if (tcd.id) entry.id = tcd.id
            if (tcd.function?.name) entry.name = tcd.function.name
            if (tcd.function?.arguments) entry.argsBuffer += tcd.function.arguments
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason
      }

      if (textPartIndex >= 0) {
        yield baseEvent(input, { type: 'part.end', messageId, partIndex: textPartIndex })
      }

      const toolCalls = Array.from(toolCallBuffer.values()).filter((tc) => tc.id && tc.name)

      // 写回 assistant message
      messages.push({
        role: 'assistant',
        content: textBuffer || null,
        tool_calls:
          toolCalls.length > 0
            ? toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.argsBuffer || '{}' },
              }))
            : undefined,
      })

      if (toolCalls.length === 0 || finishReason === 'stop') {
        yield baseEvent(input, { type: 'message.end', messageId })
        return
      }

      // 执行工具
      for (const tc of toolCalls) {
        let args: unknown
        try {
          args = tc.argsBuffer ? JSON.parse(tc.argsBuffer) : {}
        } catch {
          args = {}
        }

        yield baseEvent(input, {
          type: 'tool.call',
          messageId,
          callId: tc.id,
          toolName: tc.name,
          args,
        })

        const result = await toolRegistry.execute(tc.name, args, ctx)
        const value = result.ok ? result.value : { error: result.error }

        yield baseEvent(input, {
          type: 'tool.result',
          messageId,
          callId: tc.id,
          result: value,
          isError: !result.ok,
        })

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(value),
        })
      }

      yield baseEvent(input, { type: 'message.end', messageId })
      // 继续下一轮
    }
  }
}

// ─── 辅助 ────────────────────────────────────────────────
function buildClient(
  provider: 'anthropic' | 'openai' | 'deepseek',
): OpenAI {
  if (provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set')
    return new OpenAI({
      apiKey,
      baseURL: DEFAULT_DEEPSEEK_BASE_URL,
    })
  }
  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY not set')
    return new OpenAI({ apiKey })
  }
  throw new Error(`CustomAgentAdapter does not support provider "${provider}" yet`)
}

function toApiTool(t: {
  name: string
  description: string
  parameters: Record<string, unknown>
}): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }
}

function baseEvent<T extends Omit<StreamEvent, 'conversationId' | 'timestamp'>>(
  input: AdapterInput,
  body: T,
): StreamEvent {
  return {
    ...body,
    conversationId: input.conversationId,
    timestamp: Date.now(),
  } as StreamEvent
}
