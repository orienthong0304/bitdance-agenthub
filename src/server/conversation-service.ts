import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { MessagePart } from '@/shared/types'

import { AgentRunner } from './agent-runner'
import {
  newConversationId,
  newMessageId,
  newWorkspaceId,
} from './ids'

const WORKSPACES_ROOT = path.resolve(process.cwd(), '.agenthub-data', 'workspaces')

// ─── 创建会话 ────────────────────────────────────────────
export interface CreateConversationArgs {
  title?: string
  mode: 'single' | 'group'
  agentIds: string[]
}

export async function createConversation(args: CreateConversationArgs) {
  if (args.agentIds.length === 0) {
    throw new Error('At least one agent is required')
  }
  if (args.mode === 'single' && args.agentIds.length !== 1) {
    throw new Error('Single conversation requires exactly one agent')
  }
  if (args.mode === 'group' && args.agentIds.length < 2) {
    throw new Error('Group conversation requires at least two agents')
  }

  // 校验 agent 都存在
  const agents = await db.query.agents.findMany({
    where: (a, { inArray }) => inArray(a.id, args.agentIds),
  })
  if (agents.length !== args.agentIds.length) {
    const found = new Set(agents.map((a) => a.id))
    const missing = args.agentIds.filter((id) => !found.has(id))
    throw new Error(`Agents not found: ${missing.join(', ')}`)
  }

  const now = Date.now()
  const conversationId = newConversationId()
  const workspaceId = newWorkspaceId()
  const rootPath = path.join(WORKSPACES_ROOT, conversationId)

  mkdirSync(rootPath, { recursive: true })

  const title = args.title ?? defaultTitleFor(agents)

  db.transaction((tx) => {
    tx.insert(schema.conversations)
      .values({
        id: conversationId,
        title,
        mode: args.mode,
        agentIds: args.agentIds,
        pinnedMessageIds: [],
        archived: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    tx.insert(schema.workspaces)
      .values({
        id: workspaceId,
        conversationId,
        rootPath,
        createdAt: now,
      })
      .run()
  })

  return {
    id: conversationId,
    title,
    mode: args.mode,
    agentIds: args.agentIds,
    createdAt: now,
    updatedAt: now,
    archived: false,
  }
}

function defaultTitleFor(agents: { name: string }[]): string {
  if (agents.length === 1) return `与 ${agents[0].name} 的对话`
  return agents.map((a) => a.name).join(' / ')
}

// ─── 列出会话 ────────────────────────────────────────────
export async function listConversations() {
  return db.query.conversations.findMany({
    orderBy: [desc(schema.conversations.updatedAt)],
  })
}

// ─── 列出会话消息 ────────────────────────────────────────
export async function listMessages(conversationId: string) {
  return db.query.messages.findMany({
    where: eq(schema.messages.conversationId, conversationId),
    orderBy: [schema.messages.createdAt],
  })
}

// ─── 发消息 ──────────────────────────────────────────────
export interface SendMessageArgs {
  conversationId: string
  content: string
  mentionedAgentIds?: string[]
}

export async function sendMessage(args: SendMessageArgs) {
  const conv = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, args.conversationId),
  })
  if (!conv) {
    throw new Error(`Conversation not found: ${args.conversationId}`)
  }

  const now = Date.now()
  const messageId = newMessageId()
  const parts: MessagePart[] = [{ type: 'text', content: args.content }]

  await db.insert(schema.messages).values({
    id: messageId,
    conversationId: args.conversationId,
    role: 'user',
    parts,
    status: 'complete',
    mentionedAgentIds: args.mentionedAgentIds ?? [],
    createdAt: now,
  })

  await db
    .update(schema.conversations)
    .set({ updatedAt: now })
    .where(eq(schema.conversations.id, args.conversationId))

  // 决定 responder
  const responders = decideResponders(conv, args.mentionedAgentIds ?? [])

  const runIds: string[] = []
  for (const agentId of responders) {
    const { runId } = AgentRunner.run({
      agentId,
      conversationId: args.conversationId,
      triggerMessageId: messageId,
    })
    runIds.push(runId)
  }

  return { messageId, runIds }
}

function decideResponders(
  conv: typeof schema.conversations.$inferSelect,
  mentions: string[],
): string[] {
  // 单聊：直接交给那个 agent
  if (conv.mode === 'single') return conv.agentIds

  // 群聊有 @ 时，被 @ 的 agent 各自响应
  if (mentions.length > 0) {
    return mentions.filter((id) => conv.agentIds.includes(id))
  }

  // 群聊无 @ 时，由 Orchestrator 响应（后续 milestone 实现 Orchestrator 调度）
  // MVP 阶段：找到群里的 isOrchestrator agent，没有则报错
  // 这里仅保留入口位置，实际判定放到 Orchestrator 实现 milestone 再补
  return []
}

// ─── 中止 run ────────────────────────────────────────────
export function abortRun(runId: string): boolean {
  return AgentRunner.abort(runId)
}
