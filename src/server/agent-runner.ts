import { and, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { AgentRow, ArtifactRow } from '@/db/schema'
import type { DispatchPlanItem, MessagePart, StreamEvent } from '@/shared/types'

import { agentRegistry } from './adapters/registry'
import type { AdapterAttachment, AdapterInput } from './adapters/types'
import { getAttachmentAbsolutePath } from './attachment-service'
import { eventBus } from './event-bus'
import { newRunId } from './ids'

/**
 * AgentRunner — 执行一次 Agent 调用。
 *
 * 两种分支：
 *  - executeSimpleRun       普通 Agent，消费 adapter 事件流即可
 *  - executeOrchestratorRun isOrchestrator 的 Agent，三阶段：PLAN → EXECUTE → AGGREGATE
 *
 * 详细规格见 specs/06-orchestrator-flow.md。
 */

export interface RunArgs {
  agentId: string
  conversationId: string
  triggerMessageId: string
  parentRunId?: string
  /** 子 agent 调度时覆盖 prompt（外部 prompt，由 Orchestrator 构造） */
  overridePrompt?: string
  /** 覆盖 system prompt（Orchestrator 不同 stage 用不同 prompt） */
  overrideSystemPrompt?: string
  /** 覆盖工具集（Orchestrator aggregate 阶段不带 plan_tasks） */
  overrideToolNames?: string[]
  /** 父 run 的 AbortSignal — 用于级联中止：parent abort → child abort */
  parentSignal?: AbortSignal
}

export interface RunResult {
  runId: string
  status: 'complete' | 'failed' | 'aborted'
  error?: string
  artifactIds: string[]
  outputMessageIds: string[]
}

const activeRuns = new Map<string, AbortController>()

export const AgentRunner = {
  run(args: RunArgs): { runId: string; promise: Promise<RunResult> } {
    const runId = newRunId()
    const controller = new AbortController()

    // 级联：父 run abort 时子 run 也 abort
    if (args.parentSignal) {
      if (args.parentSignal.aborted) {
        controller.abort()
      } else {
        args.parentSignal.addEventListener('abort', () => controller.abort(), { once: true })
      }
    }

    activeRuns.set(runId, controller)

    const promise = executeRun(runId, controller.signal, args).finally(() => {
      activeRuns.delete(runId)
    })

    promise.catch((err) => {
      console.error('[AgentRunner] uncaught error', err)
    })

    return { runId, promise }
  },

  abort(runId: string): boolean {
    const ac = activeRuns.get(runId)
    if (!ac) return false
    ac.abort()
    return true
  },
}

// ─── 主入口 ────────────────────────────────────────────────
async function executeRun(runId: string, signal: AbortSignal, args: RunArgs): Promise<RunResult> {
  const agent = await db.query.agents.findFirst({
    where: eq(schema.agents.id, args.agentId),
  })
  if (!agent) {
    return finalizeFailed(runId, args, `Agent not found: ${args.agentId}`)
  }

  const workspace = await db.query.workspaces.findFirst({
    where: eq(schema.workspaces.conversationId, args.conversationId),
  })
  if (!workspace) {
    return finalizeFailed(runId, args, `Workspace not found for conversation: ${args.conversationId}`)
  }

  const triggerMessage = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.id, args.triggerMessageId),
      eq(schema.messages.conversationId, args.conversationId),
    ),
  })
  if (!triggerMessage) {
    return finalizeFailed(runId, args, `Trigger message not found: ${args.triggerMessageId}`)
  }

  const prompt = args.overridePrompt ?? extractTextFromParts(triggerMessage.parts)

  // 解析 trigger message 里的附件（子 run / overridePrompt 场景不解析，避免子 agent 重复处理）
  const attachments: AdapterAttachment[] = []
  if (!args.overridePrompt) {
    for (const p of triggerMessage.parts) {
      if (p.type === 'image_attachment' || p.type === 'file_attachment') {
        const absPath = await getAttachmentAbsolutePath(p.attachmentId)
        if (absPath) {
          attachments.push({
            id: p.attachmentId,
            fileName: p.fileName,
            mimeType: p.mimeType,
            kind: p.type === 'image_attachment' ? 'image' : 'file',
            absPath,
          })
        }
      }
    }
  }

  // 写 run 记录 + 发 run.start
  await insertRun(runId, args, agent.id)
  publish({
    type: 'run.start',
    conversationId: args.conversationId,
    timestamp: Date.now(),
    runId,
    agentId: agent.id,
    triggerMessageId: args.triggerMessageId,
    parentRunId: args.parentRunId,
  })

  try {
    const result = agent.isOrchestrator
      ? await executeOrchestratorRun(runId, signal, args, agent, workspace.rootPath, prompt, attachments)
      : await executeSimpleRun(runId, signal, args, agent, workspace.rootPath, prompt, attachments)
    return await finalizeOk(runId, args, result)
  } catch (err) {
    if (signal.aborted) {
      return finalize(runId, args, 'aborted', { artifactIds: [], outputMessageIds: [] })
    }
    const msg = err instanceof Error ? err.message : String(err)
    return finalize(runId, args, 'failed', { artifactIds: [], outputMessageIds: [] }, msg)
  }
}

