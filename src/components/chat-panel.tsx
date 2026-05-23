'use client'

import { UserPlus } from 'lucide-react'
import { useState } from 'react'

import { AddAgentDialog } from '@/components/add-agent-dialog'
import { AgentAvatar } from '@/components/agent-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MessageInput } from '@/components/message-input'
import { MessageList } from '@/components/message-list'
import { useActiveConversation, useAppStore } from '@/stores/app-store'

export function ChatPanel() {
  const conv = useActiveConversation()
  const agents = useAppStore((s) => s.agents)
  const streamConnected = useAppStore((s) => s.streamConnected)
  const [addOpen, setAddOpen] = useState(false)

  if (!conv) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center bg-background">
        <div className="space-y-3 text-center text-muted-foreground">
          <div className="text-5xl">💬</div>
          <div className="text-sm">选择左侧会话开始聊天，或新建一个</div>
        </div>
      </main>
    )
  }

  const participantAgents = conv.agentIds.map((id) => agents[id]).filter(Boolean)

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 -space-x-2">
            {participantAgents.map((a) => (
              <AgentAvatar key={a.id} agent={a} size="md" className="border-2 border-background" />
            ))}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{conv.title}</div>
            <div className="text-xs text-muted-foreground">
              {conv.mode === 'single' ? '单聊' : '群聊'} · {participantAgents.length} 位 Agent
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setAddOpen(true)}
            title="添加 Agent"
          >
            <UserPlus className="size-4" />
          </Button>
          <Badge variant={streamConnected ? 'default' : 'outline'} className="gap-1.5">
            <span
              className={`size-1.5 rounded-full ${streamConnected ? 'bg-green-500' : 'bg-zinc-400'}`}
            />
            {streamConnected ? '已连接' : '断开'}
          </Badge>
        </div>
      </header>

      <MessageList conversationId={conv.id} />
      <MessageInput conversationId={conv.id} />

      <AddAgentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        conversationId={conv.id}
        existingAgentIds={conv.agentIds}
      />
    </main>
  )
}
