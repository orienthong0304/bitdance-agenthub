'use client'

import { Loader2 } from 'lucide-react'

import { DispatchPlanCard } from '@/components/dispatch-plan-card'
import { PartList } from '@/components/message-parts'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { MessageRow } from '@/db/schema'
import { useAppStore, useDispatchForMessage } from '@/stores/app-store'

export function MessageItem({ message }: { message: MessageRow }) {
  const agent = useAppStore((s) => (message.agentId ? s.agents[message.agentId] : null))
  const dispatch = useDispatchForMessage(message.id)

  const isUser = message.role === 'user'
  const name = isUser ? '我' : agent?.name ?? 'Unknown'
  const avatar = isUser ? '我' : agent?.avatar ?? '?'

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <Avatar className={cn('size-8 shrink-0', isUser && 'bg-primary text-primary-foreground')}>
        <AvatarFallback className={cn('text-sm', isUser && 'bg-primary text-primary-foreground')}>
          {avatar}
        </AvatarFallback>
      </Avatar>

      <div className={cn('flex max-w-[80%] min-w-0 flex-1 flex-col gap-1', isUser && 'items-end')}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{name}</span>
          <span>{formatTime(message.createdAt)}</span>
          {message.status === 'streaming' && (
            <Loader2 className="size-3 animate-spin text-muted-foreground/70" />
          )}
        </div>

        <div
          className={cn(
            'min-w-0 rounded-lg border bg-card px-3 py-2',
            isUser && 'bg-primary/5 border-primary/20',
          )}
        >
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
