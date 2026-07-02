import type { StreamEvent } from '@/shared/types'
import { newMessageId, newToolCallId } from '@/server/ids'
import { toolRegistry } from '@/server/tools/registry'
import type { ToolContext } from '@/server/tools/types'

import type { AdapterInput, AgentPlatformAdapter } from './types'

/**
 * MockAdapter — 不调用任何真实 LLM，按预设脚本吐流式事件。
 *
 * 用途：
 *   1. 开发期不烧 token
 *   2. 端到端骨架验证（SSE / store / UI 渲染）
 *   3. 演示环境备份
 *
 * 行为：
 *   - 根据 prompt 关键词选择不同响应脚本（让 demo 看起来"智能"）
 *   - 字符级流式（每 ~15ms 一个 chunk），还原真实体感
 *   - 支持 AbortSignal
 */
export class MockAdapter implements AgentPlatformAdapter {
  readonly name = 'mock' as const

  async *stream(input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const script = pickScript(input.prompt)

    const messageId = newMessageId()
    yield {
      type: 'message.start',
      conversationId: input.conversationId,
      timestamp: Date.now(),
      messageId,
      agentId: input.agentId,
      runId: input.runId,
    }

    let partIndex = -1

    for (const step of script) {
      if (signal.aborted) break

      partIndex++

      if (step.kind === 'text') {
        yield {
          type: 'part.start',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          partIndex,
          part: { type: 'text', content: '' },
        }

        for (const chunk of chunkText(step.content, 4)) {
          if (signal.aborted) break
          await sleep(20)
          yield {
            type: 'part.delta',
            conversationId: input.conversationId,
            timestamp: Date.now(),
            messageId,
            partIndex,
            delta: { type: 'text.append', text: chunk },
          }
        }

        yield {
          type: 'part.end',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          partIndex,
        }
      } else if (step.kind === 'thinking') {
        yield {
          type: 'part.start',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          partIndex,
          part: { type: 'thinking', content: '' },
        }
        for (const chunk of chunkText(step.content, 8)) {
          if (signal.aborted) break
          await sleep(15)
          yield {
            type: 'part.delta',
            conversationId: input.conversationId,
            timestamp: Date.now(),
            messageId,
            partIndex,
            delta: { type: 'thinking.append', text: chunk },
          }
        }
        yield {
          type: 'part.end',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          partIndex,
        }
      } else if (step.kind === 'code') {
        yield {
          type: 'part.start',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          partIndex,
          part: { type: 'code', language: step.language, content: '' },
        }
        for (const chunk of chunkText(step.content, 8)) {
          if (signal.aborted) break
          await sleep(15)
          yield {
            type: 'part.delta',
            conversationId: input.conversationId,
            timestamp: Date.now(),
            messageId,
            partIndex,
            delta: { type: 'code.append', text: chunk },
          }
        }
        yield {
          type: 'part.end',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          partIndex,
        }
      } else if (step.kind === 'tool') {
        const callId = newToolCallId()
        yield {
          type: 'tool.call',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          callId,
          toolName: step.toolName,
          args: step.args,
        }
        await sleep(300)
        yield {
          type: 'tool.result',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          callId,
          result: step.result ?? { ok: true },
          isError: false,
        }
      } else if (step.kind === 'write_artifact') {
        // 真实执行 L3 write_artifact（与 CustomAgentAdapter 同一约定），
        // 让 E2E 能覆盖「产物落库 → artifact_ref → 预览面板」全链路。
        const callId = newToolCallId()
        yield {
          type: 'tool.call',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          callId,
          toolName: 'write_artifact',
          args: step.args,
        }
        const ctx: ToolContext = {
          conversationId: input.conversationId,
          workspacePath: input.workspacePath,
          agentId: input.agentId,
          runId: input.runId,
          abortSignal: signal,
        }
        const result = await toolRegistry.execute('write_artifact', step.args, ctx)
        const value = result.ok ? result.value : { error: result.error }
        yield {
          type: 'tool.result',
          conversationId: input.conversationId,
          timestamp: Date.now(),
          messageId,
          callId,
          result: value,
          isError: !result.ok,
        }
        const artifactId =
          result.ok && typeof value === 'object' && value !== null && 'artifactId' in value
            ? String((value as { artifactId: unknown }).artifactId)
            : null
        if (artifactId) {
          const { db, schema } = await import('@/db/client')
          const { eq } = await import('drizzle-orm')
          const artifact = await db.query.artifacts.findFirst({
            where: eq(schema.artifacts.id, artifactId),
          })
          if (artifact) {
            yield {
              type: 'artifact.create',
              conversationId: input.conversationId,
              timestamp: Date.now(),
              artifact: {
                id: artifact.id,
                conversationId: artifact.conversationId,
                type: artifact.type,
                title: artifact.title,
                content: artifact.content,
                version: artifact.version,
                parentArtifactId: artifact.parentArtifactId ?? undefined,
                createdByAgentId: artifact.createdByAgentId,
                createdAt: artifact.createdAt,
              },
            }
          }
        }
      }
    }

    yield {
      type: 'message.end',
      conversationId: input.conversationId,
      timestamp: Date.now(),
      messageId,
    }
  }
}

