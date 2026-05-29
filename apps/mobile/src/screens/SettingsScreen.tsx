import type { ConnectionConfig } from '../types'

export function SettingsScreen({
  connection,
  loading,
  error,
  onChange,
  onTest,
}: {
  connection: ConnectionConfig
  loading: boolean
  error: string | null
  onChange: (next: ConnectionConfig) => void
  onTest: () => void
}) {
  return (
    <div className="screen-stack">
      <section className="panel vertical">
        <div>
          <h2>桌面端连接</h2>
          <p>真机联调用电脑的 LAN/Tailscale IP，不要填 localhost；localhost 只适合电脑本机预览。</p>
        </div>

        <label className="field">
          <span>Desktop host</span>
          <input
            value={connection.baseUrl}
            placeholder="http://100.x.y.z:3000"
            inputMode="url"
            autoCapitalize="none"
            onChange={(e) => onChange({ ...connection, baseUrl: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Device token</span>
          <input
            value={connection.deviceToken}
            placeholder="临时填写 AGENTHUB_MOBILE_DEV_TOKEN"
            autoCapitalize="none"
            autoComplete="off"
            onChange={(e) => onChange({ ...connection, deviceToken: e.target.value })}
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <button type="button" className="primary-action full" onClick={onTest}>
          {loading ? '测试中' : '测试连接'}
        </button>
      </section>

      <section className="note-card">
        <h2>推荐连接方式</h2>
        <p>
          P0 支持 LAN 手动输入；桌面端先设置 AGENTHUB_MOBILE_DEV_TOKEN。日常使用建议通过 Tailscale/tailnet 访问桌面端 companion server，避免暴露到公网。
        </p>
      </section>
    </div>
  )
}