// ─── 普通 Agent ────────────────────────────────────────────
async function executeSimpleRun(
  runId: string,
  signal: AbortSignal,
  args: RunArgs,
  agent: AgentRow,
  workspacePath: string,
  prompt: string,
  attachments: AdapterAttachment[],
): Promise<{ artifactIds: string[]; outputMessageIds: string[] }> {
  const toolNames = args.overrideToolNames ?? agent.toolNames

  const adapter = agentRegistry.getAdapter(agent)
  const stream = adapter.stream(
    buildAdapterInput(
      args,
      agent,
      runId,
      prompt,
      workspacePath,
      toolNames,
      args.overrideSystemPrompt,
      attachments,
    ),
    signal,
  )

  return consumeStream(stream, args.agentId, runId)
}

// ─── Orchestrator ──────────────────────────────────────────
async function executeOrchestratorRun(
  runId: string,
  signal: AbortSignal,
  args: RunArgs,
  agent: AgentRow,
  workspacePath: string,
  userPrompt: string,
  attachments: AdapterAttachment[],
): Promise<{ artifactIds: string[]; outputMessageIds: string[] }> {
  const conv = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, args.conversationId),
  })
  if (!conv) throw new Error(`Conversation not found: ${args.conversationId}`)

  const otherAgentIds = conv.agentIds.filter((id) => id !== agent.id)
  const otherAgents =
    otherAgentIds.length > 0
      ? await db.query.agents.findMany({ where: inArray(schema.agents.id, otherAgentIds) })
      : []

  const allArtifactIds: string[] = []
  const allOutputMessageIds: string[] = []

  // ─── Stage 1: PLAN ─────────────────────────────────────
  const planSystemPrompt = buildOrchestratorPlanPrompt(agent.systemPrompt, otherAgents)
  const planToolNames = ensureIncludes(agent.toolNames, 'plan_tasks')

  const planRef: { value: DispatchPlanItem[] | null } = { value: null }

  const planStream = agentRegistry
    .getAdapter(agent)
    .stream(
      buildAdapterInput(args, agent, runId, userPrompt, workspacePath, planToolNames, planSystemPrompt, attachments),
      signal,
    )

  const planRun = await consumeStream(planStream, agent.id, runId, (event) => {
    if (event.type === 'tool.call' && event.toolName === 'plan_tasks') {
      const a = event.args as { reasoning?: string; tasks?: DispatchPlanItem[] }
      if (Array.isArray(a?.tasks)) planRef.value = a.tasks
    }
  })
  allArtifactIds.push(...planRun.artifactIds)
  allOutputMessageIds.push(...planRun.outputMessageIds)

  const plan = planRef.value
  if (!plan || plan.length === 0) {
    // 没拆出 plan：当作 Orchestrator 直接回答了用户，结束
    return { artifactIds: allArtifactIds, outputMessageIds: allOutputMessageIds }
  }

  publish({
    type: 'dispatch.plan',
    conversationId: args.conversationId,
    timestamp: Date.now(),
    runId,
    plan,
  })

  // ─── Stage 2: EXECUTE (DAG) ────────────────────────────
  const taskResults = await executeDag(plan, {
    parentRunId: runId,
    conversationId: args.conversationId,
    triggerMessageId: args.triggerMessageId,
    signal,
  })

  for (const r of taskResults.values()) {
    allArtifactIds.push(...r.artifactIds)
    allOutputMessageIds.push(...r.outputMessageIds)
  }

  // ─── Stage 3: AGGREGATE ────────────────────────────────
  const aggregateSystemPrompt = buildOrchestratorAggregatePrompt(agent.systemPrompt)
  const aggregateUserPrompt = await buildAggregatePrompt(
    userPrompt,
    plan,
    taskResults,
    args.conversationId,
  )
  // Aggregate 阶段不再带 plan_tasks 工具，避免重复拆解
  const aggregateToolNames = agent.toolNames.filter((n) => n !== 'plan_tasks')

  const aggStream = agentRegistry
    .getAdapter(agent)
    .stream(
      buildAdapterInput(
        args,
        agent,
        runId,
        aggregateUserPrompt,
        workspacePath,
        aggregateToolNames,
        aggregateSystemPrompt,
        // aggregate 阶段不再带原始图片附件（避免重复传图片浪费 token；plan 阶段已经看过）
        [],
      ),
      signal,
    )

  const aggRun = await consumeStream(aggStream, agent.id, runId)
  allArtifactIds.push(...aggRun.artifactIds)
  allOutputMessageIds.push(...aggRun.outputMessageIds)

  return { artifactIds: allArtifactIds, outputMessageIds: allOutputMessageIds }
}

