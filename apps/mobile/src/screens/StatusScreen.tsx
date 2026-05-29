import type { MobileSnapshot } from '../types'

export function StatusScreen({
  connected,
  loading,
  error,
  snapshot,
  onRefresh,
  onOpenSettings,
}: {
  connected: boolean
  loading: boolean
  error: string | null
  snapshot: MobileSnapshot | null
  onRefresh: () => void
  onOpenSettings: () => void
}) {
  const running = snapshot?.runningRuns.length ?? 0
  const pendingWrites = snapshot?.pendingWrites.length ?? 0
  const pendingQuestions = snapshot?.pendingQuestions.length ?? 0

  return (
    <div className="screen-stack">
      <section className="panel hero-panel">
        <div>
          <h2>{connected ? '桌面端连接已配置' : '连接桌面端 AgentHub'}</h2>
          <p>
            手机 App 作为 companion client，只负责观察、审批和反馈；Agent、工具和 workspace 仍在桌面端执行。
          </p>
        </div>
        <button type="button" className="primary-action" onClick={connected ? onRefresh : onOpenSettings}>
          {connected ? (loading ? '刷新中' : '刷新') : '去配对'}
        </button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="metric-grid">
        <Metric label="运行中" value={running} />
        <Metric label="待审批" value={pendingWrites} />
        <Metric label="待回答" value={pendingQuestions} />
      </section>

      <section className="card-list">
        <h2 className="section-title">最近会话</h2>
        {snapshot && snapshot.conversations.length > 0 ? (
          snapshot.conversations.slice(0, 5).map((conv) => (
            <article key={conv.id} className="list-card">
              <div>
                <h3>{conv.title}</h3>
                <p>
                  {conv.mode === 'group' ? '群聊' : '单聊'} · {formatTime(conv.updatedAt)}
                </p>
              </div>
              {(conv.runningRunCount > 0 || conv.pendingWriteCount > 0) && (
                <span className="count-pill">
                  {conv.runningRunCount > 0 ? `${conv.runningRunCount} run` : `${conv.pendingWriteCount} 审批`}
                </span>
              )}
            </article>
          ))
        ) : (
          <EmptyState text={connected ? '暂无 snapshot 数据。' : '配对后会显示桌面端状态。'} />
        )}
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
