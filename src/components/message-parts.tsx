'use client'

import { Check, ChevronRight, Copy, FileText, Image as ImageIcon, Layers, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'
import type { MessagePart } from '@/shared/types'
import { useAppStore } from '@/stores/app-store'

// ─── PartList: 调度入口 ─────────────────────────────────
export function PartList({ parts }: { parts: MessagePart[] }) {
  // 把 tool_result 按 callId 提前到对应 tool_use 的状态里
  const resultByCallId = new Map<string, { result: unknown; isError: boolean }>()
  for (const p of parts) {
    if (p.type === 'tool_result') {
      resultByCallId.set(p.callId, { result: p.result, isError: p.isError })
    }
  }

  return (
    <div className="space-y-2">
      {parts.map((p, i) => {
        if (p.type === 'tool_use') {
          return (
            <ToolUsePart
              key={i}
              toolName={p.toolName}
              args={p.args}
              callId={p.callId}
              completion={resultByCallId.get(p.callId)}
            />
          )
        }
        if (p.type === 'tool_result') {
          // tool_result 已经被合并进 ToolUsePart 渲染，跳过单独显示
          return null
        }
        return <PartRenderer key={i} part={p} />
      })}
    </div>
  )
}

function PartRenderer({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text':
      return <TextPart content={part.content} />
    case 'thinking':
      return <ThinkingPart content={part.content} />
    case 'code':
      return <CodePart language={part.language} content={part.content} />
    case 'artifact_ref':
      return <ArtifactRefPart artifactId={part.artifactId} />
    default:
      return null
  }
}

// ─── Text ──────────────────────────────────────────────
function TextPart({ content }: { content: string }) {
  if (!content) return null
  return <Markdown>{content}</Markdown>
}

// ─── Thinking（可折叠）──────────────────────────────────
function ThinkingPart({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  if (!content) return null
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="group flex w-full items-start gap-2 rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground transition hover:border-muted-foreground/50"
    >
      <ChevronRight
        className={cn('mt-0.5 size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
      />
      <div className="flex-1">
        <div className="font-medium uppercase tracking-wide text-muted-foreground/70">思考</div>
        <div
          className={cn(
            'mt-1 whitespace-pre-wrap italic leading-relaxed',
            !open && 'line-clamp-1',
          )}
        >
          {content}
        </div>
      </div>
    </button>
  )
}

// ─── Code ──────────────────────────────────────────────
function CodePart({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 忽略
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-md border bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-xs">
        <span className="font-mono text-zinc-400">{language || 'text'}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-relaxed">
        <code>{content}</code>
      </pre>
    </div>
  )
}

// ─── ToolUse + 内嵌 result ──────────────────────────────
function ToolUsePart({
  toolName,
  args,
  callId,
  completion,
}: {
  toolName: string
  args: unknown
  callId: string
  completion?: { result: unknown; isError: boolean }
}) {
  const [showDetails, setShowDetails] = useState(false)

  const state: 'running' | 'success' | 'error' = !completion
    ? 'running'
    : completion.isError
      ? 'error'
      : 'success'

  const styles = {
    running: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20',
    success: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20',
    error: 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20',
  }[state]

  const iconColor = {
    running: 'text-amber-600 dark:text-amber-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-red-600 dark:text-red-400',
  }[state]

  const label = {
    running: '调用中',
    success: '已完成',
    error: '失败',
  }[state]

  return (
    <Card className={cn(styles)}>
      <CardContent className="space-y-1 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          {state === 'running' && <Loader2 className={cn('size-3.5 animate-spin', iconColor)} />}
          {state === 'success' && <Check className={cn('size-3.5', iconColor)} />}
          {state === 'error' && <XCircle className={cn('size-3.5', iconColor)} />}
          <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] dark:bg-white/10">
            {toolName}
          </code>
          <span className="text-muted-foreground">·</span>
          <span className="font-medium">{label}</span>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
          >
            {showDetails ? '隐藏详情' : '详情'}
          </button>
        </div>

        {showDetails && (
          <div className="space-y-1 pt-1">
            <div>
              <div className="text-[10px] text-muted-foreground">参数</div>
              <pre className="overflow-x-auto rounded bg-black/5 px-2 py-1 text-[11px] dark:bg-white/5">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
            {completion && (
              <div>
                <div className="text-[10px] text-muted-foreground">
                  {completion.isError ? '错误' : '返回'}
                </div>
                <pre className="overflow-x-auto rounded bg-black/5 px-2 py-1 text-[11px] dark:bg-white/5">
                  {typeof completion.result === 'string'
                    ? completion.result
                    : JSON.stringify(completion.result, null, 2)}
                </pre>
              </div>
            )}
            <div className="font-mono text-[10px] text-muted-foreground">{callId}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── ArtifactRef ───────────────────────────────────────
function ArtifactRefPart({ artifactId }: { artifactId: string }) {
  const artifact = useAppStore((s) => s.artifacts[artifactId])
  const openPreview = useAppStore((s) => s.openArtifactPreview)

  if (!artifact) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Layers className="size-4" />
          <span>产物 {artifactId} 加载中</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <button
      type="button"
      onClick={() => openPreview(artifact.id)}
      className="block w-full text-left"
    >
      <Card className="cursor-pointer transition hover:border-primary/40 hover:shadow-sm">
        <CardContent className="flex items-start gap-3 px-3 py-2">
          <ArtifactIcon type={artifact.type} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{artifact.title}</div>
            <div className="text-xs text-muted-foreground">
              {artifact.type} · v{artifact.version} · 点击预览
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  )
}

function ArtifactIcon({ type }: { type: string }) {
  if (type === 'image') return <ImageIcon className="size-5 shrink-0 text-muted-foreground" />
  if (type === 'document') return <FileText className="size-5 shrink-0 text-muted-foreground" />
  return <Layers className="size-5 shrink-0 text-muted-foreground" />
}