// ─── DAG 调度 ──────────────────────────────────────────────
interface DagContext {
  parentRunId: string
  conversationId: string
  triggerMessageId: string
  signal: AbortSignal
}

async function executeDag(
  plan: DispatchPlanItem[],
  ctx: DagContext,
): Promise<Map<string, RunResult>> {
  const results = new Map<string, RunResult>()
  const remaining = new Set(plan.map((t) => t.id))

  while (remaining.size > 0) {
    if (ctx.signal.aborted) break

    const ready = plan.filter(
      (t) => remaining.has(t.id) && (t.dependsOn ?? []).every((d) => results.has(d)),
    )
    if (ready.length === 0) {
      throw new Error('Circular dependency or unresolved task in plan')
    }

    const wave = await Promise.all(ready.map((t) => runChildTask(t, results, ctx)))
    for (let i = 0; i < ready.length; i++) {
      results.set(ready[i].id, wave[i])
      remaining.delete(ready[i].id)
    }
  }

  return results
}

async function runChildTask(
  task: DispatchPlanItem,
  upstream: Map<string, RunResult>,
  ctx: DagContext,
): Promise<RunResult> {
  const subPrompt = await buildSubAgentPrompt(task, upstream, ctx.conversationId)

  const { runId: childRunId, promise } = AgentRunner.run({
    agentId: task.agentId,
    conversationId: ctx.conversationId,
    triggerMessageId: ctx.triggerMessageId,
    parentRunId: ctx.parentRunId,
    overridePrompt: subPrompt,
    parentSignal: ctx.signal,
  })

  publish({
    type: 'dispatch.start',
    conversationId: ctx.conversationId,
    timestamp: Date.now(),
    parentRunId: ctx.parentRunId,
    childRunId,
    taskId: task.id,
    agentId: task.agentId,
  })

  const result = await promise

  publish({
    type: 'dispatch.end',
    conversationId: ctx.conversationId,
    timestamp: Date.now(),
    childRunId,
    taskId: task.id,
    status: result.status === 'complete' ? 'complete' : 'failed',
  })

  return result
}

// ─── 流消费 + 持久化 ─────────────────────────────────────
type ToolCallEvent = Extract<StreamEvent, { type: 'tool.call' }>

async function consumeStream(
  stream: AsyncIterable<StreamEvent>,
  agentId: string,
  runId: string,
  onToolCall?: (event: ToolCallEvent) => void,
): Promise<{ artifactIds: string[]; outputMessageIds: string[] }> {
  const partsBuffer = new Map<string, MessagePart[]>()
  const artifactIds: string[] = []
  const outputMessageIds: string[] = []
  let currentMessageId: string | null = null

  for await (const event of stream) {
    if (event.type === 'message.start') currentMessageId = event.messageId

    await persistEvent(event, partsBuffer, runId, agentId, outputMessageIds, artifactIds)
    publish(event)

    // 工具产出的 artifact 自动作为 artifact_ref part 挂到当前 message 末尾，
    // 让用户在聊天流里看到产物卡片而不仅是 tool_result。
    if (event.type === 'artifact.create' && currentMessageId) {
      const parts = partsBuffer.get(currentMessageId) ?? []
      const partIndex = parts.length
      const refPart: MessagePart = { type: 'artifact_ref', artifactId: event.artifact.id }
      parts.push(refPart)
      partsBuffer.set(currentMessageId, parts)
      await db
        .update(schema.messages)
        .set({ parts })
        .where(eq(schema.messages.id, currentMessageId))

      publish({
        type: 'part.start',
        conversationId: event.conversationId,
        timestamp: Date.now(),
        messageId: currentMessageId,
        partIndex,
        part: refPart,
      })
    }

    if (event.type === 'message.end') currentMessageId = null
    if (event.type === 'tool.call') onToolCall?.(event)
  }

  return { artifactIds, outputMessageIds }
}

