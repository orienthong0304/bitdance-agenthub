import { and, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { MessagePart, StreamEvent } from '@/shared/types'

import { agentRegistry } from './adapters/registry'
import { eventBus } from './event-bus'
import { newMessageId, newRunId } from './ids'

/**
 * AgentRunner — 执行一次 Agent 调用。
 *
 * 职责：
 *  1. 创建 AgentRun 记录
 *  2. 通过 AgentRegistry 取到 Adapter
 *  3. 构造 AdapterInput（含 prompt 拼接）
 *  4. 消费 Adapter 产生的 StreamEvent，做两件事：
 *      - 持久化到 DB（messages / agent_runs）
 *      - 发布到 EventBus 让 SSE 转发到前端
 *  5. 处理 abort 与错误
 *
 * 不职责（在后续 milestone 加）：
 *  - 工具执行（ToolExecutor）
 *  - Orchestrator 调度（plan_tasks 工具的特判 + dispatch.*）
 *  - 群聊上下文的 XML 包装
 */

interface RunArgs {
  agentId: string
  conversationId: string
  triggerMessageId: string
  parentRunId?: string
}

interface ActiveRun {
  controller: AbortController
  promise: Promise<void>
}

const activeRuns = new Map<string, ActiveRun>()

export const AgentRunner = {
  run(args: RunArgs): { runId: string } {
    const runId = newRunId()
    const controller = new AbortController()

    const promise = execute(runId, controller.signal, args).catch((err) => {
      // 兜底：execute 内已处理大部分异常，这里只防漏
      console.error('[AgentRunner] uncaught error', err)
    })

    activeRuns.set(runId, { controller, promise })
    promise.finally(() => activeRuns.delete(runId))

    return { runId }
  },

  abort(runId: string): boolean {
    const active = activeRuns.get(runId)
    if (!active) return false
    active.controller.abort()
    return true
  },
}

async function execute(runId: string, signal: AbortSignal, args: RunArgs): Promise<void> {
  const startedAt = Date.now()

  // 1. 查 agent
  const agent = await db.query.agents.findFirst({
    where: eq(schema.agents.id, args.agentId),
  })
  if (!agent) {
    throw new Error(`Agent not found: ${args.agentId}`)
  }

  // 2. 查 workspace
  const workspace = await db.query.workspaces.findFirst({
    where: eq(schema.workspaces.conversationId, args.conversationId),
  })
  if (!workspace) {
    throw new Error(`Workspace not found for conversation: ${args.conversationId}`)
  }

  // 3. 取触发消息作为 prompt（MVP 单聊版，群聊后续扩展）
  const triggerMessage = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.id, args.triggerMessageId),
      eq(schema.messages.conversationId, args.conversationId),
    ),
  })
  if (!triggerMessage) {
    throw new Error(`Trigger message not found: ${args.triggerMessageId}`)
  }
  const prompt = extractTextFromParts(triggerMessage.parts)

  // 4. 写 AgentRun 记录
  await db.insert(schema.agentRuns).values({
    id: runId,
    conversationId: args.conversationId,
    agentId: args.agentId,
    triggerMessageId: args.triggerMessageId,
    status: 'running',
    parentRunId: args.parentRunId,
    startedAt,
  })

  publish({
    type: 'run.start',
    conversationId: args.conversationId,
    timestamp: startedAt,
    runId,
    agentId: args.agentId,
    triggerMessageId: args.triggerMessageId,
    parentRunId: args.parentRunId,
  })

  // 5. 跑 Adapter
  let endStatus: 'complete' | 'failed' | 'aborted' = 'complete'
  let endError: string | undefined

  try {
    const adapter = agentRegistry.getAdapter(agent)
    const stream = adapter.stream(
      {
        agentId: args.agentId,
        conversationId: args.conversationId,
        runId,
        prompt,
        workspacePath: workspace.rootPath,
        customConfig:
          agent.adapterName === 'custom' && agent.modelProvider && agent.modelId
            ? {
                systemPrompt: agent.systemPrompt,
                modelProvider: agent.modelProvider,
                modelId: agent.modelId,
              }
            : undefined,
      },
      signal,
    )

    // 在 message 维度缓存 parts，事件结束时整体写库。
    // 缓存 key 是 messageId，因为一次 run 可能出多条 message（tool loop 等）。
    const messagePartsBuffer = new Map<string, MessagePart[]>()

    for await (const event of stream) {
      // 5a. 持久化
      await persistEvent(event, messagePartsBuffer, runId, args.agentId)

      // 5b. 转发
      publish(event)
    }
  } catch (err) {
    if (signal.aborted) {
      endStatus = 'aborted'
    } else {
      endStatus = 'failed'
      endError = err instanceof Error ? err.message : String(err)
    }
  }

  // 6. 收尾
  const finishedAt = Date.now()
  await db
    .update(schema.agentRuns)
    .set({ status: endStatus, finishedAt, error: endError })
    .where(eq(schema.agentRuns.id, runId))

  // 把还在 streaming 状态的 message 收尾
  await db
    .update(schema.messages)
    .set({ status: endStatus === 'complete' ? 'complete' : endStatus === 'aborted' ? 'aborted' : 'error' })
    .where(and(eq(schema.messages.runId, runId), eq(schema.messages.status, 'streaming')))

  publish({
    type: 'run.end',
    conversationId: args.conversationId,
    timestamp: finishedAt,
    runId,
    status: endStatus,
    error: endError,
  })

  // 触摸会话 updatedAt 让列表排序更新
  await db
    .update(schema.conversations)
    .set({ updatedAt: finishedAt })
    .where(eq(schema.conversations.id, args.conversationId))
}

