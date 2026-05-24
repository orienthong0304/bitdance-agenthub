'use client'

import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { AgentRunRow, AgentRow, ArtifactRow, AttachmentRow, ConversationRow, MessageRow } from '@/db/schema'
import type { DispatchPlanItem, MessagePart, StreamEvent } from '@/shared/types'

enableMapSet()

export interface DispatchState {
  runId: string                                    // Orchestrator 的 runId
  messageId: string                                // 触发 plan 的 Orchestrator message id
  plan: DispatchPlanItem[]
  taskStatus: Record<string, 'pending' | 'running' | 'complete' | 'failed'>
  childRunIds: Record<string, string>              // taskId → childRunId
}

interface AppState {
  // ─── 实体 ──────────────────────────────────────────
  conversations: Record<string, ConversationRow>
  agents: Record<string, AgentRow>
  messages: Record<string, MessageRow>
  artifacts: Record<string, ArtifactRow>

  // ─── 关系（按 conversationId 分桶）───────────────
  messageIdsByConv: Record<string, string[]>
  runsByConv: Record<string, Record<string, AgentRunRow>>

  // Orchestrator 的调度状态，按 Orchestrator runId 索引
  dispatchesByRunId: Record<string, DispatchState>

  // ─── 当前会话 ──────────────────────────────────────
  activeConversationId: string | null

  // ─── 产物预览 ──────────────────────────────────────
  previewArtifactId: string | null

  // ─── 引用回复目标（按 conversationId 分桶）───────
  replyTargetByConv: Record<string, string | null>

  // ─── 待发送的附件（按 conversationId 分桶）。文件库和 MessageInput 共享。
  pendingAttachmentsByConv: Record<string, AttachmentRow[]>

  // ─── 流连接状态 ────────────────────────────────────
  streamConnected: boolean

  // ─── actions ───────────────────────────────────────
  setStreamConnected(connected: boolean): void

  setConversations(list: ConversationRow[]): void
  upsertConversation(conv: ConversationRow): void
  removeConversation(id: string): void

  setAgents(list: AgentRow[]): void
  upsertAgent(agent: AgentRow): void
  removeAgent(agentId: string): void

  setMessagesForConversation(conversationId: string, list: MessageRow[]): void
  /** 单条 message upsert（编辑后重发场景：服务端写完 user message，前端要自己塞进 store）。 */
  upsertMessage(message: MessageRow): void
  setActiveConversation(id: string | null): void

  openArtifactPreview(artifactId: string): void
  closeArtifactPreview(): void
  upsertArtifact(artifact: ArtifactRow): void
  removeArtifact(artifactId: string): void
  removeArtifacts(artifactIds: string[]): void

  setReplyTarget(conversationId: string, messageId: string | null): void

  /** 批量删除消息（撤回 / 编辑场景）。同时清理 messageIdsByConv 对应桶 + replyTarget。 */
  removeMessages(conversationId: string, messageIds: string[]): void

  addPendingAttachment(conversationId: string, attachment: AttachmentRow): void
  removePendingAttachment(conversationId: string, attachmentId: string): void
  clearPendingAttachments(conversationId: string): void

  /** 高亮指定消息 1.5 秒（点击「引用」预览时的跳转反馈） */
  highlightedMessageId: string | null
  highlightMessage(messageId: string): void

  addLocalUserMessage(args: {
    tempId: string
    conversationId: string
    content: string
    mentionedAgentIds: string[]
    parentMessageId?: string | null
    attachments?: AttachmentRow[]
  }): void
  replaceLocalMessageId(tempId: string, realId: string): void

  applyEvent(event: StreamEvent): void
}