async function persistEvent(
  event: StreamEvent,
  partsBuffer: Map<string, MessagePart[]>,
  runId: string,
  agentId: string,
  outputMessageIds: string[],
  artifactIds: string[],
): Promise<void> {
  switch (event.type) {
    case 'message.start': {
      partsBuffer.set(event.messageId, [])
      outputMessageIds.push(event.messageId)
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
      return
    }
    case 'part.start': {
      const parts = partsBuffer.get(event.messageId) ?? []
      parts[event.partIndex] = event.part
      partsBuffer.set(event.messageId, parts)
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, event.messageId))
      return
    }
    case 'part.delta': {
      const parts = partsBuffer.get(event.messageId)
      if (!parts) return
      const part = parts[event.partIndex]
      if (!part) return
      if (event.delta.type === 'text.append' && part.type === 'text') part.content += event.delta.text
      else if (event.delta.type === 'thinking.append' && part.type === 'thinking')
        part.content += event.delta.text
      else if (event.delta.type === 'code.append' && part.type === 'code') part.content += event.delta.text
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, event.messageId))
      return
    }
    case 'tool.call': {
      const parts = partsBuffer.get(event.messageId) ?? []
      parts.push({
        type: 'tool_use',
        callId: event.callId,
        toolName: event.toolName,
        args: event.args,
      })
      partsBuffer.set(event.messageId, parts)
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, event.messageId))
      return
    }
    case 'tool.result': {
      const parts = partsBuffer.get(event.messageId) ?? []
      parts.push({
        type: 'tool_result',
        callId: event.callId,
        result: event.result,
        isError: event.isError,
      })
      partsBuffer.set(event.messageId, parts)
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, event.messageId))
      return
    }
    case 'message.end': {
      await db
        .update(schema.messages)
        .set({ status: 'complete' })
        .where(eq(schema.messages.id, event.messageId))
      partsBuffer.delete(event.messageId)
      return
    }
    case 'artifact.create': {
      artifactIds.push(event.artifact.id)
      return
    }
    default:
      return
  }
}

// ─── DB / 事件辅助 ─────────────────────────────────────────
async function insertRun(runId: string, args: RunArgs, agentId: string) {
  await db.insert(schema.agentRuns).values({
    id: runId,
    conversationId: args.conversationId,
    agentId,
    triggerMessageId: args.triggerMessageId,
    status: 'running',
    parentRunId: args.parentRunId,
    startedAt: Date.now(),
  })
}

async function finalize(
  runId: string,
  args: RunArgs,
  status: 'complete' | 'failed' | 'aborted',
  result: { artifactIds: string[]; outputMessageIds: string[] },
  error?: string,
): Promise<RunResult> {
  const finishedAt = Date.now()

  await db
    .update(schema.agentRuns)
    .set({ status, finishedAt, error: error ?? null })
    .where(eq(schema.agentRuns.id, runId))

  await db
    .update(schema.messages)
    .set({
      status: status === 'complete' ? 'complete' : status === 'aborted' ? 'aborted' : 'error',
    })
    .where(and(eq(schema.messages.runId, runId), eq(schema.messages.status, 'streaming')))

  // 失败 / 中止时把错误信息暴露给用户：如果该 run 已有 streaming message，把
  // 错误作为新 text part 追加；否则新建一条 system message 显示错误。
  if (status === 'failed' || status === 'aborted') {
    await emitErrorVisualisation(runId, args, status, error, result.outputMessageIds)
  }

  await db
    .update(schema.conversations)
    .set({ updatedAt: finishedAt })
    .where(eq(schema.conversations.id, args.conversationId))

  publish({
    type: 'run.end',
    conversationId: args.conversationId,
    timestamp: finishedAt,
    runId,
    status,
    error,
  })

  return {
    runId,
    status,
    error,
    artifactIds: result.artifactIds,
    outputMessageIds: result.outputMessageIds,
  }
}

