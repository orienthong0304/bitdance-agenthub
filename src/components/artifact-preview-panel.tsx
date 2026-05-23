'use client'

import { ChevronRight, Code, Eye, FileText, Image as ImageIcon, Layers, X } from 'lucide-react'
import { useState } from 'react'

import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ArtifactRow } from '@/db/schema'
import { cn } from '@/lib/utils'
import type { ArtifactContent } from '@/shared/types'
import { useAppStore } from '@/stores/app-store'

/**
 * ArtifactPreviewPanel — 右侧滑入的产物预览面板。
 *
 * 由 store.previewArtifactId 控制显隐。按 artifact.type 分发到不同 view。
 */
export function ArtifactPreviewPanel() {
  const id = useAppStore((s) => s.previewArtifactId)
  const artifact = useAppStore((s) => (id ? s.artifacts[id] : null))
  const close = useAppStore((s) => s.closeArtifactPreview)

  if (!id || !artifact) return null

  return (
    <aside className="flex w-1/2 min-w-[420px] shrink-0 flex-col border-l bg-card">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <TypeIcon type={artifact.type} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{artifact.title}</div>
            <div className="text-xs text-muted-foreground">
              {artifact.type} · v{artifact.version}
            </div>
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={close} title="关闭预览">
          <X className="size-4" />
        </Button>
      </header>

      <ArtifactView artifact={artifact} />
    </aside>
  )
}

// ─── 调度 ──────────────────────────────────────────────
function ArtifactView({ artifact }: { artifact: ArtifactRow }) {
  const content = artifact.content as ArtifactContent

  switch (content.type) {
    case 'web_app':
      return <WebAppView content={content} />
    case 'document':
      return <DocumentView content={content} />
    case 'image':
      return <ImageView content={content} />
    case 'code_file':
      return <CodeFileView content={content} />
    case 'diff':
      return (
        <Empty>
          Diff 视图开发中。当前 artifact 类型: {content.type}
        </Empty>
      )
    default:
      return <Empty>该类型暂不支持预览</Empty>
  }
}

// ─── web_app: iframe + 源码 ───────────────────────────
function WebAppView({ content }: { content: Extract<ArtifactContent, { type: 'web_app' }> }) {
  const [view, setView] = useState<'render' | 'source'>('render')
  const [activeFile, setActiveFile] = useState<string>(content.entry)

  const fileNames = Object.keys(content.files)
  const html = buildIframeHtml(content.files, content.entry)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-2">
        <div className="flex">
          <ViewTab active={view === 'render'} onClick={() => setView('render')}>
            <Eye className="size-3.5" />
            预览
          </ViewTab>
          <ViewTab active={view === 'source'} onClick={() => setView('source')}>
            <Code className="size-3.5" />
            源码
          </ViewTab>
        </div>
        {view === 'source' && fileNames.length > 1 && (
          <select
            value={activeFile}
            onChange={(e) => setActiveFile(e.target.value)}
            className="rounded border bg-background px-2 py-0.5 text-xs"
          >
            {fileNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {view === 'render' ? (
          <iframe
            key={html.length}
            srcDoc={html}
            sandbox="allow-scripts"
            className="size-full border-0 bg-white"
            title="Artifact preview"
          />
        ) : (
          <ScrollArea className="size-full">
            <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
              <code>{content.files[activeFile] ?? ''}</code>
            </pre>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}

// ─── document ──────────────────────────────────────────
function DocumentView({
  content,
}: {
  content: Extract<ArtifactContent, { type: 'document' }>
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <Markdown>{content.content}</Markdown>
      </div>
    </ScrollArea>
  )
}

// ─── image ─────────────────────────────────────────────
function ImageView({ content }: { content: Extract<ArtifactContent, { type: 'image' }> }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={content.url}
        alt={content.alt}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}

// ─── code_file（workspace 文件，目前先 readonly 显示）───
function CodeFileView({
  content,
}: {
  content: Extract<ArtifactContent, { type: 'code_file' }>
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="font-mono">{content.workspacePath}</span>
        <span className="ml-2">· {content.language}</span>
        <span className="ml-2">· {(content.sizeBytes / 1024).toFixed(1)} KB</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-3 text-xs text-muted-foreground">
          需要从 workspace 加载文件内容才能渲染（P1）
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── 共享小组件 ───────────────────────────────────────
function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-2">
        <ChevronRight className="size-5" />
        <div>{children}</div>
      </div>
    </div>
  )
}

function TypeIcon({ type }: { type: string }) {
  if (type === 'image') return <ImageIcon className="size-4 text-muted-foreground" />
  if (type === 'document') return <FileText className="size-4 text-muted-foreground" />
  return <Layers className="size-4 text-muted-foreground" />
}

// ─── iframe HTML 构造 ────────────────────────────────
function buildIframeHtml(files: Record<string, string>, entry: string): string {
  const html = files[entry] ?? files['index.html'] ?? ''
  const css = files['style.css'] ?? files['styles.css'] ?? ''
  const js = files['script.js'] ?? files['main.js'] ?? files['app.js'] ?? ''

  const styleTag = css ? `<style>\n${css}\n</style>` : ''
  // JSON.stringify 把代码作为字符串塞进 <script>，避免里面出现 </script> 把外层标签提前关掉
  const scriptTag = js
    ? `<script>(function(){\n${js}\n})();<` + '/script>'
    : ''

  // 如果是完整 HTML 文档，在 </head> 前插 style，</body> 前插 script
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${styleTag}\n</head>`).replace(/<\/body>/i, `${scriptTag}\n</body>`)
  }

  // 片段：包一层完整文档
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    styleTag,
    '</head>',
    '<body>',
    html,
    scriptTag,
    '</body>',
    '</html>',
  ].join('\n')
}
