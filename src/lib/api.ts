import type { AgentRow, ArtifactRow, AttachmentRow, ConversationRow, MessageRow } from '@/db/schema'

export interface ArtifactListItem {
  id: string
  conversationId: string
  conversationTitle: string | null
  type: string
  title: string
  version: number
  createdByAgentId: string
  createdAt: number
}

async function json<T>(req: Promise<Response>): Promise<T> {
  const res = await req
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ─── Agents ─────────────────────────────────────
export async function fetchAgents(): Promise<AgentRow[]> {
  const { agents } = await json<{ agents: AgentRow[] }>(fetch('/api/agents'))
  return agents
}

export interface CreateAgentBody {
  name: string
  avatar: string
  description: string
  capabilities: string[]
  systemPrompt: string
  modelProvider: 'anthropic' | 'openai' | 'deepseek' | 'volcano-ark'
  modelId: string
  toolNames: string[]
  supportsVision?: boolean
  apiKey?: string
}

export async function createAgent(body: CreateAgentBody): Promise<AgentRow> {
  const { agent } = await json<{ agent: AgentRow }>(
    fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return agent
}

export type UpdateAgentBody = Partial<Omit<CreateAgentBody, 'avatar' | 'apiKey'>> & {
  // 显式 null 表示清除自定义 key；undefined 表示不改
  apiKey?: string | null
}

export async function updateAgent(agentId: string, patch: UpdateAgentBody): Promise<AgentRow> {
  const { agent } = await json<{ agent: AgentRow }>(
    fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  )
  return agent
}

export async function deleteAgent(agentId: string): Promise<void> {
  await json<{ ok: true }>(fetch(`/api/agents/${agentId}`, { method: 'DELETE' }))
}

// ─── Conversations ──────────────────────────────
export async function fetchConversations(): Promise<ConversationRow[]> {
  const { conversations } = await json<{ conversations: ConversationRow[] }>(
    fetch('/api/conversations'),
  )
  return conversations
}

export interface CreateConversationBody {
  title?: string
  mode: 'single' | 'group'
  agentIds: string[]
}

export async function createConversation(body: CreateConversationBody): Promise<ConversationRow> {
  const { conversation } = await json<{ conversation: ConversationRow }>(
    fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return conversation
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await json<{ ok: true }>(
    fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' }),
  )
}

export async function addAgentsToConversation(
  conversationId: string,
  addAgentIds: string[],
): Promise<ConversationRow> {
  const { conversation } = await json<{ conversation: ConversationRow }>(
    fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addAgentIds }),
    }),
  )
  return conversation
}

// ─── Messages ───────────────────────────────────
export async function fetchMessages(conversationId: string): Promise<MessageRow[]> {
  const { messages } = await json<{ messages: MessageRow[] }>(
    fetch(`/api/conversations/${conversationId}/messages`),
  )
  return messages
}

export interface SendMessageBody {
  content: string
  mentionedAgentIds?: string[]
  parentMessageId?: string
  attachmentIds?: string[]
}

export interface SendMessageResult {
  messageId: string
  runIds: string[]
}

export async function sendMessage(
  conversationId: string,
  body: SendMessageBody,
): Promise<SendMessageResult> {
  return json<SendMessageResult>(
    fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

// ─── Runs ───────────────────────────────────────
export async function abortRun(runId: string): Promise<void> {
  await json<{ ok: true }>(fetch(`/api/runs/${runId}/abort`, { method: 'POST' }))
}

// ─── Artifacts ─────────────────────────────────
export async function fetchArtifacts(): Promise<ArtifactListItem[]> {
  const { artifacts } = await json<{ artifacts: ArtifactListItem[] }>(fetch('/api/artifacts'))
  return artifacts
}

export async function fetchArtifact(artifactId: string): Promise<ArtifactRow> {
  const { artifact } = await json<{ artifact: ArtifactRow }>(
    fetch(`/api/artifacts/${artifactId}`),
  )
  return artifact
}

export async function deleteArtifact(artifactId: string): Promise<void> {
  await json<{ ok: true }>(
    fetch(`/api/artifacts/${artifactId}`, { method: 'DELETE' }),
  )
}

// ─── Attachments ───────────────────────────────
export async function fetchAttachments(conversationId: string): Promise<AttachmentRow[]> {
  const { attachments } = await json<{ attachments: AttachmentRow[] }>(
    fetch(`/api/conversations/${conversationId}/attachments`),
  )
  return attachments
}

export async function uploadAttachment(
  conversationId: string,
  file: File,
): Promise<AttachmentRow> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/conversations/${conversationId}/attachments`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
  }
  const { attachment } = (await res.json()) as { attachment: AttachmentRow }
  return attachment
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  await json<{ ok: true }>(fetch(`/api/attachments/${attachmentId}`, { method: 'DELETE' }))
}

export function attachmentDownloadUrl(attachmentId: string): string {
  return `/api/attachments/${attachmentId}`
}