// ─── 持久化逻辑 ────────────────────────────────────────────
async function persistEvent(
  event: StreamEvent,
  messagePartsBuffer: Map<string, MessagePart[]>,
  runId: string,
  agentId: string,
): Promise<void> {
  switch (event.type) {
    case 'message.start': {
      messagePartsBuffer.set(event.messageId, [])
      await db.insert(schema.messages).values({
        id: event.messageId,
        conversationId: event.conversationId,
        role: 'agent',
        agentId,
        parts: [],
        status: 'streaming',
        mentionedAgentIds: [],
        runId,
        createdAt: event.timestamp,
      })
      break
    }

    case 'part.start': {
      const parts = messagePartsBuffer.get(event.messageId) ?? []
      parts[event.partIndex] = event.part
      messagePartsBuffer.set(event.messageId, parts)
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, event.messageId))
      break
    }

    case 'part.delta': {
      const parts = messagePartsBuffer.get(event.messageId)
      if (!parts) return
      const part = parts[event.partIndex]
      if (!part) return

      if (event.delta.type === 'text.append' && part.type === 'text') {
        part.content += event.delta.text
      } else if (event.delta.type === 'thinking.append' && part.type === 'thinking') {
        part.content += event.delta.text
      } else if (event.delta.type === 'code.append' && part.type === 'code') {
        part.content += event.delta.text
      }
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, event.messageId))
      break
    }

    case 'tool.call': {
      const parts = messagePartsBuffer.get(event.messageId) ?? []
      parts.push({
        type: 'tool_use',
        callId: event.callId,
        toolName: event.toolName,
        args: event.args,
      })
      messagePartsBuffer.set(event.messageId, parts)
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, event.messageId))
      break
    }

    case 'tool.result': {
      const parts = messagePartsBuffer.get(event.messageId) ?? []
      parts.push({
        type: 'tool_result',
        callId: event.callId,
        result: event.result,
        isError: event.isError,
      })
      messagePartsBuffer.set(event.messageId, parts)
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, event.messageId))
      break
    }

    case 'message.end': {
      await db
        .update(schema.messages)
        .set({ status: 'complete' })
        .where(eq(schema.messages.id, event.messageId))
      messagePartsBuffer.delete(event.messageId)
      break
    }

    // run.start / run.end / part.end / dispatch.* / artifact.* / heartbeat
    // 要么在外层已经写库，要么是 P1+ 才接，这里 skip
    default:
      break
  }
}

function publish(event: StreamEvent): void {
  eventBus.publish(event)
}

function extractTextFromParts(parts: MessagePart[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text' || p.type === 'thinking') return p.content
      if (p.type === 'code') return '```' + p.language + '\n' + p.content + '\n```'
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}
