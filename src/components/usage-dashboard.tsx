'use client'

import { BarChart3, Coins, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { fetchUsageSummary, type UsageBucket, type UsageSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

/**
 * UsageDashboard —— 侧栏「分析」tab 内容（瘦身版）。
 *
 * 只保留 时间桶 + 按会话列表（条形 + token，点击跳会话并切回会话模式）；
 * 按 Agent / 按模型 已移入主区用量页（UsagePage），此处职责去重。
 * 数据来自 /api/usage/summary（每次 mount 拉一次；用户切回 tab 也重拉，保证 fresh）。
 */
export function UsageDashboard() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const setActiveConversation = useAppStore((s) => s.setActiveConversation)
  const setRailMode = useAppStore((s) => s.setRailMode)

  // 点击按会话行：激活会话 + 切回会话模式（主区恢复聊天视图）
  const openConversation = useCallback(
    (id: string) => {
      setActiveConversation(id)
      setRailMode('conversations')
    },
    [setActiveConversation, setRailMode],
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const summary = await fetchUsageSummary()
      setData(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (loading && !data) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        加载用量数据...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs">
        <div className="text-destructive">{error}</div>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-md border px-2 py-1 hover:bg-accent"
        >
          重试
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-3 text-xs">
        <header className="flex items-center justify-between border-b pb-2">
          <span className="flex items-center gap-1.5 font-medium">
            <BarChart3 className="size-3.5" />
            用量分析
          </span>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {loading ? '…' : '刷新'}
          </button>
        </header>

        {/* 时间桶 */}
        <Section title="按时间">
          <BucketRow label="今日" b={data.today} />
          <BucketRow label="本周" b={data.week} />
          <BucketRow label="全部" b={data.allTime} bold />
        </Section>

        {/* 按会话 —— 点击跳会话并切回会话模式 */}
        {data.topConversations.length > 0 && (
          <Section title="按会话">
            {data.topConversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openConversation(c.id)}
                className="w-full space-y-1 rounded px-1.5 py-1 text-left transition hover:bg-accent"
                title={`点击跳转 · 更新时间 ${new Date(c.updatedAt).toLocaleString('zh-CN')}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    <Coins className="mr-1 inline size-3" />
                    {formatTok(c.totalTokens)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${
                        data.topConversations[0].totalTokens > 0
                          ? (c.totalTokens * 100) / data.topConversations[0].totalTokens
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </button>
            ))}
          </Section>
        )}

        {data.allTime.runs === 0 && (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
            还没有用量数据 —— 跟 Agent 聊几句就有了
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function BucketRow({
  label,
  b,
  bold,
}: {
  label: string
  b: UsageBucket
  bold?: boolean
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-2', bold && 'font-medium')}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono">
        {formatTok(b.totalTokens)}
        <span className="ml-1 text-[10px] text-muted-foreground">
          {b.runs > 0 ? `· ${b.runs} run` : ''}
        </span>
      </span>
    </div>
  )
}

function formatTok(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
