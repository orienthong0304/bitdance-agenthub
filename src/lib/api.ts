import type {
  AgentRow,
  ArtifactRow,
  AttachmentRow,
  ConversationRow,
  ConversationWithMeta,
  MessageRow,
} from '@/db/schema'
import type { AskUserAnswer, PendingQuestion, PendingWrite } from '@/shared/types'

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
  /** 默认 'custom'。'claude-code' 走 Anthropic Claude Agent SDK，SDK 内置工具集 */
  adapterName?: 'custom' | 'claude-code'
  /** custom: required；claude-code: 忽略 */
  modelProvider?: 'anthropic' | 'openai' | 'deepseek' | 'volcano-ark'
  /** custom: required；claude-code: 可选，默认 SDK 默认模型 */
  modelId?: string
  toolNames: string[]
  supportsVision?: boolean
  apiKey?: string
  /** 自定义 API base URL（第三方 endpoint，如 anyrouter）。空走默认 */
  apiBaseUrl?: string
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

export type UpdateAgentBody = Partial<Omit<CreateAgentBody, 'avatar' | 'apiKey' | 'apiBaseUrl'>> & {
  // 显式 null 表示清除自定义 key；undefined 表示不改
  apiKey?: string | null
  // 同上
  apiBaseUrl?: string | null
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
export async function fetchConversations(): Promise<ConversationWithMeta[]> {
  const { conversations } = await json<{ conversations: ConversationWithMeta[] }>(
    fetch('/api/conversations'),
  )
  return conversations
}

export interface CreateConversationBody {
  title?: string
  mode: 'single' | 'group'
  agentIds: string[]
  boundPath?: string
}

export async function createConversation(body: CreateConversationBody): Promise<ConversationWithMeta> {
  const { conversation } = await json<{ conversation: ConversationWithMeta }>(
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
): Promise<ConversationWithMeta> {
  const { conversation } = await json<{ conversation: ConversationWithMeta }>(
    fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addAgentIds }),
    }),
  )
  return conversation
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<ConversationWithMeta> {
  const { conversation } = await json<{ conversation: ConversationWithMeta }>(
    fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
  )
  return conversation
}

export async function togglePinConversation(conversationId: string): Promise<ConversationWithMeta> {
  const { conversation } = await json<{ conversation: ConversationWithMeta }>(
    fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ togglePin: true }),
    }),
  )
  return conversation
}

export async function setFsWriteApprovalMode(
  conversationId: string,
  mode: 'auto' | 'review',
): Promise<ConversationWithMeta> {
  const { conversation } = await json<{ conversation: ConversationWithMeta }>(
    fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fsWriteApprovalMode: mode }),
    }),
  )
  return conversation
}

// ─── Pending writes (fs_write review mode) ─────
export async function fetchPendingWrites(conversationId: string): Promise<PendingWrite[]> {
  const { pendingWrites } = await json<{ pendingWrites: PendingWrite[] }>(
    fetch(`/api/conversations/${conversationId}/pending-writes`),
  )
  return pendingWrites
}

export async function approvePendingWrite(
  conversationId: string,
  pendingId: string,
): Promise<void> {
  await json<{ ok: true }>(
    fetch(`/api/conversations/${conversationId}/pending-writes/${pendingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    }),
  )
}

export async function rejectPendingWrite(
  conversationId: string,
  pendingId: string,
): Promise<void> {
  await json<{ ok: true }>(
    fetch(`/api/conversations/${conversationId}/pending-writes/${pendingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    }),
  )
}

// ─── Pending questions (ask_user) ───────────────
export async function fetchPendingQuestions(conversationId: string): Promise<PendingQuestion[]> {
  const { pendingQuestions } = await json<{ pendingQuestions: PendingQuestion[] }>(
    fetch(`/api/conversations/${conversationId}/pending-questions`),
  )
  return pendingQuestions
}

export async function submitQuestionAnswers(
  conversationId: string,
  questionId: string,
  answers: Record<string, AskUserAnswer>,
): Promise<void> {
  await json<{ ok: true }>(
    fetch(`/api/conversations/${conversationId}/pending-questions/${questionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    }),
  )
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

// ─── Messages: withdraw / edit ──────────────────
export interface WithdrawResult {
  deletedMessageIds: string[]
  deletedArtifactIds: string[]
}

export async function withdrawMessage(
  messageId: string,
  conversationId: string,
): Promise<WithdrawResult> {
  return json<WithdrawResult>(
    fetch(`/api/messages/${messageId}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    }),
  )
}

