'use client'

import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AgentLibrary } from '@/components/agent-library'
import { AgentAvatar } from '@/components/agent-avatar'
import { GlobalSearchTrigger } from '@/components/global-search-trigger'
import { ArtifactLibrary } from '@/components/artifact-library'
import { IconRail, type RailMode } from '@/components/icon-rail'
import { NewConversationDialog } from '@/components/new-conversation-dialog'
import { UsageDashboard } from '@/components/usage-dashboard'
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
import {
  deleteConversation as deleteConversationAPI,
  fetchAgents,
  fetchConversations,
  renameConversation as renameConversationAPI,
  toggleArchiveConversation as toggleArchiveConversationAPI,
  togglePinConversation as togglePinConversationAPI,
} from '@/lib/api'
import { subscribeUiCommand } from '@/lib/ui-command-events'
import { cn } from '@/lib/utils'
import type { AgentRow, ConversationRow } from '@/db/schema'
import { useAppStore, useConversationList, useUnreadCount } from '@/stores/app-store'

type Mode = RailMode

export function Sidebar() {
  const mobileOpen = useAppStore((s) => s.mobileSidebarOpen)
  const setMobileSidebarOpen = useAppStore((s) => s.setMobileSidebarOpen)
  const conversations = useConversationList()
  const activeId = useAppStore((s) => s.activeConversationId)
  const setActive = useAppStore((s) => s.setActiveConversation)
  const setConversations = useAppStore((s) => s.setConversations)
  const setAgents = useAppStore((s) => s.setAgents)
  const agents = useAppStore((s) => s.agents)
  const removeConversation = useAppStore((s) => s.removeConversation)
  const upsertConversation = useAppStore((s) => s.upsertConversation)

  const [mode, setMode] = useState<Mode>('conversations')
  const [dialogOpen, setDialogOpen] = useState(false)
  // 点击当前导航折叠/展开二级面板（rail 常驻，等价旧「收起侧边栏」）
  const [panelHidden, setPanelHidden] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const activeConversations = useMemo(
    () => conversations.filter((c) => !c.archived),
    [conversations],
  )
  const archivedConversations = useMemo(
    () => conversations.filter((c) => c.archived),
    [conversations],
  )

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return activeConversations
    return activeConversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [activeConversations, search])

  const pinnedConversations = useMemo(
    () => filteredConversations.filter((c) => c.pinnedAt),
    [filteredConversations],
  )
  const recentConversations = useMemo(
    () => filteredConversations.filter((c) => !c.pinnedAt),
    [filteredConversations],
  )

  const handleRailSelect = (next: Mode) => {
    if (next === mode) {
      setPanelHidden((v) => !v)
    } else {
      setMode(next)
      setPanelHidden(false)
    }
  }

  const handleTogglePin = async (convId: string) => {
    try {
      const updated = await togglePinConversationAPI(convId)
      upsertConversation(updated)
    } catch (err) {
      console.error('[Sidebar] toggle pin failed', err)
    }
  }

  const handleToggleArchive = async (convId: string) => {
    try {
      const updated = await toggleArchiveConversationAPI(convId)
      upsertConversation(updated)
    } catch (err) {
      console.error('[Sidebar] toggle archive failed', err)
    }
  }

  const finishRename = async (convId: string, currentTitle: string, next: string) => {
    const trimmed = next.trim()
    setRenamingId(null)
    if (!trimmed || trimmed === currentTitle) return
    try {
      const updated = await renameConversationAPI(convId, trimmed)
      upsertConversation(updated)
    } catch (err) {
      console.error('[Sidebar] rename failed', err)
    }
  }

  useEffect(() => {
    fetchConversations().then(setConversations).catch(console.error)
    fetchAgents().then(setAgents).catch(console.error)
  }, [setConversations, setAgents])

  useEffect(() => {
    return subscribeUiCommand((command) => {
      if (command !== 'open-agents') return
      setPanelHidden(false)
      setMode('agents')
      if (window.matchMedia('(max-width: 767px)').matches) {
        setMobileSidebarOpen(true)
      }
    })
  }, [setMobileSidebarOpen])

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
    <>
      {/* 移动端遮罩 —— sidebar 抽屉打开时点击关闭 */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <aside
        className={cn(
          'flex shrink-0 overflow-hidden border-r bg-card',
          // 移动端：固定定位抽屉，默认 -translate-x-full 隐藏；打开时滑入
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:transition-transform max-md:duration-200',
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
        )}
      >
      <IconRail mode={mode} onSelect={handleRailSelect} />

      {!panelHidden && (
      <div className="flex w-[262px] shrink-0 flex-col overflow-hidden bg-card">
      {/* 内容区按 mode 分发 */}
      {mode === 'conversations' ? (
        <>
          {/* 面板头：标题 + 新建按钮 */}
          <div className="flex shrink-0 items-center justify-between px-4 pb-2.5 pt-4">
            <div className="text-base font-bold tracking-tight">会话</div>
            <Button
              size="icon"
              variant="outline"
              className="size-[30px] rounded-[7px]"
              onClick={() => setDialogOpen(true)}
              title="新建对话"
              aria-label="新建对话"
            >
              <Plus className="size-4" />
            </Button>
          </div>

          {/* Search box */}
          {activeConversations.length > 0 && (
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索会话…"
                  className="h-9 w-full rounded-lg border bg-sidebar pl-8 pr-7 text-[13px] outline-none transition focus:border-foreground/30"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="清除"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <GlobalSearchTrigger />
            </div>
          )}

          {/* Conversation list：置顶 / 最近分组 */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-0.5 px-2 pb-3">
              {filteredConversations.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {search.trim() ? `没有匹配「${search.trim()}」的会话` : '没有会话'}
                </div>
              ) : (
                <>
                  {pinnedConversations.length > 0 && (
                    <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      置顶
                    </div>
                  )}
                  {pinnedConversations.map((c) => (
                    <ConversationItem
                      key={c.id}
                      conversation={c}
                      firstAgent={c.agentIds[0] ? agents[c.agentIds[0]] : null}
                      isActive={activeId === c.id}
                      isRenaming={renamingId === c.id}
                      onActivate={() => setActive(c.id)}
                      onTogglePin={() => void handleTogglePin(c.id)}
                      onToggleArchive={() => void handleToggleArchive(c.id)}
                      onStartRename={() => setRenamingId(c.id)}
                      onFinishRename={(next) => void finishRename(c.id, c.title, next)}
                      onRequestDelete={() => setDeleteTargetId(c.id)}
                    />
                  ))}
                  {recentConversations.length > 0 && (
                    <div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      最近
                    </div>
                  )}
                  {recentConversations.map((c) => (
                    <ConversationItem
                      key={c.id}
                      conversation={c}
                      firstAgent={c.agentIds[0] ? agents[c.agentIds[0]] : null}
                      isActive={activeId === c.id}
                      isRenaming={renamingId === c.id}
                      onActivate={() => setActive(c.id)}
                      onTogglePin={() => void handleTogglePin(c.id)}
                      onToggleArchive={() => void handleToggleArchive(c.id)}
                      onStartRename={() => setRenamingId(c.id)}
                      onFinishRename={(next) => void finishRename(c.id, c.title, next)}
                      onRequestDelete={() => setDeleteTargetId(c.id)}
                    />
                  ))}
                </>
              )}
            </div>

            {/* 已归档区：可折叠，展开后每项可取消归档 */}
            {archivedConversations.length > 0 && (
              <div className="border-t p-2">
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  {showArchived ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  <Archive className="size-3.5" />
                  <span>已归档</span>
                  <span className="ml-auto tabular-nums">{archivedConversations.length}</span>
                </button>
                {showArchived && (
                  <div className="mt-1 space-y-1">
                    {archivedConversations.map((c) => {
                      const firstAgent = c.agentIds[0] ? agents[c.agentIds[0]] : null
                      return (
                        <ConversationItem
                          key={c.id}
                          conversation={c}
                          firstAgent={firstAgent}
                          isActive={activeId === c.id}
                          isRenaming={renamingId === c.id}
                          isArchived
                          onActivate={() => setActive(c.id)}
                          onTogglePin={() => void handleTogglePin(c.id)}
                          onToggleArchive={() => void handleToggleArchive(c.id)}
                          onStartRename={() => setRenamingId(c.id)}
                          onFinishRename={(next) => void finishRename(c.id, c.title, next)}
                          onRequestDelete={() => setDeleteTargetId(c.id)}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </>
      ) : mode === 'artifacts' ? (
        <ArtifactLibrary />
      ) : mode === 'agents' ? (
        <AgentLibrary />
      ) : (
        <UsageDashboard />
      )}
      </div>
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
    </>
  )
}

function ConversationItem({
  conversation,
  firstAgent,
  isActive,
  isRenaming,
  isArchived = false,
  onActivate,
  onTogglePin,
  onToggleArchive,
  onStartRename,
  onFinishRename,
  onRequestDelete,
}: {
  conversation: ConversationRow
  firstAgent: AgentRow | null
  isActive: boolean
  isRenaming: boolean
  isArchived?: boolean
  onActivate: () => void
  onTogglePin: () => void
  onToggleArchive: () => void
  onStartRename: () => void
  onFinishRename: (next: string) => void | Promise<void>
  onRequestDelete: () => void
}) {
  const isPinned = !!conversation.pinnedAt
  const unread = useUnreadCount(conversation.id)
  return (
    <div
      className={cn(
        'group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-accent',
        isActive && 'bg-accent',
      )}
    >
      {isActive && (
        <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-[3px] bg-primary" />
      )}
      <button
        type="button"
        onClick={onActivate}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        disabled={isRenaming}
      >
        <div className="relative">
          {firstAgent ? (
            <AgentAvatar agent={firstAgent} size="lg" />
          ) : (
            <Avatar className="size-9 shrink-0">
              <AvatarFallback className="text-sm">?</AvatarFallback>
            </Avatar>
          )}
          {unread > 0 && !isActive && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <RenameInput
              key={conversation.id}
              initial={conversation.title}
              onCommit={(next) => onFinishRename(next)}
              onCancel={() => onFinishRename(conversation.title)}
            />
          ) : (
            <div className="flex items-center gap-1">
              {isPinned && <Pin className="size-3 shrink-0 fill-amber-400 text-amber-500" />}
              <div className="truncate text-[13px] font-semibold">{conversation.title}</div>
            </div>
          )}
          <div className="truncate text-xs text-muted-foreground">
            {conversation.mode === 'single' ? '单聊' : '群聊'} · {conversation.agentIds.length} 位 Agent
          </div>
        </div>
      </button>
      {!isRenaming && (
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin()
            }}
            title={isPinned ? '取消置顶' : '置顶'}
            className={cn(
              'transition-colors',
              isPinned ? 'text-amber-500 hover:text-amber-600' : 'hover:text-amber-500',
            )}
          >
            {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleArchive()
            }}
            title={isArchived ? '取消归档' : '归档'}
            className="transition-colors hover:text-sky-500"
          >
            {isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onStartRename()
            }}
            title="重命名"
            className="transition-colors hover:text-primary"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRequestDelete()
            }}
            title="删除会话"
            className="transition-colors hover:text-red-600"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (next: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(draft)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      maxLength={100}
      className="w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm font-medium outline-none ring-2 ring-primary/30"
    />
  )
}

