'use client'

import { Send, Square } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { abortRun, sendMessage as sendMessageAPI } from '@/lib/api'
import { useAppStore, useTopLevelRunningRuns } from '@/stores/app-store'

export function MessageInput({ conversationId }: { conversationId: string }) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [aborting, setAborting] = useState(false)

  const addLocalUserMessage = useAppStore((s) => s.addLocalUserMessage)
  const replaceLocalMessageId = useAppStore((s) => s.replaceLocalMessageId)
  const runningRuns = useTopLevelRunningRuns(conversationId)
  const isRunning = runningRuns.length > 0

  const submit = async () => {
    const text = content.trim()
    if (!text || sending || isRunning) return

    const tempId = `temp_${nanoid()}`
    addLocalUserMessage({ tempId, conversationId, content: text, mentionedAgentIds: [] })
    setContent('')
    setSending(true)

    try {
      const { messageId } = await sendMessageAPI(conversationId, { content: text })
      replaceLocalMessageId(tempId, messageId)
    } catch (err) {
      console.error('[MessageInput] send failed', err)
    } finally {
      setSending(false)
    }
  }

  const abortAll = async () => {
    if (aborting) return
    setAborting(true)
    try {
      await Promise.allSettled(runningRuns.map((r) => abortRun(r.id)))
    } finally {
      setAborting(false)
    }
  }

  return (
    <div className="shrink-0 border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={isRunning ? '当前有 Agent 正在响应…' : '输入消息，Enter 发送，Shift+Enter 换行'}
          className="min-h-[44px] max-h-40 resize-none"
          disabled={isRunning}
        />
        {isRunning ? (
          <Button
            onClick={() => void abortAll()}
            disabled={aborting}
            size="icon"
            variant="destructive"
            title="中止全部"
          >
            <Square className="size-4 fill-current" />
          </Button>
        ) : (
          <Button
            onClick={() => void submit()}
            disabled={!content.trim() || sending}
            size="icon"
            title="发送 (Enter)"
          >
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
