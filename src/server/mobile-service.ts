import { and, desc, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { AgentRunRow, ConversationWithMeta } from '@/db/schema'
import { listAgentsOrdered } from '@/server/agent-service'
import { listConversations, listMessages, sendMessage } from '@/server/conversation-service'
import { pendingQuestions } from '@/server/pending-questions'
import { pendingWrites } from '@/server/pending-writes'
import type { MessagePart, PendingQuestion, PendingWrite } from '@/shared/types'

import packageJson from '../../package.json'

export interface MobileConversationSummary {
  id: string
  title: string
  mode: 'single' | 'group'
  updatedAt: number
  runningRunCount: number
  pendingWriteCount: number
  pendingQuestionCount: number
}

export interface MobileAgent {
  id: string
  name: string
  avatar: string
  description: string
  isOrchestrator: boolean
}

export interface MobileRun {
  id: string
  conversationId: string
  agentId: string
  status: 'queued' | 'running' | 'complete' | 'failed' | 'aborted'
  startedAt: number
}

export type MobileMessagePart =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; toolName: string }
  | { type: 'tool_result'; isError: boolean }
  | { type: 'artifact_ref'; artifactId: string }
  | { type: 'attachment'; fileName: string; kind: 'image' | 'file' }

export interface MobileMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agentId: string | null
  parts: MobileMessagePart[]
  status: 'streaming' | 'complete' | 'error' | 'aborted'
  createdAt: number
}

export interface MobileConversationDetail {
  conversation: {
    id: string
    title: string
    mode: 'single' | 'group'
    agentIds: string[]
    updatedAt: number
  }
  messages: MobileMessage[]
  runningRuns: MobileRun[]
  pendingWrites: MobilePendingWrite[]
  pendingQuestions: MobilePendingQuestion[]
}

export interface MobilePendingWrite {
  id: string
  conversationId: string
  agentId: string
  runId: string
  path: string
  oldContent: string | null
  newContent: string
  createdAt: number
}

export interface MobilePendingQuestion {
  id: string
  conversationId: string
  agentId: string
  runId: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
  createdAt: number
}

export interface MobileSnapshot {
  conversations: MobileConversationSummary[]
  agents: MobileAgent[]
  runningRuns: MobileRun[]
  pendingWrites: MobilePendingWrite[]
  pendingQuestions: MobilePendingQuestion[]
  server: {
    version: string
    companionMode: 'lan' | 'tailnet'
  }
}

export async function getMobileSnapshot(): Promise<MobileSnapshot> {
  const [conversations, agents] = await Promise.all([
    listConversations(),
    listAgentsOrdered(),
  ])

  const runningRuns = await listActiveRuns(conversations.map((conversation) => conversation.id))
  const pendingWritesByConversation = collectPendingWrites(conversations)
  const pendingQuestionsByConversation = collectPendingQuestions(conversations)

  return {
    conversations: conversations.map((conversation) =>
      toMobileConversation(
        conversation,
        runningRuns,
        pendingWritesByConversation.get(conversation.id) ?? [],
        pendingQuestionsByConversation.get(conversation.id) ?? [],
      ),
    ),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      description: agent.description,
      isOrchestrator: agent.isOrchestrator,
    })),
    runningRuns: runningRuns.map(toMobileRun),
    pendingWrites: Array.from(pendingWritesByConversation.values())
      .flat()
      .map(toMobilePendingWrite),
    pendingQuestions: Array.from(pendingQuestionsByConversation.values())
      .flat()
      .map(toMobilePendingQuestion),
    server: {
      version: packageJson.version,
      companionMode: process.env.AGENTHUB_COMPANION_MODE === 'tailnet' ? 'tailnet' : 'lan',
    },
  }
}