async function emitErrorVisualisation(
  runId: string,
  args: RunArgs,
  status: 'failed' | 'aborted',
  error: string | undefined,
  outputMessageIds: string[],
): Promise<void> {
  const errorText = status === 'aborted' ? '[已中止]' : `[失败] ${error ?? '未知错误'}`
  const now = Date.now()

  // 优先：把错误追加到该 run 最近的 agent message（如果存在）
  const lastMessageId = outputMessageIds[outputMessageIds.length - 1]
  if (lastMessageId) {
    const msg = await db.query.messages.findFirst({
      where: eq(schema.messages.id, lastMessageId),
    })
    if (msg) {
      const parts: MessagePart[] = [...msg.parts, { type: 'text', content: errorText }]
      await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, lastMessageId))
      publish({
        type: 'part.start',
        conversationId: args.conversationId,
        timestamp: now,
        messageId: lastMessageId,
        partIndex: parts.length - 1,
        part: { type: 'text', content: errorText },
      })
      return
    }
  }

  // 否则：新建一条 error message
  const errorMessageId = `msg_err_${runId}`
  await db.insert(schema.messages).values({
    id: errorMessageId,
    conversationId: args.conversationId,
    role: 'agent',
    agentId: args.agentId,
    parts: [{ type: 'text', content: errorText }],
    status: 'error',
    mentionedAgentIds: [],
    runId,
    createdAt: now,
  })
  publish({
    type: 'message.start',
    conversationId: args.conversationId,
    timestamp: now,
    messageId: errorMessageId,
    agentId: args.agentId,
    runId,
  })
  publish({
    type: 'part.start',
    conversationId: args.conversationId,
    timestamp: now,
    messageId: errorMessageId,
    partIndex: 0,
    part: { type: 'text', content: errorText },
  })
  publish({
    type: 'message.end',
    conversationId: args.conversationId,
    timestamp: now,
    messageId: errorMessageId,
  })
}

function finalizeOk(
  runId: string,
  args: RunArgs,
  result: { artifactIds: string[]; outputMessageIds: string[] },
) {
  return finalize(runId, args, 'complete', result)
}

function finalizeFailed(runId: string, args: RunArgs, error: string) {
  return finalize(runId, args, 'failed', { artifactIds: [], outputMessageIds: [] }, error)
}

function publish(event: StreamEvent): void {
  eventBus.publish(event)
}

// ─── Adapter 输入构造 ─────────────────────────────────────
function buildAdapterInput(
  args: RunArgs,
  agent: AgentRow,
  runId: string,
  prompt: string,
  workspacePath: string,
  toolNames: string[],
  systemPromptOverride: string | undefined,
  attachments: AdapterAttachment[],
): AdapterInput {
  return {
    agentId: agent.id,
    conversationId: args.conversationId,
    runId,
    prompt,
    workspacePath,
    toolNames,
    attachments: attachments.length > 0 ? attachments : undefined,
    customConfig:
      agent.adapterName === 'custom' && agent.modelProvider && agent.modelId
        ? {
            systemPrompt: systemPromptOverride ?? agent.systemPrompt,
            modelProvider: agent.modelProvider,
            modelId: agent.modelId,
            supportsVision: agent.supportsVision,
          }
        : undefined,
  }
}

// ─── Prompt 构造 ───────────────────────────────────────────
function buildOrchestratorPlanPrompt(baseSystemPrompt: string, otherAgents: AgentRow[]): string {
  const agentList = otherAgents
    .map(
      (a) =>
        `- { id: ${JSON.stringify(a.id)}, name: ${JSON.stringify(a.name)}, capabilities: ${JSON.stringify(
          a.capabilities,
        )}, description: ${JSON.stringify(a.description)} }`,
    )
    .join('\n')

  return [
    baseSystemPrompt,
    '',
    '## 你的工作流',
    '1. 阅读用户最新请求与上下文。',
    '2. 调用 plan_tasks 工具，输出结构化 plan。',
    '3. 系统会自动执行 plan 并把子任务结果回传给你，由你做最终总结。',
    '',
    '## 可用 Agent',
    agentList.length > 0 ? agentList : '（无）',
    '',
    '## 拆解原则',
    '- 充分利用每个 Agent 的 capabilities，不要把任务派给不合适的人。',
    '- 能并行的不写 dependsOn；有依赖的明确写 dependsOn。',
    '- 每个子任务必须独立可执行（被分派的 Agent 看不到完整群聊上下文）。',
    '- 你只能调用 plan_tasks 工具，不要直接给用户输出最终答案。',
  ].join('\n')
}