export const useAppStore = create<AppState>()(
  immer((set) => ({
    conversations: {},
    agents: {},
    messages: {},
    artifacts: {},
    messageIdsByConv: {},
    runsByConv: {},
    dispatchesByRunId: {},
    activeConversationId: null,
    previewArtifactId: null,
    replyTargetByConv: {},
    pendingAttachmentsByConv: {},
    highlightedMessageId: null,
    streamConnected: false,

    setStreamConnected: (connected) =>
      set((s) => {
        s.streamConnected = connected
      }),

    setConversations: (list) =>
      set((s) => {
        for (const c of list) s.conversations[c.id] = c
      }),

    upsertConversation: (conv) =>
      set((s) => {
        s.conversations[conv.id] = conv
      }),

    removeConversation: (id) =>
      set((s) => {
        delete s.conversations[id]
        // 清理该会话所有消息
        const msgIds = s.messageIdsByConv[id] ?? []
        for (const mid of msgIds) delete s.messages[mid]
        delete s.messageIdsByConv[id]
        delete s.runsByConv[id]
        if (s.activeConversationId === id) s.activeConversationId = null
      }),

    setAgents: (list) =>
      set((s) => {
        for (const a of list) s.agents[a.id] = a
      }),

    upsertAgent: (agent) =>
      set((s) => {
        s.agents[agent.id] = agent
      }),

    removeAgent: (agentId) =>
      set((s) => {
        delete s.agents[agentId]
      }),

    setMessagesForConversation: (conversationId, list) =>
      set((s) => {
        s.messageIdsByConv[conversationId] = list.map((m) => m.id)
        for (const m of list) s.messages[m.id] = m
      }),

    upsertMessage: (message) =>
      set((s) => {
        s.messages[message.id] = message
        const bucket = (s.messageIdsByConv[message.conversationId] ??= [])
        if (!bucket.includes(message.id)) bucket.push(message.id)
      }),

    setActiveConversation: (id) =>
      set((s) => {
        s.activeConversationId = id
      }),

    openArtifactPreview: (artifactId) =>
      set((s) => {
        s.previewArtifactId = artifactId
      }),

    closeArtifactPreview: () =>
      set((s) => {
        s.previewArtifactId = null
      }),

    upsertArtifact: (artifact) =>
      set((s) => {
        s.artifacts[artifact.id] = artifact
      }),

    removeArtifact: (artifactId) =>
      set((s) => {
        delete s.artifacts[artifactId]
        if (s.previewArtifactId === artifactId) s.previewArtifactId = null
      }),

    removeArtifacts: (artifactIds) =>
      set((s) => {
        for (const id of artifactIds) {
          delete s.artifacts[id]
          if (s.previewArtifactId === id) s.previewArtifactId = null
        }
      }),

    removeMessages: (conversationId, messageIds) =>
      set((s) => {
        const toRemove = new Set(messageIds)
        for (const id of toRemove) delete s.messages[id]

        const bucket = s.messageIdsByConv[conversationId]
        if (bucket) {
          s.messageIdsByConv[conversationId] = bucket.filter((id) => !toRemove.has(id))
        }

        // 清理可能指向被删消息的 replyTarget
        const replyId = s.replyTargetByConv[conversationId]
        if (replyId && toRemove.has(replyId)) {
          delete s.replyTargetByConv[conversationId]
        }
      }),

    setReplyTarget: (conversationId, messageId) =>
      set((s) => {
        if (messageId) s.replyTargetByConv[conversationId] = messageId
        else delete s.replyTargetByConv[conversationId]
      }),

    addPendingAttachment: (conversationId, attachment) =>
      set((s) => {
        const list = s.pendingAttachmentsByConv[conversationId] ?? []
        if (list.some((a) => a.id === attachment.id)) return
        s.pendingAttachmentsByConv[conversationId] = [...list, attachment]
      }),

    removePendingAttachment: (conversationId, attachmentId) =>
      set((s) => {
        const list = s.pendingAttachmentsByConv[conversationId]
        if (!list) return
        const next = list.filter((a) => a.id !== attachmentId)
        if (next.length === 0) delete s.pendingAttachmentsByConv[conversationId]
        else s.pendingAttachmentsByConv[conversationId] = next
      }),

    clearPendingAttachments: (conversationId) =>
      set((s) => {
        delete s.pendingAttachmentsByConv[conversationId]
      }),

    highlightMessage: (messageId) => {
      set((s) => {
        s.highlightedMessageId = messageId
      })
      setTimeout(() => {
        // 仅在仍是同一目标时清除（避免连续点击的竞态）
        const current = useAppStore.getState().highlightedMessageId
        if (current === messageId) {
          useAppStore.setState((s) => {
            s.highlightedMessageId = null
          })
        }
      }, 1500)
    },

    addLocalUserMessage: ({ tempId, conversationId, content, mentionedAgentIds, parentMessageId, attachments }) =>
      set((s) => {
        const parts: MessagePart[] = []
        if (content) parts.push({ type: 'text', content })
        for (const a of attachments ?? []) {
          parts.push(
            a.kind === 'image'
              ? {
                  type: 'image_attachment',
                  attachmentId: a.id,
                  fileName: a.fileName,
                  size: a.size,
                  mimeType: a.mimeType,
                }
              : {
                  type: 'file_attachment',
                  attachmentId: a.id,
                  fileName: a.fileName,
                  size: a.size,
                  mimeType: a.mimeType,
                },
          )
        }
        s.messages[tempId] = {
          id: tempId,
          conversationId,
          role: 'user',
          agentId: null,
          parts,
          status: 'complete',
          parentMessageId: parentMessageId ?? null,
          mentionedAgentIds,
          runId: null,
          createdAt: Date.now(),
        }
        s.messageIdsByConv[conversationId] ??= []
        s.messageIdsByConv[conversationId].push(tempId)
      }),

    replaceLocalMessageId: (tempId, realId) =>
      set((s) => {
        const msg = s.messages[tempId]
        if (!msg) return
        s.messages[realId] = { ...msg, id: realId }
        delete s.messages[tempId]
        for (const convId in s.messageIdsByConv) {
          const arr = s.messageIdsByConv[convId]
          const idx = arr.indexOf(tempId)
          if (idx >= 0) arr[idx] = realId
        }
      }),

    applyEvent: (event) =>
      set((s) => {
        switch (event.type) {
          case 'heartbeat':
            return

          case 'run.start': {
            s.runsByConv[event.conversationId] ??= {}
            s.runsByConv[event.conversationId][event.runId] = {
              id: event.runId,
              conversationId: event.conversationId,
              agentId: event.agentId,
              triggerMessageId: event.triggerMessageId,
              status: 'running',
              error: null,
              parentRunId: event.parentRunId ?? null,
              startedAt: event.timestamp,
              finishedAt: null,
            }
            return
          }

          case 'run.end': {
            const run = s.runsByConv[event.conversationId]?.[event.runId]
            if (run) {
              run.status = event.status
              run.finishedAt = event.timestamp
              run.error = event.error ?? null
            }
            return
          }

          case 'message.start': {
            // 新 agent 消息（DB 端也插入了同 id 的行，前端再次接到是 idempotent）
            s.messages[event.messageId] = {
              id: event.messageId,
              conversationId: event.conversationId,
              role: 'agent',
              agentId: event.agentId,
              parts: [],
              status: 'streaming',
              parentMessageId: null,
              mentionedAgentIds: [],
              runId: event.runId,
              createdAt: event.timestamp,
            }
            s.messageIdsByConv[event.conversationId] ??= []
            if (!s.messageIdsByConv[event.conversationId].includes(event.messageId)) {
              s.messageIdsByConv[event.conversationId].push(event.messageId)
            }
            return
          }

          case 'message.end': {
            const msg = s.messages[event.messageId]
            if (msg) msg.status = 'complete'
            return
          }

          case 'part.start': {
            const msg = s.messages[event.messageId]
            if (!msg) return
            msg.parts[event.partIndex] = event.part
            return
          }

          case 'part.delta': {
            const msg = s.messages[event.messageId]
            if (!msg) return
            const part = msg.parts[event.partIndex]
            if (!part) return
            if (event.delta.type === 'text.append' && part.type === 'text') {
              part.content += event.delta.text
            } else if (event.delta.type === 'thinking.append' && part.type === 'thinking') {
              part.content += event.delta.text
            } else if (event.delta.type === 'code.append' && part.type === 'code') {
              part.content += event.delta.text
            }
            return
          }

          case 'part.end':
            return

          case 'tool.call': {
            const msg = s.messages[event.messageId]
            if (!msg) return
            msg.parts.push({
              type: 'tool_use',
              callId: event.callId,
              toolName: event.toolName,
              args: event.args,
            })
            return
          }

          case 'tool.result': {
            const msg = s.messages[event.messageId]
            if (!msg) return
            msg.parts.push({
              type: 'tool_result',
              callId: event.callId,
              result: event.result,
              isError: event.isError,
            })
            return
          }

          case 'artifact.create': {
            const a = event.artifact
            s.artifacts[a.id] = {
              ...a,
              parentArtifactId: a.parentArtifactId ?? null,
            }
            return
          }

          case 'artifact.update': {
            const art = s.artifacts[event.artifactId]
            if (!art) return
            art.content = { ...art.content, ...(event.patch as object) } as typeof art.content
            return
          }

          case 'dispatch.plan': {
            // 找该 runId 当前最新的 agent message，作为卡片挂载点
            let attachMsgId = ''
            let attachCreated = -1
            for (const m of Object.values(s.messages)) {
              if (m.runId === event.runId && m.role === 'agent' && m.createdAt > attachCreated) {
                attachMsgId = m.id
                attachCreated = m.createdAt
              }
            }
            const status: DispatchState['taskStatus'] = {}
            for (const t of event.plan) status[t.id] = 'pending'
            s.dispatchesByRunId[event.runId] = {
              runId: event.runId,
              messageId: attachMsgId,
              plan: event.plan,
              taskStatus: status,
              childRunIds: {},
            }
            return
          }

          case 'dispatch.start': {
            const d = s.dispatchesByRunId[event.parentRunId]
            if (!d) return
            d.taskStatus[event.taskId] = 'running'
            d.childRunIds[event.taskId] = event.childRunId
            return
          }

          case 'dispatch.end': {
            // dispatch.end 没有 parentRunId，得通过 childRunId 反查
            for (const d of Object.values(s.dispatchesByRunId)) {
              if (d.childRunIds[event.taskId] === event.childRunId) {
                d.taskStatus[event.taskId] = event.status
                return
              }
            }
            return
          }

          default:
            return
        }
      }),
  })),
)