// ─── 脚本类型 ─────────────────────────────────────────────
type ScriptStep =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'code'; language: string; content: string }
  | { kind: 'tool'; toolName: string; args: unknown; result?: unknown }
  | { kind: 'write_artifact'; args: unknown }

// ─── 内置脚本 ─────────────────────────────────────────────
const GREETING_SCRIPT: ScriptStep[] = [
  { kind: 'thinking', content: '用户在问候，我应该礼貌回应并介绍自己。' },
  {
    kind: 'text',
    content:
      '你好！我是 Mock Agent，目前用于验证 AgentHub 的端到端骨架。我会按预设脚本流式回复，不消耗任何 LLM token。\n\n你可以试试输入「写代码」或「执行任务」看其他场景。',
  },
]

const CODE_SCRIPT: ScriptStep[] = [
  { kind: 'thinking', content: '用户希望看到代码示例，我演示一段 React 组件代码。' },
  { kind: 'text', content: '好的，这是一个简单的 React 计数器组件：' },
  {
    kind: 'code',
    language: 'tsx',
    content: `import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => setCount(c => c - 1)}>-</button>
      <span>{count}</span>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  )
}`,
  },
  { kind: 'text', content: '这是最朴素的实现。需要扩展可以告诉我（持久化、键盘快捷键等）。' },
]

const TOOL_SCRIPT: ScriptStep[] = [
  { kind: 'thinking', content: '我需要演示工具调用流程。' },
  { kind: 'text', content: '我先调用工具收集信息：' },
  {
    kind: 'tool',
    toolName: 'read_artifact',
    args: { artifactId: 'art_demo' },
    result: { title: '示例产物', size: 1024 },
  },
  { kind: 'text', content: '已读取产物信息。这只是脚本演示，真实工具会在后续 milestone 接入。' },
]

const WEB_ARTIFACT_SCRIPT: ScriptStep[] = [
  { kind: 'thinking', content: '用户要一个网页，我用 write_artifact 创建 web_app 产物。' },
  { kind: 'text', content: '好的，我来创建一个简单的网页产物：' },
  {
    kind: 'write_artifact',
    args: {
      type: 'web_app',
      title: 'Mock 计数器页面',
      content: {
        files: {
          'index.html':
            '<!DOCTYPE html>\n<html lang="zh">\n<head><meta charset="utf-8"><title>Mock Counter</title></head>\n<body>\n<h1 id="count">0</h1>\n<button onclick="document.getElementById(\'count\').textContent = Number(document.getElementById(\'count\').textContent) + 1">+1</button>\n</body>\n</html>\n',
        },
        entry: 'index.html',
      },
    },
  },
  { kind: 'text', content: '网页产物已创建，点击上方卡片可以在预览面板查看。' },
]

const DOC_ARTIFACT_SCRIPT: ScriptStep[] = [
  { kind: 'thinking', content: '用户要一份文档，我用 write_artifact 创建 document 产物。' },
  { kind: 'text', content: '好的，这就写一份 Markdown 文档：' },
  {
    kind: 'write_artifact',
    args: {
      type: 'document',
      title: 'Mock 说明文档',
      content: {
        format: 'markdown',
        content:
          '# Mock 说明文档\n\n这是 MockAdapter 创建的测试文档。\n\n## 要点\n\n- 走真实 write_artifact 工具落库\n- 消息里出现 artifact_ref 卡片\n- 预览面板可渲染 markdown\n',
      },
    },
  },
  { kind: 'text', content: '文档产物已创建完成。' },
]

const DEFAULT_SCRIPT: ScriptStep[] = [
  { kind: 'thinking', content: '收到了用户消息，按通用模板回应。' },
  {
    kind: 'text',
    content:
      '我收到了你的消息。这是 MockAdapter 的默认响应，用于验证消息流式渲染、part 切换、tool 调用等链路。\n\n试试输入 "你好"、"写代码"、"执行任务" 触发不同脚本。',
  },
]

function pickScript(prompt: string): ScriptStep[] {
  const p = prompt.toLowerCase()
  if (/(你好|hello|hi|您好)/.test(p)) return GREETING_SCRIPT
  if (/(网页|web|html|页面)/.test(p)) return WEB_ARTIFACT_SCRIPT
  if (/(文档|document|说明书)/.test(p)) return DOC_ARTIFACT_SCRIPT
  if (/(写代码|代码|code|component|组件)/.test(p)) return CODE_SCRIPT
  if (/(执行|工具|tool|run|跑)/.test(p)) return TOOL_SCRIPT
  return DEFAULT_SCRIPT
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
