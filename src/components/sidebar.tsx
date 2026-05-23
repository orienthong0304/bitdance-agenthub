'use client'

import { Layers, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ArtifactLibrary } from '@/components/artifact-library'
import { NewConversationDialog } from '@/components/new-conversation-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { deleteConversation as deleteConversationAPI, fetchAgents, fetchConversations } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore, useConversationList } from '@/stores/app-store'

type Mode = 'conversations' | 'artifacts'

export function Sidebar() {
  const conversations = useConversationList()
  const activeId = useAppStore((s) => s.activeConversationId)
  const setActive = useAppStore((s) => s.setActiveConversation)
  const setConversations = useAppStore((s) => s.setConversations)
  const setAgents = useAppStore((s) => s.setAgents)
  const agents = useAppStore((s) => s.agents)
  const removeConversation = useAppStore((s) => s.removeConversation)

  const [mode, setMode] = useState<Mode>('conversations')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchConversations().then(setConversations).catch(console.error)
    fetchAgents().then(setAgents).catch(console.error)
  }, [setConversations, setAgents])

  const deleteTarget = deleteTargetId ? conversations.find((c) => c.id === deleteTargetId) : null

  const confirmDelete = async () => {
    if (!deleteTargetId) return
    setDeleting(true)
    try {
      await deleteConversationAPI(deleteTargetId)
      removeConversation(deleteTargetId)
      setDeleteTargetId(null)
    } catch (err) {
      console.error('[Sidebar] delete failed', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-r bg-card transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-72',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex shrink-0 items-center border-b',
          collapsed ? 'justify-center px-1 py-3' : 'justify-between px-4 py-3',
        )}
      >
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">AgentHub</h1>
            <p className="truncate text-xs text-muted-foreground">多 Agent 协作平台</p>
          </div>
        )}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>

      {/* Tab 切换 */}
      <div
        className={cn(
          'shrink-0 border-b',
          collapsed ? 'flex flex-col items-center gap-1 px-1 py-2' : 'flex gap-1 px-3 py-2',
        )}
      >
        <TabButton
          mode={mode}
          self="conversations"
          collapsed={collapsed}
          onClick={() => setMode('conversations')}
          icon={<MessageSquare className="size-4" />}
          label="对话"
        />
        <TabButton
          mode={mode}
          self="artifacts"
          collapsed={collapsed}
          onClick={() => setMode('artifacts')}
          icon={<Layers className="size-4" />}
          label="产物库"
        />
      </div>

      {/* 内容区按 mode 分发 */}
      {mode === 'conversations' ? (
        <>
          {/* New conversation button */}
          <div className={cn('shrink-0', collapsed ? 'flex justify-center py-2' : 'px-3 pt-3')}>
            {collapsed ? (
              <Button
                size="icon"
                variant="outline"
                onClick={() => setDialogOpen(true)}
                title="新建对话"
              >
                <Plus className="size-4" />
              </Button>
            ) : (
              <Button
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="size-4" />
                新建对话
              </Button>
            )}
          </div>

          {/* Conversation list */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-2">
              {conversations.length === 0
                ? !collapsed && (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                      没有会话
                    </div>
                  )
                : conversations.map((c) => {
                    const firstAgent = c.agentIds[0] ? agents[c.agentIds[0]] : null
                    const isActive = activeId === c.id

                    if (collapsed) {
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setActive(c.id)}
                          title={c.title}
                          className={cn(
                            'flex w-full justify-center rounded-md p-1.5 transition hover:bg-accent',
                            isActive && 'bg-accent ring-2 ring-primary/50',
                          )}
                        >
                          <Avatar className="size-8">
                            <AvatarFallback className="text-sm">
                              {firstAgent?.avatar ?? '?'}
                            </AvatarFallback>
                          </Avatar>
                        </button>
                      )
                    }

                    return (
                      <div
                        key={c.id}
                        className={cn(
                          'group flex w-full items-center gap-3 rounded-md px-2 py-2 transition hover:bg-accent',
                          isActive && 'bg-accent',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setActive(c.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <Avatar className="size-9 shrink-0">
                            <AvatarFallback className="text-sm">
                              {firstAgent?.avatar ?? '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{c.title}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {c.mode === 'single' ? '单聊' : '群聊'} · {c.agentIds.length} 位 Agent
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTargetId(c.id)
                          }}
                          title="删除会话"
                          className="opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    )
                  })}
            </div>
          </ScrollArea>
        </>
      ) : (
        // 产物库
        !collapsed && <ArtifactLibrary />
      )}

      <NewConversationDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <Dialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.title}」吗？该会话的所有消息、产物和工作区都会一并清除，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>
              取消
            </Button>
            <Button
              variant="default"
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? '删除中...' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

function TabButton({
  mode,
  self,
  collapsed,
  onClick,
  icon,
  label,
}: {
  mode: Mode
  self: Mode
  collapsed: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  const active = mode === self
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={cn(
          'flex size-9 items-center justify-center rounded-md transition',
          active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
        )}
      >
        {icon}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
