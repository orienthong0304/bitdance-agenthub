'use client'

import { AlertCircle, ChevronLeft, ChevronRight, Clock, Code, Copy, Download, ExternalLink, Eye, FileCode, FileText, GitCompare, History, Image as ImageIcon, Layers, Loader2, Maximize, Pencil, Presentation, RefreshCw, RotateCcw, Save, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'

import { CodeBlock } from '@/components/code-block'
import { buildDiffStyles } from '@/components/diff-viewer-styles'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ArtifactRow } from '@/db/schema'
import { createArtifactVersion, fetchArtifactVersions, workspaceReadFile, workspaceWriteFile } from '@/lib/api'
import { artifactPreviewPath } from '@/lib/artifact-preview'
import { normalizeLang } from '@/lib/highlighter'
import { cn } from '@/lib/utils'
import type { ArtifactContent, DiffHunk, PptSlide } from '@/shared/types'
import { useAppStore } from '@/stores/app-store'

// 编辑器仅在用户点「编辑」时懒加载（重型 client 库；CodeMirror 无 worker、离线 OK）
const ArtifactCodeEditor = dynamic(() => import('./artifact-code-editor'), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center p-4 text-xs text-muted-foreground">
      编辑器加载中…
    </div>
  ),
})

type SaveVersionFn = (rawContent: unknown, title?: string) => Promise<void>

/**
 * ArtifactPreviewPanel — 右侧滑入的产物预览面板。
 *
 * 由 store.previewArtifactId 控制显隐。按 artifact.type 分发到不同 view。
 * 顶部支持多版本切换：从同一个 root 派生的所有 artifact 通过 /versions API 查回。
 * web_app / document 支持面板内编辑并「提交为新版本」（POST /versions → createArtifactVersion）。
 */
