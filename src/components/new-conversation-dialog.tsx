'use client'

import { useState } from 'react'

import { AgentAvatar } from '@/components/agent-avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createConversation } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAgentList, useAppStore } from '@/stores/app-store'

export function NewConversationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const agents = useAgentList()
  const upsertConversation = useAppStore((s) => s.upsertConversation)
  const setActive = useAppStore((s) => s.setActiveConversation)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  const mode: 'single' | 'group' = selected.size > 1 ? 'group' : 'single'

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (selected.size === 0 || creating) return
    setCreating(true)
    try {
      const conv = await createConversation({
        mode,
        agentIds: Array.from(selected),
      })
      upsertConversation(conv)
      setActive(conv.id)
      setSelected(new Set())
      onOpenChange(false)
    } catch (err) {
      console.error('[NewConversationDialog] create failed', err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建对话</DialogTitle>
          <DialogDescription>
            选择 1 个 Agent 创建单聊，选择 2 个或更多创建群聊
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {agents.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              暂无可用 Agent
              <div className="mt-1 text-xs">运行 pnpm db:seed 创建内置 Agent</div>
            </div>
          ) : (
            agents.map((a) => {
              const isSelected = selected.has(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-foreground/30',
                    isSelected && 'border-primary bg-primary/5',
                  )}
                >
                  <AgentAvatar agent={a} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {a.adapterName}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {a.description}
                    </p>
                  </div>
                </button>
              )
            })
          )}
        </div>

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            已选 {selected.size} 位 · 将创建{mode === 'single' ? '单聊' : '群聊'}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={selected.size === 0 || creating}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