// ─── 派生 hooks ──────────────────────────────────────
// 用 useShallow 防止派生数组每次新引用导致无限渲染（Zustand 5 标准做法）。
import { useShallow } from 'zustand/react/shallow'

export const useMessagesForConversation = (conversationId: string) =>
  useAppStore(
    useShallow((s) =>
      (s.messageIdsByConv[conversationId] ?? []).map((id) => s.messages[id]).filter(Boolean),
    ),
  )

export const useActiveConversation = () =>
  useAppStore((s) => (s.activeConversationId ? s.conversations[s.activeConversationId] : null))

export const useConversationList = () =>
  useAppStore(
    useShallow((s) =>
      Object.values(s.conversations).sort((a, b) => b.updatedAt - a.updatedAt),
    ),
  )

export const useAgentList = () => useAppStore(useShallow((s) => Object.values(s.agents)))

export const usePendingAttachments = (conversationId: string) =>
  useAppStore(useShallow((s) => s.pendingAttachmentsByConv[conversationId] ?? []))

/** 当前会话中正在跑的顶层 run（parentRunId 为空的，用于「中止」按钮）。 */
export const useTopLevelRunningRuns = (conversationId: string) =>
  useAppStore(
    useShallow((s) => {
      const runs = s.runsByConv[conversationId]
      if (!runs) return []
      return Object.values(runs).filter((r) => r.status === 'running' && !r.parentRunId)
    }),
  )

export const useDispatchForMessage = (messageId: string) =>
  useAppStore((s) => {
    for (const id in s.dispatchesByRunId) {
      const d = s.dispatchesByRunId[id]
      if (d.messageId === messageId) return d
    }
    return null
  })

/** 返回该会话最后一条 user 消息的 id（用于撤回 / 编辑入口判断）。 */
export const useLatestUserMessageId = (conversationId: string): string | null =>
  useAppStore((s) => {
    const ids = s.messageIdsByConv[conversationId]
    if (!ids) return null
    for (let i = ids.length - 1; i >= 0; i--) {
      const m = s.messages[ids[i]]
      if (m && m.role === 'user') return m.id
    }
    return null
  })