function buildOrchestratorAggregatePrompt(baseSystemPrompt: string): string {
  return [
    baseSystemPrompt,
    '',
    '## 当前阶段',
    '你处于「聚合阶段」。所有子任务已执行完成（含成功与失败），结果在 user 消息中以 XML 给出。',
    '请直接给用户输出一条总结消息：',
    '- 简明列出完成 / 失败的任务',
    '- 用 <artifact_ref id="art_xxx"/> 形式引用关键产物（如果有）',
    '- 给出明确的下一步建议',
    '不要再调用 plan_tasks，不要把任务再次分派。',
  ].join('\n')
}

async function buildSubAgentPrompt(
  task: DispatchPlanItem,
  upstream: Map<string, RunResult>,
  conversationId: string,
): Promise<string> {
  // 收集已完成上游任务的 artifact 列表，作为隐式上下文
  const upstreamArtifactIds: string[] = []
  for (const dep of task.dependsOn ?? []) {
    const r = upstream.get(dep)
    if (r) upstreamArtifactIds.push(...r.artifactIds)
  }

  let upstreamArtifactsXml = ''
  if (upstreamArtifactIds.length > 0) {
    const artifacts = await db.query.artifacts.findMany({
      where: inArray(schema.artifacts.id, upstreamArtifactIds),
    })
    upstreamArtifactsXml = artifacts
      .map((a) => `  <artifact id="${a.id}" type="${a.type}" title=${JSON.stringify(a.title)} />`)
      .join('\n')
  }

  const existing = await db.query.artifacts.findMany({
    where: eq(schema.artifacts.conversationId, conversationId),
  })
  const existingXml = existing
    .map((a) => `  <artifact id="${a.id}" type="${a.type}" title=${JSON.stringify(a.title)} />`)
    .join('\n')

  return [
    '<context>',
    upstreamArtifactsXml &&
      `  <upstream_artifacts>\n${upstreamArtifactsXml}\n  </upstream_artifacts>`,
    `  <existing_artifacts>\n${existingXml || '    （无）'}\n  </existing_artifacts>`,
    '</context>',
    '',
    '<your_task>',
    task.task,
    '</your_task>',
    '',
    '执行任务，必要时通过 read_artifact 获取上游产物详情。',
  ]
    .filter(Boolean)
    .join('\n')
}

async function buildAggregatePrompt(
  originalUserPrompt: string,
  plan: DispatchPlanItem[],
  taskResults: Map<string, RunResult>,
  conversationId: string,
): Promise<string> {
  const allArtifactIds = [...taskResults.values()].flatMap((r) => r.artifactIds)
  const artifacts =
    allArtifactIds.length > 0
      ? await db.query.artifacts.findMany({
          where: inArray(schema.artifacts.id, allArtifactIds),
        })
      : []
  const artifactById = new Map<string, ArtifactRow>(artifacts.map((a) => [a.id, a]))

  const resultsXml = plan
    .map((t) => {
      const r = taskResults.get(t.id)
      if (!r) return ''
      const arts = r.artifactIds
        .map((id) => artifactById.get(id))
        .filter(Boolean)
        .map((a) => `    <artifact id="${a!.id}" type="${a!.type}" title=${JSON.stringify(a!.title)} />`)
        .join('\n')
      const inner = arts ? `\n${arts}\n  ` : ''
      const errAttr = r.error ? ` error=${JSON.stringify(r.error)}` : ''
      return `  <result task="${t.id}" agent="${t.agentId}" status="${r.status}"${errAttr}>${inner}</result>`
    })
    .filter(Boolean)
    .join('\n')

  return [
    `<user_request>${originalUserPrompt}</user_request>`,
    '<task_results>',
    resultsXml,
    '</task_results>',
    '',
    '请基于以上结果给用户输出最终总结消息。',
  ].join('\n')
}

// ─── 杂项 ──────────────────────────────────────────────────
function extractTextFromParts(parts: MessagePart[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text' || p.type === 'thinking') return p.content
      if (p.type === 'code') return '```' + p.language + '\n' + p.content + '\n```'
      if (p.type === 'image_attachment') {
        return `[图片附件: ${p.fileName} (${formatSize(p.size)}, ${p.mimeType}) · id=${p.attachmentId}]`
      }
      if (p.type === 'file_attachment') {
        return `[文件附件: ${p.fileName} (${formatSize(p.size)}, ${p.mimeType}) · id=${p.attachmentId}]`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function ensureIncludes(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr : [...arr, v]
}