export async function getMobileConversationDetail(
  conversationId: string,
): Promise<MobileConversationDetail> {
  const conversations = await listConversations()
  const conversation = conversations.find((item) => item.id === conversationId)
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`)

  const [messages, runningRuns] = await Promise.all([
    listMessages(conversationId),
    listActiveRuns([conversationId]),
  ])
  const writes = pendingWrites.listByConversation(conversationId)
  const questions = pendingQuestions.listByConversation(conversationId)

  return {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      mode: conversation.mode,
      agentIds: conversation.agentIds,
      updatedAt: conversation.updatedAt,
    },
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      agentId: message.agentId,
      parts: message.parts.map(toMobileMessagePart),
      status: message.status,
      createdAt: message.createdAt,
    })),
    runningRuns: runningRuns.map(toMobileRun),
    pendingWrites: writes.map(toMobilePendingWrite),
    pendingQuestions: questions.map(toMobilePendingQuestion),
  }
}

export async function sendMobileMessage(args: {
  conversationId: string
  content: string
}): Promise<{ messageId: string; runIds: string[] }> {
  return sendMessage({
    conversationId: args.conversationId,
    content: args.content,
  })
}

async function listActiveRuns(conversationIds: string[]): Promise<AgentRunRow[]> {
  if (conversationIds.length === 0) return []
  return db.query.agentRuns.findMany({
    where: and(
      inArray(schema.agentRuns.conversationId, conversationIds),
      inArray(schema.agentRuns.status, ['queued', 'running']),
    ),
    orderBy: [desc(schema.agentRuns.startedAt)],
  })
}

function collectPendingWrites(
  conversations: ConversationWithMeta[],
): Map<string, PendingWrite[]> {
  return new Map(
    conversations.map((conversation) => [
      conversation.id,
      pendingWrites.listByConversation(conversation.id),
    ]),
  )
}

function collectPendingQuestions(
  conversations: ConversationWithMeta[],
): Map<string, PendingQuestion[]> {
  return new Map(
    conversations.map((conversation) => [
      conversation.id,
      pendingQuestions.listByConversation(conversation.id),
    ]),
  )
}

function toMobileConversation(
  conversation: ConversationWithMeta,
  runningRuns: AgentRunRow[],
  writes: PendingWrite[],
  questions: PendingQuestion[],
): MobileConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    mode: conversation.mode,
    updatedAt: conversation.updatedAt,
    runningRunCount: runningRuns.filter((run) => run.conversationId === conversation.id).length,
    pendingWriteCount: writes.length,
    pendingQuestionCount: questions.length,
  }
}

function toMobileRun(run: AgentRunRow): MobileRun {
  return {
    id: run.id,
    conversationId: run.conversationId,
    agentId: run.agentId,
    status: run.status,
    startedAt: run.startedAt,
  }
}

function toMobileMessagePart(part: MessagePart): MobileMessagePart {
  switch (part.type) {
    case 'text':
      return { type: 'text', content: part.content }
    case 'code':
      return { type: 'code', language: part.language, content: part.content }
    case 'thinking':
      return { type: 'thinking', content: part.content }
    case 'tool_use':
      return { type: 'tool_use', toolName: part.toolName }
    case 'tool_result':
      return { type: 'tool_result', isError: part.isError }
    case 'artifact_ref':
      return { type: 'artifact_ref', artifactId: part.artifactId }
    case 'image_attachment':
      return { type: 'attachment', fileName: part.fileName, kind: 'image' }
    case 'file_attachment':
      return { type: 'attachment', fileName: part.fileName, kind: 'file' }
  }
}

function toMobilePendingWrite(write: PendingWrite): MobilePendingWrite {
  return {
    id: write.id,
    conversationId: write.conversationId,
    agentId: write.agentId,
    runId: write.runId,
    path: write.path,
    oldContent: write.oldContent,
    newContent: write.newContent,
    createdAt: write.createdAt,
  }
}

function toMobilePendingQuestion(question: PendingQuestion): MobilePendingQuestion {
  return {
    id: question.id,
    conversationId: question.conversationId,
    agentId: question.agentId,
    runId: question.runId,
    questions: question.questions.map((item) => ({
      question: item.question,
      header: item.header,
      options: item.options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
      multiSelect: item.multiSelect,
    })),
    createdAt: question.createdAt,
  }
}
