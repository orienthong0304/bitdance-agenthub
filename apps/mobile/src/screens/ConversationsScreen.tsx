import { useState } from 'react'

import type { MobileConversationDetail, MobileMessagePart, MobileSnapshot } from '../types'

export function ConversationsScreen({
  connected,
  loading,
  snapshot,
  detail,
  selectedConversationId,
  onOpenConversation,
  onBack,
  onSendMessage,
}: {
  connected: boolean
  loading: boolean
  snapshot: MobileSnapshot | null
  detail: MobileConversationDetail | null
  selectedConversationId: string | null
  onOpenConversation: (id: string) => void
  onBack: () => void
  onSendMessage: (content: string) => void
}) {
  const [draft, setDraft] = useState('')

  if (!connected) {
    return <div className="empty-state">先在设置中配对桌面端。</div>
  }

  if (selectedConversationId) {
    return (
      <div className="screen-stack">
        <button type="button" className="secondary-action fit" onClick={onBack}>
          返回会话列表
        </button>

        {detail ? (
          <>
            <section className="panel vertical">
              <h2>{detail.conversation.title}</h2>
              <p>
                {detail.conversation.mode === 'group' ? '群聊' : '单聊'} · {detail.messages.length} 条消息
              </p>
            </section>

            <section className="message-list">
              {detail.messages.length > 0 ? (
                detail.messages.map((message) => (
                  <article key={message.id} className={`message-card ${message.role}`}>
                    <div className="message-meta">
                      {message.role === 'user' ? '你' : message.agentId ?? message.role} · {formatTime(message.createdAt)}
                    </div>
                    <div className="message-parts">
                      {message.parts.map((part, index) => (
                        <MessagePartView key={`${message.id}-${index}`} part={part} />
                      ))}
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">这个会话还没有消息。</div>
              )}
            </section>

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault()
                const content = draft.trim()
                if (!content) return
                onSendMessage(content)
                setDraft('')
              }}
            >
              <textarea
                value={draft}
                rows={3}
                placeholder="输入意见或追问..."
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" className="primary-action" disabled={!draft.trim()}>
                发送
              </button>
            </form>
          </>
        ) : (
          <div className="empty-state">{loading ? '加载会话中...' : '会话详情暂不可用。'}</div>
        )}
      </div>
    )
  }

  return (
    <section className="card-list">
      <h2 className="section-title">会话</h2>
      {snapshot && snapshot.conversations.length > 0 ? (
        snapshot.conversations.map((conv) => (
          <button
            key={conv.id}
            type="button"
            className="list-card conversation-button"
            onClick={() => onOpenConversation(conv.id)}
          >
            <div>
              <h3>{conv.title}</h3>
              <p>
                {conv.mode === 'group' ? '群聊' : '单聊'} · {formatTime(conv.updatedAt)}
              </p>
            </div>
            <span className="chevron">›</span>
          </button>
        ))
      ) : (
        <div className="empty-state">暂无会话。刷新 snapshot 后会显示桌面端会话列表。</div>
      )}
    </section>
  )
}

function MessagePartView({ part }: { part: MobileMessagePart }) {
  switch (part.type) {
    case 'text':
      return <p>{part.content}</p>
    case 'thinking':
      return <p className="muted-text">思考：{part.content}</p>
    case 'code':
      return <pre>{part.content}</pre>
    case 'tool_use':
      return <span className="inline-chip">调用工具：{part.toolName}</span>
    case 'tool_result':
      return <span className="inline-chip">{part.isError ? '工具执行失败' : '工具执行完成'}</span>
    case 'artifact_ref':
      return <span className="inline-chip">产物：{part.artifactId}</span>
    case 'attachment':
      return <span className="inline-chip">{part.kind === 'image' ? '图片' : '文件'}：{part.fileName}</span>
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
