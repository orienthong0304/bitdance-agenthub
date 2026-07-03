'use client'

import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { createBoardTask, deleteBoardTask, fetchBoardTasks, updateBoardTask } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { BoardTask, BoardTaskSource, BoardTaskStatus } from '@/shared/types'
import { useAppStore } from '@/stores/app-store'

const STATUS_GROUPS: Array<{ status: BoardTaskStatus; label: string }> = [
  { status: 'in_progress', label: '进行中' },
  { status: 'open', label: '待办' },
  { status: 'blocked', label: '受阻' },
  { status: 'done', label: '已完成' },
]

const STATUS_LABEL: Record<BoardTaskStatus, string> = {
  open: '待办',
  in_progress: '进行中',
  done: '已完成',
  blocked: '受阻',
}

const SOURCE_LABEL: Record<BoardTaskSource, string> = {
  manual: '手动',
  dispatch: '调度',
  agent: 'Agent',
}

/**
 * TaskBoardPanel — 「任务」二级面板（跨会话任务看板，Sidebar mode='tasks' 时渲染）。
 *
 * 挂载时 fetch 全量任务存进 zustand `boardTasks` 切片（v1 无 StreamEvent 实时同步，
 * IconRail badge 也从这个切片读，因此 badge 只在面板打开过一次之后才准确）。
 */
export function TaskBoardPanel() {
  const tasks = useAppStore((s) => s.boardTasks)
  const setBoardTasks = useAppStore((s) => s.setBoardTasks)
  const upsertBoardTask = useAppStore((s) => s.upsertBoardTask)
  const removeBoardTask = useAppStore((s) => s.removeBoardTask)
  const setActiveConversation = useAppStore((s) => s.setActiveConversation)

  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchBoardTasks()
      .then((list) => {
        if (!cancelled) setBoardTasks(list)
      })
      .catch((err) => console.error('[TaskBoardPanel] load failed', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [setBoardTasks])

  const grouped = useMemo(
    () =>
      STATUS_GROUPS.map((group) => ({
        ...group,
        tasks: tasks.filter((t) => t.status === group.status).sort((a, b) => b.updatedAt - a.updatedAt),
      })),
    [tasks],
  )

  const handleCreate = async () => {
    const title = draft.trim()
    if (!title || creating) return
    setCreating(true)
    try {
      const task = await createBoardTask({ title })
      upsertBoardTask(task)
      setDraft('')
    } catch (err) {
      console.error('[TaskBoardPanel] create failed', err)
    } finally {
      setCreating(false)
    }
  }

  const handleStatusChange = async (task: BoardTask, status: BoardTaskStatus) => {
    if (status === task.status) return
    try {
      const updated = await updateBoardTask(task.id, { status })
      upsertBoardTask(updated)
    } catch (err) {
      console.error('[TaskBoardPanel] status change failed', err)
    }
  }

  const handleDelete = async (task: BoardTask) => {
    try {
      await deleteBoardTask(task.id)
      removeBoardTask(task.id)
    } catch (err) {
      console.error('[TaskBoardPanel] delete failed', err)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between px-4 pb-2.5 pt-4">
        <div className="text-base font-bold tracking-tight">任务</div>
      </div>

      <div className="shrink-0 px-4 pb-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate()
          }}
          placeholder="+ 新任务"
          disabled={creating}
          className="h-9 w-full rounded-lg border bg-sidebar px-2.5 text-[13px] outline-none transition focus:border-foreground/30"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-2 pb-3">
          {!loading && tasks.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              还没有任务 — 在看板建一个，或让 Agent 用 create_task 立单
            </div>
          ) : (
            grouped.map((group) =>
              group.tasks.length === 0 ? null : (
                <div key={group.status}>
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.label} · {group.tasks.length}
                  </div>
                  <div className="space-y-0.5">
                    {group.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onActivate={() => task.conversationId && setActiveConversation(task.conversationId)}
                        onStatusChange={(status) => void handleStatusChange(task, status)}
                        onDelete={() => void handleDelete(task)}
                      />
                    ))}
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function TaskRow({
  task,
  onActivate,
  onStatusChange,
  onDelete,
}: {
  task: BoardTask
  onActivate: () => void
  onStatusChange: (status: BoardTaskStatus) => void
  onDelete: () => void
}) {
  return (
    <div
      title={task.title}
      className="group relative flex items-center gap-2 rounded-lg px-2.5 py-2 transition hover:bg-accent"
    >
      <button
        type="button"
        onClick={onActivate}
        disabled={!task.conversationId}
        className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-default"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold">{task.title}</span>
          <span
            className={cn(
              'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium',
              task.source === 'agent' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            {SOURCE_LABEL[task.source]}
          </span>
        </div>
        {task.note && (
          <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{task.note}</div>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <select
          value={task.status}
          onChange={(e) => onStatusChange(e.target.value as BoardTaskStatus)}
          onClick={(e) => e.stopPropagation()}
          title="切换状态"
          aria-label={`「${task.title}」状态`}
          className="h-6 rounded border bg-background px-1 text-[10px] outline-none"
        >
          {Object.entries(STATUS_LABEL).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title="删除任务"
          className="text-muted-foreground transition hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
