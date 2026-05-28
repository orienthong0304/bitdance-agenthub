import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { db, schema } from '@/db/client'
import type { ArtifactRow, MessageRow } from '@/db/schema'
import { estimateTokens } from '@/shared/model-registry'
import type { MessagePart } from '@/shared/types'

/**
 * 把 conversation messages 序列化成 OpenAI ChatMessage 数组，给 CustomAgentAdapter 拼到
 * [system, ...history, currentUser] 中间，让 agent 跨 run 记住上下文。
 *
 * 详细规格见 specs/13-conversation-context.md。
 */

export interface BuildHistoryOptions {
  /** 取最近多少条 messages（不含 pinned）。默认 20。 */
  maxTurns?: number
  /** 是否注入 pinned messages。默认 true。 */
  includePinned?: boolean
  /** 当前触发消息 id；它不应进入历史（避免重复）。 */
  excludeMessageId?: string
  /**
   * history 的 token 预算上限（仅本字段，不含 system / currentUser）。
   * undefined 表示不做 token 截断，只按 maxTurns 截。详见 spec 13 「Token 预算」节。
   * pinned 永远不被截断（即便整体超 budget）。
   */
  tokenBudget?: number
}

const DEFAULT_MAX_TURNS = 20

export async function buildHistoryFor(
  agentId: string,
  conversationId: string,
  options: BuildHistoryOptions = {},
): Promise<ChatCompletionMessageParam[]> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS
  const includePinned = options.includePinned ?? true
  const excludeMessageId = options.excludeMessageId
  const tokenBudget = options.tokenBudget

  // 拉最近 N 条 complete 消息（按时间逆序取，下面再翻回正序）
  const recentWhere = excludeMessageId
    ? and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.status, 'complete'),
        ne(schema.messages.id, excludeMessageId),
      )
    : and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.status, 'complete'),
      )

  const recent = await db
    .select()
    .from(schema.messages)
    .where(recentWhere)
    .orderBy(desc(schema.messages.createdAt))
    .limit(maxTurns)

  // pinned 消息：可能在最近 N 条之外，单独拉
  let pinned: MessageRow[] = []
  let pinnedIdSet = new Set<string>()
  if (includePinned) {
    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    })
    const pinnedIds = (conv?.pinnedMessageIds ?? []).filter((id) => id !== excludeMessageId)
    if (pinnedIds.length > 0) {
      pinned = await db
        .select()
        .from(schema.messages)
        .where(
          and(
            inArray(schema.messages.id, pinnedIds),
            eq(schema.messages.status, 'complete'),
          ),
        )
      pinnedIdSet = new Set(pinned.map((p) => p.id))
    }
  }

  // 合并去重，按时间升序
  const byId = new Map<string, MessageRow>()
  for (const m of recent) byId.set(m.id, m)
  for (const m of pinned) byId.set(m.id, m)
  const merged = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)

  // 批量取 artifact title 给 artifact_ref 折叠用
  const artifactIds = collectArtifactIds(merged)
  const artifactTitles = await loadArtifactTitles(artifactIds)

  // 先序列化全量，再按 token 预算从老往新丢非 pinned 项
  const items: Array<{
    msgId: string
    isPinned: boolean
    serialized: ChatCompletionMessageParam[]
    tokens: number
  }> = []
  for (const msg of merged) {
    const serialized = serializeMessage(msg, agentId, artifactTitles)
    if (!serialized) continue
    const tokens = serialized.reduce((sum, m) => sum + estimateChatMessageTokens(m), 0)
    items.push({ msgId: msg.id, isPinned: pinnedIdSet.has(msg.id), serialized, tokens })
  }

  if (tokenBudget !== undefined && tokenBudget > 0) {
    let total = items.reduce((s, it) => s + it.tokens, 0)
    // 超预算时，从老到新（按 items 顺序）丢非 pinned，直到符合预算
    for (let i = 0; i < items.length && total > tokenBudget; i++) {
      if (items[i].isPinned) continue
      total -= items[i].tokens
      items[i].tokens = -1 // 标记丢弃；保留 isPinned/order 但稍后过滤
    }
  }

  const out: ChatCompletionMessageParam[] = []
  for (const it of items) {
    if (it.tokens < 0) continue
    out.push(...it.serialized)
  }
  return out
}

// ─── token 估算（粗粒度，4 字符≈1 token） ─────────────────

function estimateChatMessageTokens(m: ChatCompletionMessageParam): number {
  let s = ''
  if (typeof m.content === 'string') {
    s += m.content
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part.type === 'text') s += part.text
      // multimodal image_url 不在 Phase A 历史里出现（spec 13），跳过估算
    }
  }
  if ('tool_calls' in m && m.tool_calls) {
    for (const tc of m.tool_calls) {
      // OpenAI ChatCompletion tool_calls union 含 function / custom 两种；function 形态走 .function.name/arguments
      if (tc.type === 'function') {
        s += tc.function.name + tc.function.arguments
      }
    }
  }
  // 每条 message 至少有 role / metadata 开销，加 4 token 兜底
  return estimateTokens(s) + 4
}

