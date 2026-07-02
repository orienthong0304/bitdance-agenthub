'use client'

import { BarChart3, Layers, LifeBuoy, MessageSquare, Users } from 'lucide-react'

import { SettingsButton } from '@/components/settings-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

export type RailMode = 'conversations' | 'artifacts' | 'agents' | 'analytics'

/**
 * IconRail — 应用左缘 56px 图标导航栏（redesign-ui-shell Phase B）。
 *
 * logo + 四个导航（会话带未读 badge）+ 底部主题/设置/用户位。
 * 点击当前导航可折叠/展开二级列表面板（onSelect 由 Sidebar 处理）。
 */
export function IconRail({
  mode,
  onSelect,
}: {
  mode: RailMode
  onSelect: (mode: RailMode) => void
}) {
  const unreadTotal = useAppStore((s) =>
    Object.values(s.unreadByConv).reduce((sum, n) => sum + n, 0),
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
        onClick={() => onSelect('conversations')}
        label="会话"
        badge={unreadTotal}
      >
        <MessageSquare className="size-5" />
      </RailButton>
      <RailButton active={mode === 'agents'} onClick={() => onSelect('agents')} label="Agents">
        <Users className="size-5" />
      </RailButton>
      <RailButton active={mode === 'artifacts'} onClick={() => onSelect('artifacts')} label="产物库">
        <Layers className="size-5" />
      </RailButton>
      <RailButton active={mode === 'analytics'} onClick={() => onSelect('analytics')} label="分析">
        <BarChart3 className="size-5" />
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
  onClick,
  label,
  badge,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'relative flex size-10 items-center justify-center rounded-[9px] transition',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
      {(badge ?? 0) > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
