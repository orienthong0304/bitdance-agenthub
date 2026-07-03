'use client'

import { Check, Loader2, Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  fetchAppSettings,
  fetchUsageSummary,
  updateAppSettings,
  type UsageAgentRow,
  type UsageModelRow,
  type UsageSummary,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatCost, type ModelPrice, type ModelPriceTable } from '@/shared/model-pricing'

/**
 * UsagePage —— rail「分析」激活时的主区用量页（880px）。
 *
 * 4 指标卡（总 tokens / 成本自算 / cache 命中率 / 总 run 数）+ 按 Agent 条形 +
 * 按模型价目表（单价行内可编辑，保存即重算）。成本口径见 spec：usage-cost。
 */
export function UsagePage() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [overrides, setOverrides] = useState<ModelPriceTable>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [summary, settings] = await Promise.all([fetchUsageSummary(), fetchAppSettings()])
      setData(summary)
      setOverrides(settings.modelPrices ?? {})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 行内改价：写覆盖（字段级 merge 保留默认 cache 价），持久化后重拉 summary 重算成本
  const saveModelPrice = useCallback(
    async (model: string, next: { inputPer1M: number; outputPer1M: number; currency: 'USD' | 'CNY' }) => {
      const nextOverrides: ModelPriceTable = {
        ...overrides,
        [model]: { ...(overrides[model] ?? {}), ...next },
      }
      const settings = await updateAppSettings({ modelPrices: nextOverrides })
      setOverrides(settings.modelPrices ?? {})
      setData(await fetchUsageSummary())
    },
    [overrides],
  )

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-8 pb-12 pt-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">用量分析</h1>
              <p className="mt-1 max-w-[560px] text-[13px] text-muted-foreground">
                跨会话聚合。国产模型 total_cost 不可信，成本按 token × 本地价目表自算。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {loading ? '…' : '刷新'}
            </button>
          </div>

          {error ? (
            <div className="mt-8 flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center text-xs">
              <div className="text-destructive">{error}</div>
              <button
                type="button"
                onClick={() => void reload()}
                className="rounded-md border px-2 py-1 hover:bg-accent"
              >
                重试
              </button>
            </div>
          ) : loading && !data ? (
            <div className="mt-8 flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              加载用量数据...
            </div>
          ) : data ? (
            <UsageContent data={data} overrides={overrides} onSave={saveModelPrice} />
          ) : null}
        </div>
      </div>
    </main>
  )
}

function UsageContent({
  data,
  overrides,
  onSave,
}: {
  data: UsageSummary
  overrides: ModelPriceTable
  onSave: (
    model: string,
    next: { inputPer1M: number; outputPer1M: number; currency: 'USD' | 'CNY' },
  ) => Promise<void>
}) {
  const maxAgentTok = data.byAgent[0]?.totalTokens ?? 0

  if (data.allTime.runs === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
        还没有用量数据 —— 跟 Agent 聊几句就有了
      </div>
    )
  }

  return (
    <>
      {/* 指标卡 */}
      <div className="mt-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <MetricCard label="总 tokens" value={formatTok(data.allTime.totalTokens)} testId="usage-metric-total-tokens" />
        <MetricCard
          label="成本（自算）"
          value={formatCost(data.totalCost.usd, data.totalCost.cny)}
          accent
          testId="usage-metric-total-cost"
        />
        <MetricCard
          label="cache 命中率"
          value={data.cacheRate === null ? '—' : `${(data.cacheRate * 100).toFixed(1)}%`}
          testId="usage-metric-cache-rate"
        />
        <MetricCard label="总 run 数" value={String(data.allTime.runs)} testId="usage-metric-run-count" />
      </div>

      {/* 按 Agent */}
      {data.byAgent.length > 0 && (
        <>
          <SectionTitle>按 Agent</SectionTitle>
          <div className="overflow-hidden rounded-xl border">
            {data.byAgent.map((a) => (
              <AgentBar key={a.agentId} agent={a} max={maxAgentTok} />
            ))}
          </div>
        </>
      )}

      {/* 按模型 · 价目表自算 */}
      {data.byModel.length > 0 && (
        <>
          <SectionTitle>按模型 · 价目表自算</SectionTitle>
          <div className="overflow-hidden rounded-xl border">
            <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="flex-1">模型</span>
              <span className="w-[150px] shrink-0">价目（输入/输出）</span>
              <span className="w-16 shrink-0 text-right">tokens</span>
              <span className="w-20 shrink-0 text-right">成本</span>
            </div>
            {data.byModel.map((m) => (
              <ModelRow
                key={m.model}
                row={m}
                override={overrides[m.model]}
                onSave={(next) => onSave(m.model, next)}
              />
            ))}
          </div>
        </>
      )}

      {data.unpricedTokens > 0 && (
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          存在 {formatTok(data.unpricedTokens)} 未计价 tokens（未定价模型或无 model 信息的 run）——
          不计入成本总额。点击对应模型行的价目可现填单价开始计价。
        </p>
      )}
    </>
  )
}

