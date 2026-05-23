'use client'

import { CheckCircle2, Circle, Loader2, Network, XCircle } from 'lucide-react'

import { AgentAvatar } from '@/components/agent-avatar'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { DispatchState } from '@/stores/app-store'
import { useAppStore } from '@/stores/app-store'

type TaskStatus = 'pending' | 'running' | 'complete' | 'failed'

export function DispatchPlanCard({ dispatch }: { dispatch: DispatchState }) {
  const agents = useAppStore((s) => s.agents)
  const total = dispatch.plan.length
  const done = Object.values(dispatch.taskStatus).filter(
    (s) => s === 'complete' || s === 'failed',
  ).length
  const allDone = done === total
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <Card className="overflow-hidden border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <Network className={cn('size-4 text-primary', !allDone && 'animate-pulse')} />
          <div className="text-sm font-medium">任务拆解 · {total} 项</div>
          <div className="ml-auto text-xs text-muted-foreground">
            {done} / {total}
          </div>
        </div>

        {/* 进度条 */}
        <div className="h-1 overflow-hidden rounded-full bg-primary/10">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              allDone ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="space-y-1.5">
          {dispatch.plan.map((task, idx) => {
            const status = (dispatch.taskStatus[task.id] ?? 'pending') as TaskStatus
            const agent = agents[task.agentId]
            return (
              <div
                key={task.id}
                style={{ animationDelay: `${idx * 60}ms` }}
                className={cn(
                  'flex items-start gap-2 rounded-md border bg-card px-2 py-1.5 text-xs',
                  'animate-in fade-in slide-in-from-left-2 fill-mode-both duration-300',
                  'transition-[border-color,box-shadow,background-color] duration-300',
                  status === 'running' &&
                    'border-amber-300 bg-amber-50/40 ring-2 ring-amber-200/60 dark:bg-amber-950/20',
                  status === 'complete' && 'border-emerald-200 dark:border-emerald-900/40',
                  status === 'failed' && 'border-red-300',
                )}
              >
                <StatusIcon status={status} />
                {agent ? (
                  <AgentAvatar
                    agent={agent}
                    size="xs"
                    className={cn(
                      'transition-transform',
                      status === 'running' && 'scale-110 ring-2 ring-amber-300 ring-offset-1',
                    )}
                  />
                ) : (
                  <div className="size-5 shrink-0 rounded-full bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{agent?.name ?? task.agentId}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                    {task.dependsOn && task.dependsOn.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        ← {task.dependsOn.join(', ')}
                      </span>
                    )}
                    {status === 'running' && <TypingDots />}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-muted-foreground">{task.task}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function StatusIcon({ status }: { status: TaskStatus }) {
  const base = 'mt-0.5 size-3.5 shrink-0 transition-colors'
  if (status === 'pending') {
    return <Circle className={cn(base, 'text-muted-foreground/40')} />
  }
  if (status === 'running') {
    return <Loader2 className={cn(base, 'animate-spin text-amber-600')} />
  }
  if (status === 'complete') {
    return (
      <CheckCircle2
        className={cn(base, 'text-emerald-600 animate-in zoom-in-50 duration-300')}
      />
    )
  }
  return <XCircle className={cn(base, 'text-red-600 animate-in zoom-in-50 duration-300')} />
}

/** 三点 typing 指示器，用于「running」状态行 */
function TypingDots() {
  return (
    <span className="ml-0.5 inline-flex items-center gap-0.5">
      <span className="size-1 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.3s]" />
      <span className="size-1 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.15s]" />
      <span className="size-1 animate-bounce rounded-full bg-amber-500" />
    </span>
  )
}
