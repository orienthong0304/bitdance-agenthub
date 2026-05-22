'use client'

import { CheckCircle2, Circle, Loader2, Network, XCircle } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { DispatchState } from '@/stores/app-store'
import { useAppStore } from '@/stores/app-store'

export function DispatchPlanCard({ dispatch }: { dispatch: DispatchState }) {
  const agents = useAppStore((s) => s.agents)
  const total = dispatch.plan.length
  const done = Object.values(dispatch.taskStatus).filter(
    (s) => s === 'complete' || s === 'failed',
  ).length

  return (
    <Card className="border-primary/20 bg-primary/5">
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-primary" />
          <div className="text-sm font-medium">任务拆解 · {total} 项</div>
          <div className="ml-auto text-xs text-muted-foreground">
            {done} / {total} 完成
          </div>
        </div>

        <div className="space-y-1.5">
          {dispatch.plan.map((task) => {
            const status = dispatch.taskStatus[task.id] ?? 'pending'
            const agent = agents[task.agentId]
            return (
              <div
                key={task.id}
                className={cn(
                  'flex items-start gap-2 rounded-md border bg-card px-2 py-1.5 text-xs transition',
                  status === 'running' && 'border-amber-300 ring-1 ring-amber-200',
                  status === 'complete' && 'border-emerald-200',
                  status === 'failed' && 'border-red-300',
                )}
              >
                <StatusIcon status={status} />
                <Avatar className="size-5 shrink-0">
                  <AvatarFallback className="text-[10px]">{agent?.avatar ?? '?'}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{agent?.name ?? task.agentId}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                    {task.dependsOn && task.dependsOn.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        ← {task.dependsOn.join(', ')}
                      </span>
                    )}
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

function StatusIcon({ status }: { status: 'pending' | 'running' | 'complete' | 'failed' }) {
  if (status === 'pending') return <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
  if (status === 'running') return <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-amber-600" />
  if (status === 'complete') return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
  return <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />
}