function MetricCard({
  label,
  value,
  accent,
  testId,
}: {
  label: string
  value: string
  accent?: boolean
  testId?: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={testId}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1.5 font-mono text-2xl font-bold',
          accent ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-7 text-sm font-bold">{children}</div>
}

function AgentBar({ agent, max }: { agent: UsageAgentRow; max: number }) {
  const pct = max > 0 ? (agent.totalTokens * 100) / max : 0
  return (
    <div className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
      <div className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-muted text-[15px]">
        {agent.avatar ?? '🤖'}
      </div>
      <div className="w-24 shrink-0">
        <div className="truncate text-[13px] font-medium">{agent.name}</div>
        <div className="truncate font-mono text-[10.5px] text-muted-foreground">
          {agent.topModel ?? '—'}
        </div>
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatTok(agent.totalTokens)}
      </div>
    </div>
  )
}

function ModelRow({
  row,
  override,
  onSave,
}: {
  row: UsageModelRow
  override: ModelPrice | undefined
  onSave: (next: { inputPer1M: number; outputPer1M: number; currency: 'USD' | 'CNY' }) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [inputRate, setInputRate] = useState('')
  const [outputRate, setOutputRate] = useState('')
  const [currency, setCurrency] = useState<'USD' | 'CNY'>('USD')

  const startEdit = () => {
    setInputRate(row.price ? String(row.price.inputPer1M) : '')
    setOutputRate(row.price ? String(row.price.outputPer1M) : '')
    setCurrency(row.price?.currency ?? override?.currency ?? 'USD')
    setEditing(true)
  }

  const inputNum = Number(inputRate)
  const outputNum = Number(outputRate)
  const valid =
    inputRate.trim() !== '' &&
    outputRate.trim() !== '' &&
    Number.isFinite(inputNum) &&
    Number.isFinite(outputNum) &&
    inputNum >= 0 &&
    outputNum >= 0

  const commit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      await onSave({ inputPer1M: inputNum, outputPer1M: outputNum, currency })
      setEditing(false)
    } catch (err) {
      console.error('[UsagePage] save price failed', err)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div
        className="flex items-center gap-3 border-b px-4 py-2.5 text-[12.5px] last:border-b-0"
        data-testid={`usage-model-row-${row.model}`}
      >
        <span className="flex-1 truncate font-mono">{row.model}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step="0.01"
            min="0"
            value={inputRate}
            onChange={(e) => setInputRate(e.target.value)}
            aria-label="输入单价"
            placeholder="输入"
            className="h-7 w-16 rounded border bg-background px-1.5 text-xs outline-none focus:border-foreground/30"
          />
          <span className="text-muted-foreground">/</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={outputRate}
            onChange={(e) => setOutputRate(e.target.value)}
            aria-label="输出单价"
            placeholder="输出"
            className="h-7 w-16 rounded border bg-background px-1.5 text-xs outline-none focus:border-foreground/30"
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as 'USD' | 'CNY')}
            aria-label="币种"
            className="h-7 rounded border bg-background px-1 text-xs outline-none focus:border-foreground/30"
          >
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
          </select>
          <button
            type="button"
            onClick={() => void commit()}
            disabled={!valid || saving}
            title="保存"
            aria-label="保存"
            className="flex size-7 items-center justify-center rounded border text-primary transition hover:bg-accent disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            title="取消"
            aria-label="取消"
            className="flex size-7 items-center justify-center rounded border text-muted-foreground transition hover:bg-accent"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="group flex items-center gap-3 border-b px-4 py-2.5 text-[12.5px] last:border-b-0"
      data-testid={`usage-model-row-${row.model}`}
    >
      <span className="flex-1 truncate font-mono">{row.model}</span>
      <button
        type="button"
        onClick={startEdit}
        title={`点击编辑 ${row.model} 价目`}
        aria-label={`编辑 ${row.model} 价目`}
        className="flex w-[150px] shrink-0 items-center gap-1 text-left text-[11.5px] text-muted-foreground transition hover:text-foreground"
      >
        <span className="truncate">{formatPrice(row.price)}</span>
        <Pencil className="size-3 opacity-0 transition group-hover:opacity-60" />
      </button>
      <span className="w-16 shrink-0 text-right font-mono text-muted-foreground">
        {formatTok(row.totalTokens)}
      </span>
      <span
        className={cn(
          'w-20 shrink-0 text-right font-mono font-semibold',
          row.cost === null ? 'text-muted-foreground' : 'text-primary',
        )}
        data-testid={`usage-model-cost-${row.model}`}
      >
        {row.cost === null || !row.price
          ? '未定价'
          : row.price.currency === 'USD'
            ? formatCost(row.cost, 0)
            : formatCost(0, row.cost)}
      </span>
    </div>
  )
}

function formatPrice(price: UsageModelRow['price']): string {
  if (!price) return '点击定价'
  const sym = price.currency === 'USD' ? '$' : '¥'
  return `${sym}${price.inputPer1M} / ${sym}${price.outputPer1M}`
}

/** 1234 → "1.2k"；1234567 → "1.23M"；< 1000 → 原样 */
function formatTok(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
