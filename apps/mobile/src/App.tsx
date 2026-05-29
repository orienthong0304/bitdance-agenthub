import { useEffect, useMemo, useState } from 'react'

import { createMobileApiClient } from './api/client'
import { BottomNav, type TabId } from './components/BottomNav'
import { ApprovalsScreen } from './screens/ApprovalsScreen'
import { ConversationsScreen } from './screens/ConversationsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StatusScreen } from './screens/StatusScreen'
import { loadConnection, saveConnection } from './storage/connection'
import type {
  ConnectionConfig,
  MobileAskUserAnswers,
  MobileConversationDetail,
  MobileSnapshot,
} from './types'

const initialConnection = loadConnection()

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('status')
  const [connection, setConnection] = useState<ConnectionConfig>(initialConnection)
  const [snapshot, setSnapshot] = useState<MobileSnapshot | null>(null)
  const [conversationDetail, setConversationDetail] = useState<MobileConversationDetail | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [operationId, setOperationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const api = useMemo(() => createMobileApiClient(connection), [connection])
  const connected = !!connection.baseUrl && !!connection.deviceToken

  useEffect(() => {
    saveConnection(connection)
  }, [connection])

  useEffect(() => {
    if (!connected || activeTab === 'settings') return

    let cancelled = false

    async function refreshMobileSnapshot() {
      try {
        const next = await api.getSnapshot()
        if (!cancelled) setSnapshot(next)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    const timer = window.setInterval(() => {
      void refreshMobileSnapshot()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeTab, api, connected])

  useEffect(() => {
    if (!connected || activeTab !== 'conversations' || !selectedConversationId) return

    let cancelled = false
    const conversationId = selectedConversationId

    async function refreshConversationDetail() {
      try {
        const next = await api.getConversation(conversationId)
        if (!cancelled) setConversationDetail(next)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    const timer = window.setInterval(() => {
      void refreshConversationDetail()
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeTab, api, connected, selectedConversationId])

  async function refreshSnapshot() {
    if (!connected) {
      setError('请先在设置里填写桌面端地址和设备 token。')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await api.getSnapshot()
      setSnapshot(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function runMobileAction(id: string, action: () => Promise<void>) {
    if (!connected) {
      setError('请先在设置里填写桌面端地址和设备 token。')
      return
    }
    setOperationId(id)
    setError(null)
    try {
      await action()
      setSnapshot(await api.getSnapshot())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOperationId(null)
    }
  }

  async function openConversation(id: string) {
    if (!connected) {
      setError('请先在设置里填写桌面端地址和设备 token。')
      return
    }
    setSelectedConversationId(id)
    setLoading(true)
    setError(null)
    try {
      setConversationDetail(await api.getConversation(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function sendMessageFromMobile(content: string) {
    if (!selectedConversationId) return
    await runMobileAction('send-message', async () => {
      await api.sendMessage(selectedConversationId, content)
      setConversationDetail(await api.getConversation(selectedConversationId))
    })
  }

  const content =
    activeTab === 'status' ? (
      <StatusScreen
        connected={connected}
        loading={loading}
        error={error}
        snapshot={snapshot}
        onRefresh={() => void refreshSnapshot()}
        onOpenSettings={() => setActiveTab('settings')}
      />
    ) : activeTab === 'conversations' ? (
      <ConversationsScreen
        connected={connected}
        loading={loading}
        snapshot={snapshot}
        detail={conversationDetail}
        selectedConversationId={selectedConversationId}
        onOpenConversation={(id) => void openConversation(id)}
        onBack={() => {
          setSelectedConversationId(null)
          setConversationDetail(null)
        }}
        onSendMessage={(content) => void sendMessageFromMobile(content)}
      />
    ) : activeTab === 'approvals' ? (
      <ApprovalsScreen
        connected={connected}
        busyId={operationId}
        snapshot={snapshot}
        onWriteDecision={(id, action) =>
          void runMobileAction(id, () => api.decidePendingWrite(id, action))
        }
        onQuestionAnswer={(id, answers: MobileAskUserAnswers) =>
          void runMobileAction(id, () => api.answerPendingQuestion(id, answers))
        }
      />
    ) : (
      <SettingsScreen
        connection={connection}
        loading={loading}
        error={error}
        onChange={setConnection}
        onTest={() => void refreshSnapshot()}
      />
    )

  return (
    <main className="app-shell">
      <div className="top-bar">
        <div>
          <p className="eyebrow">AgentHub Companion</p>
          <h1>{titleFor(activeTab)}</h1>
        </div>
        <span className={connected ? 'status-pill online' : 'status-pill'}>
          {connected ? '已配置' : '未配对'}
        </span>
      </div>

      <div className="screen-frame">{content}</div>

      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
    </main>
  )
}

function titleFor(tab: TabId): string {
  switch (tab) {
    case 'status':
      return '状态'
    case 'conversations':
      return '会话'
    case 'approvals':
      return '审批'
    case 'settings':
      return '设置'
  }
}