export function ArtifactPreviewPanel() {
  const id = useAppStore((s) => s.previewArtifactId)
  const artifact = useAppStore((s) => (id ? s.artifacts[id] : null))
  const upsertArtifact = useAppStore((s) => s.upsertArtifact)
  const close = useAppStore((s) => s.closeArtifactPreview)
  const openPreview = useAppStore((s) => s.openArtifactPreview)

  const [versions, setVersions] = useState<ArtifactRow[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  // 切到新 artifact 时拉它的版本链
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setVersionsLoading(true)
    fetchArtifactVersions(id)
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        // 把新发现的兄弟版本灌到 store，方便下次切换不重拉
        for (const v of list) upsertArtifact(v)
      })
      .catch((err) => {
        if (!cancelled) console.warn('[ArtifactPreviewPanel] versions fetch failed', err)
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, upsertArtifact])

  const switchVersion = useCallback(
    (targetId: string) => {
      if (targetId !== id) openPreview(targetId)
    },
    [id, openPreview],
  )

  // 提交编辑后的内容为新版本，成功后切到新版本（版本条经 id effect 自动刷新）
  const handleSaveVersion = useCallback<SaveVersionFn>(
    async (rawContent, title) => {
      if (!id) return
      const row = await createArtifactVersion(id, { content: rawContent, title })
      upsertArtifact(row)
      openPreview(row.id)
    },
    [id, upsertArtifact, openPreview],
  )

  if (!id || !artifact) return null

  const versionCount = versions?.length ?? 0
  const hasMultiple = versionCount > 1

  return (
    <aside className="flex w-1/2 min-w-[420px] shrink-0 flex-col border-l bg-card max-md:fixed max-md:inset-0 max-md:z-40 max-md:w-full max-md:min-w-0">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <TypeIcon type={artifact.type} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{artifact.title}</div>
            <div className="text-xs text-muted-foreground">
              {artifact.type} · v{artifact.version}
              {hasMultiple && ` / ${versionCount}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {hasMultiple && (
            <Button
              size="icon"
              variant={showVersions ? 'default' : 'ghost'}
              onClick={() => setShowVersions((v) => !v)}
              title={`版本历史 (${versionCount} 个)`}
            >
              <History className="size-4" />
            </Button>
          )}
          {artifact.type === 'web_app' && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => openPreviewInNewTab(artifact.id)}
                title="打开预览 URL"
              >
                <ExternalLink className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copyPreviewUrl(artifact.id)}
                title="复制预览 URL"
              >
                <Copy className="size-4" />
              </Button>
            </>
          )}
          <a
            href={`/api/artifacts/${artifact.id}/export`}
            download
            title={`下载${artifact.type === 'web_app' ? ' .zip' : artifact.type === 'document' ? ' .md' : ''}`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-foreground/70 transition hover:bg-muted hover:text-foreground"
          >
            <Download className="size-4" />
          </a>
          <Button size="icon" variant="ghost" onClick={close} title="关闭预览">
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {/* 版本切换条：展开时显示所有版本，点击切换 */}
      {showVersions && versions && versions.length > 0 && (
        <div className="shrink-0 border-b bg-muted/20 px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            版本历史
          </div>
          <div className="flex flex-wrap gap-1">
            {versions.map((v) => {
              const isCurrent = v.id === id
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => switchVersion(v.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition',
                    isCurrent
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent hover:border-foreground/20 hover:bg-accent',
                  )}
                  title={`v${v.version} · ${new Date(v.createdAt).toLocaleString('zh-CN')}`}
                >
                  <span className="font-mono">v{v.version}</span>
                  <span className="text-muted-foreground">·</span>
                  <Clock className="size-2.5" />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {new Date(v.createdAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              )
            })}
          </div>
          {versionsLoading && (
            <div className="mt-1 text-[10px] text-muted-foreground">加载中…</div>
          )}
        </div>
      )}

      <ArtifactView artifact={artifact} onSaveVersion={handleSaveVersion} />
    </aside>
  )
}

// ─── 调度 ──────────────────────────────────────────────
function ArtifactView({
  artifact,
  onSaveVersion,
}: {
  artifact: ArtifactRow
  onSaveVersion: SaveVersionFn
}) {
  const content = artifact.content as ArtifactContent

  // 用 data-selection-target 标记容器：SelectionPopover 会响应这里的文字选择
  const wrap = (children: React.ReactNode) => (
    <div
      data-selection-target="artifact"
      data-selection-label={`产物「${artifact.title}」 v${artifact.version}`}
      data-selection-artifact-id={artifact.id}
      className="contents"
    >
      {children}
    </div>
  )

  switch (content.type) {
    case 'web_app':
      return wrap(<WebAppView artifactId={artifact.id} content={content} onSaveVersion={onSaveVersion} />)
    case 'document':
      return wrap(<DocumentView content={content} onSaveVersion={onSaveVersion} />)
    case 'image':
      return <ImageView content={content} />
    case 'code_file':
      return wrap(
        <CodeFileView
          artifactId={artifact.id}
          conversationId={artifact.conversationId}
          content={content}
          onSaveVersion={onSaveVersion}
        />,
      )
    case 'diff':
      return wrap(<DiffArtifactView content={content} />)
    case 'ppt':
      return wrap(<SlideDeckView content={content} onSaveVersion={onSaveVersion} />)
    default:
      return <Empty>该类型暂不支持预览</Empty>
  }
}

// ─── web_app: iframe + 源码 + 编辑 ─────────────────────
function WebAppView({
  artifactId,
  content,
  onSaveVersion,
}: {
  artifactId: string
  content: Extract<ArtifactContent, { type: 'web_app' }>
  onSaveVersion: SaveVersionFn
}) {
  const [view, setView] = useState<'render' | 'source' | 'edit'>('render')
  const [activeFile, setActiveFile] = useState<string>(content.entry)
  const [draftFiles, setDraftFiles] = useState<Record<string, string>>(content.files)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileNames = Object.keys(content.files)

  // 切版本/产物（content 每行是新对象）时重置编辑态
  useEffect(() => {
    setDraftFiles(content.files)
    setActiveFile(content.entry)
    setView('render')
    setSaving(false)
    setError(null)
  }, [content])

  const dirty = useMemo(
    () => JSON.stringify(draftFiles) !== JSON.stringify(content.files),
    [draftFiles, content.files],
  )

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSaveVersion({ files: draftFiles, entry: content.entry })
      // 成功后面板切到新版本，本视图随 content 变化自动重置
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败')
      setSaving(false)
    }
  }

  const showFilePicker = (view === 'source' || view === 'edit') && fileNames.length > 1

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
          <ViewTab active={view === 'edit'} onClick={() => setView('edit')}>
            <Pencil className="size-3.5" />
            编辑
          </ViewTab>
        </div>
        {showFilePicker && (
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
        {view === 'render' && (
          <iframe
            key={artifactId}
            src={artifactPreviewPath(artifactId)}
            sandbox="allow-scripts"
            className="size-full border-0 bg-white"
            title="Artifact preview"
          />
        )}
        {view === 'source' && (
          <ScrollArea className="size-full">
            <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
              <code>{content.files[activeFile] ?? ''}</code>
            </pre>
          </ScrollArea>
        )}
        {view === 'edit' && (
          <ArtifactCodeEditor
            value={draftFiles[activeFile] ?? ''}
            onChange={(next) => setDraftFiles((d) => ({ ...d, [activeFile]: next }))}
            filename={activeFile}
            type="web_app"
          />
        )}
      </div>

      {view === 'edit' && (
        <EditFooter
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={save}
          onReset={() => {
            setDraftFiles(content.files)
            setActiveFile(content.entry)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

// ─── document: 预览 + 编辑 ─────────────────────────────
function DocumentView({
  content,
  onSaveVersion,
}: {
  content: Extract<ArtifactContent, { type: 'document' }>
  onSaveVersion: SaveVersionFn
}) {
  const [view, setView] = useState<'render' | 'edit'>('render')
  const [draft, setDraft] = useState(content.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(content.content)
    setView('render')
    setSaving(false)
    setError(null)
  }, [content])

  const dirty = draft !== content.content

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSaveVersion({ content: draft })
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败')
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b px-2">
        <ViewTab active={view === 'render'} onClick={() => setView('render')}>
          <Eye className="size-3.5" />
          预览
        </ViewTab>
        <ViewTab active={view === 'edit'} onClick={() => setView('edit')}>
          <Pencil className="size-3.5" />
          编辑
        </ViewTab>
      </div>
      <div className="min-h-0 flex-1">
        {view === 'render' ? (
          <ScrollArea className="size-full">
            <div className="mx-auto max-w-3xl px-6 py-6">
              <Markdown>{content.content}</Markdown>
            </div>
          </ScrollArea>
        ) : (
          <ArtifactCodeEditor value={draft} onChange={setDraft} filename="document.md" type="document" />
        )}
      </div>
      {view === 'edit' && (
        <EditFooter
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={save}
          onReset={() => {
            setDraft(content.content)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

// ─── ppt: 幻灯片分页预览 + JSON 编辑 ────────────────────
function SlideDeckView({
  content,
  onSaveVersion,
}: {
  content: Extract<ArtifactContent, { type: 'ppt' }>
  onSaveVersion: SaveVersionFn
}) {
  const serialized = useMemo(() => JSON.stringify(content, null, 2), [content])
  const [view, setView] = useState<'render' | 'edit'>('render')
  const [idx, setIdx] = useState(0)
  const [draft, setDraft] = useState(serialized)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIdx(0)
    setDraft(serialized)
    setView('render')
    setSaving(false)
    setError(null)
  }, [serialized])

  const total = content.slides.length
  const safeIdx = Math.min(idx, Math.max(0, total - 1))
  const current = content.slides[safeIdx]
  const dirty = draft !== serialized

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSaveVersion(JSON.parse(draft))
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败（请检查 JSON 格式）')
      setSaving(false)
    }
  }

  const enterFullscreen = () => {
    const el = containerRef.current
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {})
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center border-b px-2">
        <ViewTab active={view === 'render'} onClick={() => setView('render')}>
          <Eye className="size-3.5" />
          预览
        </ViewTab>
        <ViewTab active={view === 'edit'} onClick={() => setView('edit')}>
          <Pencil className="size-3.5" />
          编辑 JSON
        </ViewTab>
        {view === 'render' && total > 0 && (
          <div className="ml-auto flex items-center gap-1 pr-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={safeIdx <= 0}
              title="上一页"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {safeIdx + 1} / {total}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              disabled={safeIdx >= total - 1}
              title="下一页"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={enterFullscreen}
              title="全屏"
            >
              <Maximize className="size-4" />
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {view === 'render' ? (
          <div ref={containerRef} className="size-full bg-zinc-100 dark:bg-zinc-900">
            {current ? (
              <SlideView slide={current} deckTitle={content.title} />
            ) : (
              <Empty>没有幻灯片</Empty>
            )}
          </div>
        ) : (
          <ArtifactCodeEditor value={draft} onChange={setDraft} filename="slides.json" type="ppt" />
        )}
      </div>
      {view === 'edit' && (
        <EditFooter
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={save}
          onReset={() => {
            setDraft(serialized)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

function SlideView({ slide, deckTitle }: { slide: PptSlide; deckTitle?: string }) {
  const layout = slide.layout ?? 'title-bullets'
  const centered = layout === 'title' || layout === 'section'
  const heading = slide.title ?? (centered ? deckTitle : undefined)
  return (
    <div className="flex size-full items-center justify-center p-6">
      <div className="aspect-video w-full max-w-3xl overflow-hidden rounded-lg border bg-card shadow-sm">
        <div
          className={cn(
            'flex size-full flex-col gap-4 overflow-auto p-10',
            centered && 'items-center justify-center text-center',
          )}
        >
          {heading && (
            <h2 className={cn('font-semibold text-foreground', centered ? 'text-3xl' : 'text-2xl')}>
              {heading}
            </h2>
          )}
          {!centered && slide.bullets && slide.bullets.length > 0 && (
            <ul className="list-disc space-y-2 pl-6 text-base leading-relaxed text-foreground/90">
              {slide.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
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

// ─── code_file（workspace 文件引用）──────────────────────
function CodeFileView({
  artifactId,
  conversationId,
  content,
  onSaveVersion,
}: {
  artifactId: string
  conversationId: string
  content: Extract<ArtifactContent, { type: 'code_file' }>
  onSaveVersion: SaveVersionFn
}) {
  const [view, setView] = useState<'source' | 'edit'>('source')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fileContent, setFileContent] = useState('')
  const [draft, setDraft] = useState('')
  const [size, setSize] = useState(content.sizeBytes)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await workspaceReadFile(conversationId, content.workspacePath)
      setFileContent(result.content)
      setDraft(result.content)
      setSize(result.size)
      setTruncated(result.truncated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setSaving(false)
    }
  }, [conversationId, content.workspacePath])

  useEffect(() => {
    setView('source')
    void reload()
  }, [artifactId, reload])

  const language = normalizeLang(content.language || guessLanguage(content.workspacePath))
  const dirty = draft !== fileContent

  const save = async () => {
    if (!dirty || saving || truncated) return
    setSaving(true)
    setError(null)
    try {
      await workspaceWriteFile(conversationId, content.workspacePath, draft)
      const bytes = new TextEncoder().encode(draft)
      await onSaveVersion({
        workspacePath: content.workspacePath,
        language,
        sizeBytes: bytes.byteLength,
        checksum: await sha256(bytes),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载 {content.workspacePath}...
      </div>
    )
  }

  if (error && !fileContent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="size-6 text-red-500" />
        <div className="text-sm font-medium">无法打开 workspace 文件</div>
        <div className="font-mono text-xs text-muted-foreground">{error}</div>
        <Button size="sm" variant="outline" onClick={() => void reload()}>
          <RefreshCw className="mr-1 size-3.5" />
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-2">
        <div className="flex">
          <ViewTab active={view === 'source'} onClick={() => setView('source')}>
            <Eye className="size-3.5" />
            源码
          </ViewTab>
          <ViewTab active={view === 'edit'} onClick={() => setView('edit')}>
            <Pencil className="size-3.5" />
            编辑
          </ViewTab>
        </div>
        <Button size="icon" variant="ghost" onClick={() => void reload()} title="重新加载">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
        <code className="min-w-0 flex-1 truncate font-mono">{content.workspacePath}</code>
        <span className="font-mono text-[10px]">{language}</span>
        <span className="font-mono text-[10px]">{(size / 1024).toFixed(1)} KB</span>
        {truncated && (
          <span className="font-mono text-[10px] text-amber-600" title="文件已截断，不可保存">
            已截断
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {view === 'source' ? (
          <ScrollArea className="size-full">
            <div className="px-3 py-3">
              <CodeBlock code={fileContent} language={language} />
            </div>
          </ScrollArea>
        ) : (
          <ArtifactCodeEditor
            value={draft}
            onChange={setDraft}
            filename={content.workspacePath}
            type="code_file"
            readOnly={truncated}
          />
        )}
      </div>

      {view === 'edit' && (
        <EditFooter
          dirty={dirty && !truncated}
          saving={saving}
          error={error}
          onSave={save}
          onReset={() => {
            setDraft(fileContent)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

// ─── diff ───────────────────────────────────────────────
function DiffArtifactView({ content }: { content: Extract<ArtifactContent, { type: 'diff' }> }) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const diffStyles = useMemo(() => buildDiffStyles(isDark), [isDark])
  const pair = useMemo(() => diffHunksToTextPair(content.hunks), [content.hunks])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs">
        <GitCompare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">目标产物</span>
        <code className="min-w-0 flex-1 truncate font-mono">{content.targetArtifactId}</code>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 text-[10px]',
            content.applied
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}
        >
          {content.applied ? '已应用' : '未应用'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background pending-diff-body">
        <ReactDiffViewer
          oldValue={pair.oldText}
          newValue={pair.newText}
          splitView={true}
          useDarkTheme={isDark}
          compareMethod={DiffMethod.WORDS_WITH_SPACE}
          leftTitle="修改前"
          rightTitle="修改后"
          styles={diffStyles}
        />
      </div>
    </div>
  )
}

// ─── 共享小组件 ───────────────────────────────────────
function EditFooter({
  dirty,
  saving,
  error,
  onSave,
  onReset,
}: {
  dirty: boolean
  saving: boolean
  error: string | null
  onSave: () => void
  onReset: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
      <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
        <Save className="size-3.5" />
        {saving ? '提交中…' : '提交为新版本'}
      </Button>
      <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={onReset}>
        <RotateCcw className="size-3.5" />
        重置
      </Button>
      {error ? (
        <span className="truncate text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {dirty ? '已修改 · 提交将创建新版本' : '编辑后提交为新版本'}
        </span>
      )}
    </div>
  )
}

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
  if (type === 'code_file') return <FileCode className="size-4 text-muted-foreground" />
  if (type === 'diff') return <GitCompare className="size-4 text-muted-foreground" />
  if (type === 'ppt') return <Presentation className="size-4 text-muted-foreground" />
  return <Layers className="size-4 text-muted-foreground" />
}

function openPreviewInNewTab(artifactId: string): void {
  window.open(artifactPreviewPath(artifactId), '_blank', 'noopener,noreferrer')
}

function copyPreviewUrl(artifactId: string): void {
  const url = new URL(artifactPreviewPath(artifactId), window.location.origin).toString()
  navigator.clipboard?.writeText(url).catch(() => {})
}

function diffHunksToTextPair(hunks: DiffHunk[]): { oldText: string; newText: string } {
  const oldLines: string[] = []
  const newLines: string[] = []

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('\\ No newline') || isUnifiedDiffMetadataLine(line)) continue
      if (line.startsWith('+')) {
        newLines.push(line.slice(1))
      } else if (line.startsWith('-')) {
        oldLines.push(line.slice(1))
      } else if (line.startsWith(' ')) {
        const text = line.slice(1)
        oldLines.push(text)
        newLines.push(text)
      } else {
        oldLines.push(line)
        newLines.push(line)
      }
    }
  }

  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') }
}

function isUnifiedDiffMetadataLine(line: string): boolean {
  return /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(line)
}

function guessLanguage(filePath: string): string {
  return normalizeLang(filePath.split('.').pop()?.toLowerCase() ?? '')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return `size:${bytes.byteLength}`
  }
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