export interface EditAndResendResult extends WithdrawResult {
  newMessage: MessageRow
  runIds: string[]
}

export interface RegenerateResult extends WithdrawResult {
  triggerMessageId: string
  runIds: string[]
}

export async function regenerateLastResponse(conversationId: string): Promise<RegenerateResult> {
  return json<RegenerateResult>(
    fetch(`/api/conversations/${conversationId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    }),
  )
}

export async function editAndResendMessage(
  messageId: string,
  conversationId: string,
  content: string,
): Promise<EditAndResendResult> {
  return json<EditAndResendResult>(
    fetch(`/api/messages/${messageId}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, content }),
    }),
  )
}

export interface ToggleBookmarkResult {
  bookmarkedMessageIds: string[]
  bookmarked: boolean
}

export async function toggleMessageBookmark(
  messageId: string,
  conversationId: string,
): Promise<ToggleBookmarkResult> {
  return json<ToggleBookmarkResult>(
    fetch(`/api/messages/${messageId}/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    }),
  )
}

export interface TogglePinResult {
  pinnedMessageIds: string[]
  pinned: boolean
}

export async function toggleMessagePin(
  messageId: string,
  conversationId: string,
): Promise<TogglePinResult> {
  return json<TogglePinResult>(
    fetch(`/api/messages/${messageId}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    }),
  )
}

// ─── Filesystem (DirPicker) ────────────────────
export interface ListDirResult {
  path: string
  parent: string | null
  entries: Array<{ name: string; isDirectory: boolean }>
}

export async function listDirectory(targetPath?: string): Promise<ListDirResult> {
  const qs = targetPath ? `?path=${encodeURIComponent(targetPath)}` : ''
  return json<ListDirResult>(fetch(`/api/fs/listdir${qs}`))
}

// ─── Filesystem (conversation-scoped, 文件浏览器面板用) ────────
export interface WorkspaceListResult {
  relPath: string
  absolutePath: string
  parent: string | null
  entries: Array<{ name: string; isDirectory: boolean; size?: number }>
}

export async function workspaceListDir(
  conversationId: string,
  relPath = '',
): Promise<WorkspaceListResult> {
  const qs = relPath ? `?path=${encodeURIComponent(relPath)}` : ''
  return json<WorkspaceListResult>(fetch(`/api/conversations/${conversationId}/fs/listdir${qs}`))
}

export interface WorkspaceReadResult {
  path: string
  absolutePath: string
  cwd: string
  size: number
  content: string
  truncated: boolean
}

export async function workspaceReadFile(
  conversationId: string,
  relPath: string,
): Promise<WorkspaceReadResult> {
  return json<WorkspaceReadResult>(
    fetch(`/api/conversations/${conversationId}/fs/read?path=${encodeURIComponent(relPath)}`),
  )
}

export interface WorkspaceWriteResult {
  path: string
  absolutePath: string
  cwd: string
  bytes: number
}

export async function workspaceWriteFile(
  conversationId: string,
  relPath: string,
  content: string,
): Promise<WorkspaceWriteResult> {
  return json<WorkspaceWriteResult>(
    fetch(`/api/conversations/${conversationId}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, content }),
    }),
  )
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

export async function fetchArtifactVersions(artifactId: string): Promise<ArtifactRow[]> {
  const { versions } = await json<{ versions: ArtifactRow[] }>(
    fetch(`/api/artifacts/${artifactId}/versions`),
  )
  return versions
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

// ─── Usage / Analytics ─────────────────────────────
export interface UsageBucket {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  runs: number
}

export interface UsageSummary {
  today: UsageBucket
  week: UsageBucket
  allTime: UsageBucket
  topConversations: Array<{
    id: string
    title: string
    totalTokens: number
    runs: number
    updatedAt: number
  }>
  byAgent: Array<{ agentId: string; name: string; totalTokens: number; runs: number }>
  byModel: Array<{ model: string; totalTokens: number; runs: number }>
}

export async function fetchUsageSummary(): Promise<UsageSummary> {
  return json<UsageSummary>(fetch('/api/usage/summary'))
}
