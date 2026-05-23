'use client'

import { AtSign, CornerUpLeft, Loader2 } from 'lucide-react'

import { AgentAvatar } from '@/components/agent-avatar'
import { DispatchPlanCard } from '@/components/dispatch-plan-card'
import { PartList } from '@/components/message-parts'
import { QuotedMessage } from '@/components/quoted-message'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { MessageRow } from '@/db/schema'
import { useAppStore, useDispatchForMessage } from '@/stores/app-store'

export function MessageItem({ message }: { message: MessageRow }) {
  const agentsMap = useAppStore((s) => s.agents)
  const agent = message.agentId ? agentsMap[message.agentId] : null
  const dispatch = useDispatchForMessage(message.id)
  const setReplyTarget = useAppStore((s) => s.setReplyTarget)
  const highlightMessage = useAppStore((s) => s.highlightMessage)
  const isHighlighted = useAppStore((s) => s.highlightedMessageId === message.id)
  const parentMessage = useAppStore((s) =>
    message.parentMessageId ? s.messages[message.parentMessageId] : null,
  )

  const isUser = message.role === 'user'
  const name = isUser ? '我' : agent?.name ?? 'Unknown'

  const mentionedAgents = message.mentionedAgentIds
    .map((id) => agentsMap[id])
    .filter(Boolean)

  const jumpToParent = () => {
    if (!parentMessage) return
    const el = document.getElementById(`message-${parentMessage.id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    highlightMessage(parentMessage.id)
  }

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        'group flex gap-3 rounded-lg transition-shadow duration-300 animate-in fade-in slide-in-from-bottom-1',
        isUser && 'flex-row-reverse',
        isHighlighted && 'ring-2 ring-primary ring-offset-2',
      )}
    >
      {isUser ? (
        <Avatar className="size-8 shrink-0 bg-primary text-primary-foreground">
          <AvatarFallback className="bg-primary text-sm text-primary-foreground">
            我
          </AvatarFallback>
        </Avatar>
      ) : agent ? (
        <AgentAvatar
          agent={agent}
          size="md"
          className={cn(
            'transition-all',
            message.status === 'streaming' && 'ring-2 ring-primary ring-offset-1',
          )}
        />
      ) : (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="text-sm">?</AvatarFallback>
        </Avatar>
      )}

      <div className={cn('flex max-w-[80%] min-w-0 flex-1 flex-col gap-1', isUser && 'items-end')}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{name}</span>
          <span>{formatTime(message.createdAt)}</span>
          {message.status === 'streaming' && (
            <Loader2 className="size-3 animate-spin text-muted-foreground/70" />
          )}
          {/* 引用按钮 — hover 时显示 */}
          <button
            type="button"
            onClick={() => setReplyTarget(message.conversationId, message.id)}
            className="opacity-0 transition group-hover:opacity-100 hover:text-foreground"
            title="引用回复"
          >
            <CornerUpLeft className="size-3" />
          </button>
        </div>

        <div
          className={cn(
            'min-w-0 rounded-lg border bg-card px-3 py-2',
            isUser && 'bg-primary/5 border-primary/20',
            message.status === 'error' && 'border-red-300 bg-red-50/40 dark:border-red-900/50 dark:bg-red-950/20',
            message.status === 'aborted' && 'border-zinc-300 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-900/40',
          )}
        >
          {/* 被引用消息预览，点击跳转到原消息 */}
          {parentMessage && (
            <div className="mb-2">
              <QuotedMessage
                message={parentMessage}
                variant="preview"
                onClick={jumpToParent}
              />
            </div>
          )}

          {/* @ 提及指示 */}
          {mentionedAgents.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-border/50 pb-2">
              <AtSign className="size-3 text-muted-foreground" />
              {mentionedAgents.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-1 pr-1.5 text-[10px] text-primary"
                >
                  <AgentAvatar agent={a} size="xs" />
                  <span>{a.name}</span>
                </span>
              ))}
            </div>
          )}

          <PartList parts={message.parts} />
          {dispatch && (
            <div className="mt-3">
              <DispatchPlanCard dispatch={dispatch} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