// ─── 序列化核心 ─────────────────────────────────────────

function serializeMessage(
  msg: MessageRow,
  currentAgentId: string,
  artifactTitles: Map<string, string>,
): ChatCompletionMessageParam[] | null {
  if (msg.role === 'system') return null // system prompt 由 agent-runner 注入，不进 history

  if (msg.role === 'user') {
    const content = renderUserParts(msg.parts)
    if (!content) return null
    return [{ role: 'user', content }]
  }

  // role === 'agent'
  if (msg.role === 'agent') {
    // Phase A / B：只处理「自己」的 agent message；他人的留给 Phase C
    if (msg.agentId !== currentAgentId) return null
    return renderSelfAssistantParts(msg.parts, artifactTitles)
  }

  return null
}

function renderUserParts(parts: MessagePart[]): string {
  const buf: string[] = []
  for (const p of parts) {
    switch (p.type) {
      case 'text':
        buf.push(p.content)
        break
      case 'image_attachment':
        buf.push(`[图片附件: ${p.fileName}]`)
        break
      case 'file_attachment':
        buf.push(`[文件附件: ${p.fileName}]`)
        break
      // user 不应出现 thinking/tool_use/tool_result/code/artifact_ref，跳过
      default:
        break
    }
  }
  return buf.join('\n').trim()
}

function renderSelfAssistantParts(
  parts: MessagePart[],
  artifactTitles: Map<string, string>,
): ChatCompletionMessageParam[] | null {
  // 先把 parts 拆成「文本类」和「工具调用 + 对应结果」
  const textBuf: string[] = []
  const toolUses: Array<{ callId: string; toolName: string; args: unknown }> = []
  const toolResults = new Map<string, { result: unknown; isError: boolean }>()

  for (const p of parts) {
    switch (p.type) {
      case 'text':
        if (p.content) textBuf.push(p.content)
        break
      case 'code':
        if (p.content) textBuf.push(p.content)
        break
      case 'artifact_ref': {
        const title = artifactTitles.get(p.artifactId) ?? ''
        textBuf.push(title ? `[产物: ${title} (id=${p.artifactId})]` : `[产物 ${p.artifactId}]`)
        break
      }
      case 'tool_use':
        toolUses.push({ callId: p.callId, toolName: p.toolName, args: p.args })
        break
      case 'tool_result':
        toolResults.set(p.callId, { result: p.result, isError: p.isError })
        break
      // thinking 一律丢
      default:
        break
    }
  }

  // 任何 tool_use 缺对应 tool_result → 整条消息跳过（OpenAI 不接受悬挂的 tool_call_id）
  for (const tu of toolUses) {
    if (!toolResults.has(tu.callId)) return null
  }

  const text = textBuf.join('\n').trim()
  const hasTools = toolUses.length > 0
  if (!text && !hasTools) return null

  const messages: ChatCompletionMessageParam[] = []

  if (hasTools) {
    // assistant message with tool_calls
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: toolUses.map((t) => ({
        id: t.callId,
        type: 'function' as const,
        function: {
          name: t.toolName,
          arguments: JSON.stringify(t.args ?? {}),
        },
      })),
    })
    // each tool_call 跟一条 tool message
    for (const t of toolUses) {
      const r = toolResults.get(t.callId)!
      messages.push({
        role: 'tool',
        tool_call_id: t.callId,
        content: stringifyToolResult(r.result, r.isError),
      })
    }
  } else {
    // 纯文本 assistant
    messages.push({ role: 'assistant', content: text })
  }

  return messages
}

function stringifyToolResult(result: unknown, isError: boolean): string {
  if (typeof result === 'string') return isError ? `[error] ${result}` : result
  try {
    const s = JSON.stringify(result)
    return isError ? `[error] ${s}` : s
  } catch {
    return isError ? '[error] (unserializable)' : '(unserializable)'
  }
}

// ─── 批量取 artifact title ───────────────────────────────

function collectArtifactIds(messages: MessageRow[]): string[] {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'agent') continue
    for (const p of m.parts) {
      if (p.type === 'artifact_ref') ids.add(p.artifactId)
    }
  }
  return Array.from(ids)
}

async function loadArtifactTitles(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const rows = await db
    .select({ id: schema.artifacts.id, title: schema.artifacts.title })
    .from(schema.artifacts)
    .where(inArray(schema.artifacts.id, ids))
  for (const r of rows as Pick<ArtifactRow, 'id' | 'title'>[]) {
    out.set(r.id, r.title)
  }
  return out
}
