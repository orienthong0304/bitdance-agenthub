'use client'

import { AgentAvatar } from '@/components/agent-avatar'
import { cn } from '@/lib/utils'
import type { SearchHit } from '@/shared/types'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString()
}

export interface SearchResultItemProps {
  hit: SearchHit
  active: boolean
  onClick: () => void
}

export function SearchResultItem({ hit, active, onClick }: SearchResultItemProps) {
  return (
    <li
      role="option"
      aria-selected={active}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md px-3 py-2',
        active && 'bg-accent text-accent-foreground',
      )}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
    >
      {hit.agentId ? (
        <AgentAvatar
          agent={{ id: hit.agentId, name: hit.agentName ?? 'Agent' }}
          size="md"
        />
      ) : (
        <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs">U</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate font-medium text-foreground">{hit.conversationTitle}</span>
          <span>·</span>
          <span>{hit.role === 'user' ? 'You' : hit.agentName ?? 'Agent'}</span>
          <span>·</span>
          <span>{formatTime(hit.createdAt)}</span>
        </div>
        <p
          className="mt-0.5 line-clamp-2 text-sm"
          // Safe: snippetHtml is from user's own message content (server-generated);
          // <mark> tags are produced by FTS5 snippet() with controlled delimiters.
          dangerouslySetInnerHTML={{ __html: hit.snippetHtml }}
        />
      </div>
    </li>
  )
}