'use client'

import { BarChart3, Layers, LifeBuoy, ListTodo, MessageSquare, Users } from 'lucide-react'

import { SettingsButton } from '@/components/settings-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'
import { useAppStore, type RailMode } from '@/stores/app-store'

/**
 * IconRail — 应用左缘 56px 图标导航栏（redesign-ui-shell Phase B）。
 *
 * logo + 五个导航（会话带未读 badge，任务带 open+blocked badge）+ 底部主题/设置/用户位。
 * 点击当前导航可折叠/展开二级列表面板（onSelect 由 Sidebar 处理）。
 */
export function IconRail({
  mode,
  panelHidden,
  onSelect,
}: {
  mode: RailMode
  /** 二级面板是否处于折叠态（当前导航按钮以 aria-expanded 暴露该语义） */
  panelHidden: boolean
  onSelect: (mode: RailMode) => void
}) {
  const unreadTotal = useAppStore((s) =>
    Object.values(s.unreadByConv).reduce((sum, n) => sum + n, 0),
  )
  // badge 反映 store 内任务：挂载时 fetch 全量 + task.update StreamEvent 增量实时同步
  const taskBadge = useAppStore((s) =>
    s.boardTasks.reduce((sum, t) => sum + (t.status === 'open' || t.status === 'blocked' ? 1 : 0), 0),
  )

  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-3">
      <div
        className="mb-2 flex size-[34px] items-center justify-center rounded-[9px] bg-primary shadow-sm"
        title="AgentHub"
      >
        <LifeBuoy className="size-5 text-primary-foreground" />
      </div>

      <RailButton
        active={mode === 'conversations'}
        panelHidden={panelHidden}
        onClick={() => onSelect('conversations')}
        label="会话"
        badge={unreadTotal}
      >
        <MessageSquare className="size-5" />
      </RailButton>
      <RailButton
        active={mode === 'agents'}
        panelHidden={panelHidden}
        onClick={() => onSelect('agents')}
        label="Agents"
      >
        <Users className="size-5" />
      </RailButton>
      <RailButton
        active={mode === 'artifacts'}
        panelHidden={panelHidden}
        onClick={() => onSelect('artifacts')}
        label="产物库"
      >
        <Layers className="size-5" />
      </RailButton>
      <RailButton
        active={mode === 'analytics'}
        panelHidden={panelHidden}
        onClick={() => onSelect('analytics')}
        label="分析"
      >
        <BarChart3 className="size-5" />
      </RailButton>
      <RailButton
        active={mode === 'tasks'}
        panelHidden={panelHidden}
        onClick={() => onSelect('tasks')}
        label="任务"
        badge={taskBadge}
        badgeTestId="rail-task-badge"
      >
        <ListTodo className="size-5" />
      </RailButton>

      <div className="flex-1" />

      <ThemeToggle />
      <SettingsButton />
      <div
        className="mt-0.5 flex size-[30px] items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
        title="本地用户"
      >
        我
      </div>
    </div>
  )
}

function RailButton({
  active,
  panelHidden,
  onClick,
  label,
  badge,
  badgeTestId,
  children,
}: {
  active: boolean
  panelHidden: boolean
  onClick: () => void
  label: string
  badge?: number
  badgeTestId?: string
  children: React.ReactNode
}) {
  // 当前导航按钮兼任「面板折叠开关」：用 aria-expanded + 动态提示暴露语义
  const actionHint = active ? `${label} · 点击${panelHidden ? '展开' : '收起'}面板` : label
  return (
    <button
      type="button"
      onClick={onClick}
      title={actionHint}
      aria-label={actionHint}
      aria-expanded={active ? !panelHidden : undefined}
      className={cn(
        'relative flex size-10 items-center justify-center rounded-[9px] transition',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
      {(badge ?? 0) > 0 && (
        <span
          data-testid={badgeTestId}
          className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground"
        >
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
