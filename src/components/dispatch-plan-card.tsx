'use client'

import { Ban, Check, CheckCircle2, Circle, Loader2, Network, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { AgentAvatar } from '@/components/agent-avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  approvePendingDispatchPlan,
  rejectPendingDispatchPlan,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { AgentRow } from '@/db/schema'
import type { DispatchState } from '@/stores/app-store'
import { useAppStore } from '@/stores/app-store'
import type {
  DispatchExpectedOutput,
  DispatchPlanItem,
  DispatchTaskInput,
  DispatchTaskStatus,
} from '@/shared/types'

interface DispatchPlanCardProps {
  conversationId: string
  dispatch: DispatchState
}

interface ContractDraft {
  expectedOutputs: string
  inputs: string
  acceptanceCriteria: string
}

export function DispatchPlanCard({ conversationId, dispatch }: DispatchPlanCardProps) {
  if (dispatch.reviewStatus === 'pending' && dispatch.pendingPlanId) {
    return (
      <DispatchPlanReviewCard
        conversationId={conversationId}
        dispatch={dispatch}
        pendingPlanId={dispatch.pendingPlanId}
      />
    )
  }

  return <DispatchPlanReadOnlyCard dispatch={dispatch} />
}

function DispatchPlanReviewCard({
  conversationId,
  dispatch,
  pendingPlanId,
}: {
  conversationId: string
  dispatch: DispatchState
  pendingPlanId: string
}) {
  const agents = useAppStore((s) => s.agents)
  const conversation = useAppStore((s) => s.conversations[conversationId])
  const selectableAgents = useMemo(
    () =>
      (conversation?.agentIds ?? Object.keys(agents))
        .map((id) => agents[id])
        .filter((agent): agent is AgentRow => Boolean(agent) && !agent.isOrchestrator),
    [agents, conversation?.agentIds],
  )

  const [draft, setDraft] = useState<DispatchPlanItem[]>(() => clonePlan(dispatch.plan))
  const [contracts, setContracts] = useState<Record<string, ContractDraft>>(() =>
    createContractDraft(dispatch.plan),
  )
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(clonePlan(dispatch.plan))
    setContracts(createContractDraft(dispatch.plan))
    setBusy(null)
    setError(null)
  }, [dispatch.plan, pendingPlanId])

  const updateTask = (taskId: string, updater: (task: DispatchPlanItem) => DispatchPlanItem) => {
    setDraft((prev) => prev.map((task) => (task.id === taskId ? updater(task) : task)))
  }

  const updateContract = (taskId: string, key: keyof ContractDraft, value: string) => {
    setContracts((prev) => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] ?? emptyContractDraft()),
        [key]: value,
      },
    }))
  }

  const handleApprove = async () => {
    if (busy) return
    setBusy('approve')
    setError(null)
    try {
      const nextPlan = buildPlanFromDraft(draft, contracts)
      await approvePendingDispatchPlan(conversationId, pendingPlanId, nextPlan)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const handleReject = async () => {
    if (busy) return
    setBusy('reject')
    setError(null)
    try {
      await rejectPendingDispatchPlan(conversationId, pendingPlanId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  return (
    <Card className="overflow-hidden border-amber-300/70 bg-amber-50/50 animate-in fade-in slide-in-from-top-2 duration-300 dark:border-amber-900/50 dark:bg-amber-950/15">
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-amber-600" />
          <div className="text-sm font-medium">计划待确认 · {draft.length} 项</div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleReject()}
              disabled={!!busy}
              className="h-7 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
            >
              {busy === 'reject' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              拒绝
            </Button>
            <Button
              size="sm"
              onClick={() => void handleApprove()}
              disabled={!!busy}
              className="h-7 bg-[#3370FF] px-2 text-white hover:bg-[#2860e5]"
            >
              {busy === 'approve' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              执行计划
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {draft.map((task, idx) => {
            const agent = agents[task.agentId]
            const contract = contracts[task.id] ?? emptyContractDraft()
            const options = agentOptionsForTask(task.agentId, selectableAgents, agents)
            return (
              <div
                key={task.id}
                style={{ animationDelay: `${idx * 50}ms` }}
                className="space-y-2 rounded-md border bg-card p-2 text-xs animate-in fade-in slide-in-from-left-2 fill-mode-both duration-300"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
                  {agent ? (
                    <AgentAvatar agent={agent} size="xs" />
                  ) : (
                    <div className="size-5 shrink-0 rounded-full bg-muted" />
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                  <select
                    value={task.agentId}
                    onChange={(event) =>
                      updateTask(task.id, (current) => ({
                        ...current,
                        agentId: event.target.value,
                      }))
                    }
                    className="h-7 min-w-[140px] rounded-md border bg-background px-2 text-xs outline-none focus:border-[#3370FF]"
                  >
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={(task.dependsOn ?? []).join(', ')}
                    onChange={(event) =>
                      updateTask(task.id, (current) => {
                        const dependsOn = parseCsv(event.target.value)
                        return {
                          ...current,
                          ...(dependsOn.length > 0 ? { dependsOn } : { dependsOn: undefined }),
                        }
                      })
                    }
                    placeholder="dependsOn: t1, t2"
                    className="h-7 min-w-[160px] flex-1 text-xs"
                  />
                </div>

                <Textarea
                  value={task.task}
                  onChange={(event) =>
                    updateTask(task.id, (current) => ({ ...current, task: event.target.value }))
                  }
                  className="min-h-[72px] resize-y text-xs leading-5"
                />

                <div className="grid gap-2 md:grid-cols-3">
                  <JsonField
                    label="expectedOutputs"
                    value={contract.expectedOutputs}
                    onChange={(value) => updateContract(task.id, 'expectedOutputs', value)}
                  />
                  <JsonField
                    label="inputs"
                    value={contract.inputs}
                    onChange={(value) => updateContract(task.id, 'inputs', value)}
                  />
                  <JsonField
                    label="acceptanceCriteria"
                    value={contract.acceptanceCriteria}
                    onChange={(value) => updateContract(task.id, 'acceptanceCriteria', value)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function DispatchPlanReadOnlyCard({ dispatch }: { dispatch: DispatchState }) {
  const agents = useAppStore((s) => s.agents)
  const total = dispatch.plan.length
  const displayStatuses = dispatch.plan.map((task) =>
    dispatch.reviewStatus === 'rejected' ? 'skipped' : (dispatch.taskStatus[task.id] ?? 'pending'),
  )
  const done = displayStatuses.filter(isTerminalStatus).length
  const allDone = total > 0 && done === total
  const hasFailed = displayStatuses.some((s) => s === 'failed' || s === 'aborted')
  const hasSkipped = displayStatuses.some((s) => s === 'skipped')
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  const rejected = dispatch.reviewStatus === 'rejected'

  return (
    <Card
      className={cn(
        'overflow-hidden border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-2 duration-300',
        rejected && 'border-zinc-300 bg-muted/40 dark:border-zinc-800',
      )}
    >
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          {rejected ? (
            <Ban className="size-4 text-zinc-500" />
          ) : (
            <Network className={cn('size-4 text-primary', !allDone && 'animate-pulse')} />
          )}
          <div className="text-sm font-medium">
            {rejected ? '计划已取消' : '任务拆解'} · {total} 项
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {done} / {total}
          </div>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-primary/10">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              allDone && hasFailed && 'bg-red-500',
              allDone && !hasFailed && hasSkipped && 'bg-zinc-400',
              allDone && !hasFailed && !hasSkipped && 'bg-emerald-500',
              !allDone && !rejected && 'bg-primary',
              rejected && 'bg-zinc-400',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="space-y-1.5">
          {dispatch.plan.map((task, idx) => {
            const status =
              dispatch.reviewStatus === 'rejected'
                ? 'skipped'
                : (dispatch.taskStatus[task.id] ?? 'pending')
            const agent = agents[task.agentId]
            const inputRefs = task.inputs?.map((input) => `${input.fromTaskId}.${input.outputId}`) ?? []
            const outputRefs =
              task.expectedOutputs?.map((output) => `${output.id}:${output.type}`) ?? []
            const criteriaCount = task.acceptanceCriteria?.length ?? 0
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
                  status === 'aborted' && 'border-zinc-300 bg-zinc-50/50 dark:border-zinc-700',
                  status === 'skipped' && 'border-zinc-200 bg-muted/40 dark:border-zinc-800',
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
                        → {task.dependsOn.join(', ')}
                      </span>
                    )}
                    {status === 'running' && <TypingDots />}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-muted-foreground">{task.task}</div>
                  {(inputRefs.length > 0 || outputRefs.length > 0 || criteriaCount > 0) && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                      {inputRefs.length > 0 && (
                        <span className="rounded border bg-muted/40 px-1 py-0.5">
                          in {inputRefs.join(', ')}
                        </span>
                      )}
                      {outputRefs.length > 0 && (
                        <span className="rounded border bg-muted/40 px-1 py-0.5">
                          out {outputRefs.join(', ')}
                        </span>
                      )}
                      {criteriaCount > 0 && (
                        <span className="rounded border bg-muted/40 px-1 py-0.5">
                          checks {criteriaCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function JsonField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1">
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-h-[84px] resize-y font-mono text-[11px] leading-4"
      />
    </label>
  )
}

function clonePlan(plan: DispatchPlanItem[]): DispatchPlanItem[] {
  return plan.map((task) => ({
    ...task,
    dependsOn: task.dependsOn ? [...task.dependsOn] : undefined,
    expectedOutputs: task.expectedOutputs?.map((output) => ({ ...output })),
    inputs: task.inputs?.map((input) => ({ ...input })),
    acceptanceCriteria: task.acceptanceCriteria ? [...task.acceptanceCriteria] : undefined,
  }))
}

function createContractDraft(plan: DispatchPlanItem[]): Record<string, ContractDraft> {
  const draft: Record<string, ContractDraft> = {}
  for (const task of plan) {
    draft[task.id] = {
      expectedOutputs: stringifyJsonArray(task.expectedOutputs),
      inputs: stringifyJsonArray(task.inputs),
      acceptanceCriteria: stringifyJsonArray(task.acceptanceCriteria),
    }
  }
  return draft
}

function emptyContractDraft(): ContractDraft {
  return {
    expectedOutputs: '[]',
    inputs: '[]',
    acceptanceCriteria: '[]',
  }
}

function buildPlanFromDraft(
  draft: DispatchPlanItem[],
  contracts: Record<string, ContractDraft>,
): DispatchPlanItem[] {
  return draft.map((task) => {
    const id = task.id.trim()
    const agentId = task.agentId.trim()
    const instruction = task.task.trim()
    if (!id || !agentId || !instruction) {
      throw new Error(`Task ${task.id || '(empty)'} must include id, agent, and instruction`)
    }

    const contract = contracts[task.id] ?? emptyContractDraft()
    const expectedOutputs = parseJsonArray<DispatchExpectedOutput>(
      contract.expectedOutputs,
      `${id}.expectedOutputs`,
    )
    const inputs = parseJsonArray<DispatchTaskInput>(contract.inputs, `${id}.inputs`)
    const acceptanceCriteria = parseJsonArray<unknown>(
      contract.acceptanceCriteria,
      `${id}.acceptanceCriteria`,
    )
    if (!acceptanceCriteria.every((item) => typeof item === 'string')) {
      throw new Error(`${id}.acceptanceCriteria must be an array of strings`)
    }

    const item: DispatchPlanItem = { id, agentId, task: instruction }
    const dependsOn = task.dependsOn?.map((dep) => dep.trim()).filter(Boolean) ?? []
    if (dependsOn.length > 0) item.dependsOn = dependsOn
    if (expectedOutputs.length > 0) item.expectedOutputs = expectedOutputs
    if (inputs.length > 0) item.inputs = inputs
    if (acceptanceCriteria.length > 0) {
      item.acceptanceCriteria = acceptanceCriteria as string[]
    }
    return item
  })
}

function parseJsonArray<T>(raw: string, label: string): T[] {
  let parsed: unknown
  try {
    parsed = raw.trim() ? JSON.parse(raw) : []
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`${label} is not valid JSON: ${message}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array`)
  }
  return parsed as T[]
}

function stringifyJsonArray(value: unknown[] | undefined): string {
  return JSON.stringify(value ?? [], null, 2)
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function agentOptionsForTask(
  agentId: string,
  selectableAgents: AgentRow[],
  agents: Record<string, AgentRow>,
): AgentRow[] {
  const seen = new Set<string>()
  const result: AgentRow[] = []
  const current = agents[agentId]
  for (const agent of [current, ...selectableAgents]) {
    if (!agent || seen.has(agent.id)) continue
    seen.add(agent.id)
    result.push(agent)
  }
  return result
}

function isTerminalStatus(status: DispatchTaskStatus): boolean {
  return status === 'complete' || status === 'failed' || status === 'aborted' || status === 'skipped'
}

function StatusIcon({ status }: { status: DispatchTaskStatus }) {
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
  if (status === 'aborted' || status === 'skipped') {
    return <Ban className={cn(base, 'text-zinc-500 animate-in zoom-in-50 duration-300')} />
  }
  return <XCircle className={cn(base, 'text-red-600 animate-in zoom-in-50 duration-300')} />
}

function TypingDots() {
  return (
    <span className="ml-0.5 inline-flex items-center gap-0.5">
      <span className="size-1 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.3s]" />
      <span className="size-1 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.15s]" />
      <span className="size-1 animate-bounce rounded-full bg-amber-500" />
    </span>
  )
}
