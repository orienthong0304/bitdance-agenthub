'use client'

import { FileText, Image as ImageIcon, Layers, Loader2, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { deleteArtifact, fetchArtifact, fetchArtifacts, type ArtifactListItem } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

/**
 * ArtifactLibrary — 全局产物库视图，挂在 Sidebar 内（mode='artifacts' 时显示）。
 *
 * 数据源是 /api/artifacts（轻量 meta），点击某项时按需 fetch 完整 content
 * 然后调用 openArtifactPreview 触发右侧预览。
 */
export function ArtifactLibrary() {
  const [items, setItems] = useState<ArtifactListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [pendingPreviewId, setPendingPreviewId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const upsertArtifact = useAppStore((s) => s.upsertArtifact)
  const openArtifactPreview = useAppStore((s) => s.openArtifactPreview)
  const removeArtifact = useAppStore((s) => s.removeArtifact)

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await fetchArtifacts()
      setItems(list)
    } catch (err) {
      console.error('[ArtifactLibrary] load failed', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((a) => {
      const hay = `${a.title} ${a.type} ${a.conversationTitle ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [items, query])

  const openPreview = async (id: string) => {
    setPendingPreviewId(id)
    try {
      const full = await fetchArtifact(id)
      upsertArtifact(full)
      openArtifactPreview(id)
    } catch (err) {
      console.error('[ArtifactLibrary] preview load failed', err)
    } finally {
      setPendingPreviewId(null)
    }
  }

  const deleteTarget = deleteTargetId ? items.find((a) => a.id === deleteTargetId) : null

  const confirmDelete = async () => {
    if (!deleteTargetId) return
    setDeleting(true)
    try {
      await deleteArtifact(deleteTargetId)
      removeArtifact(deleteTargetId)
      setItems((arr) => arr.filter((a) => a.id !== deleteTargetId))
      setDeleteTargetId(null)
    } catch (err) {
      console.error('[ArtifactLibrary] delete failed', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 搜索 */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索产物..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {loading ? '加载中…' : `共 ${items.length} 个 · 显示 ${filtered.length} 个`}
        </div>
      </div>

      {/* 列表 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 px-2 pb-2">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <Loader2 className="mr-2 size-3 animate-spin" /> 加载中
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {items.length === 0 ? '还没有产物' : '没有匹配项'}
            </div>
          ) : (
            filtered.map((a) => {
              const isPending = pendingPreviewId === a.id
              return (
                <div
                  key={a.id}
                  className="group flex w-full items-start gap-2 rounded-md px-2 py-2 transition hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => void openPreview(a.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    disabled={isPending}
                  >
                    <TypeIcon type={a.type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{a.title}</span>
                        {isPending && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        <span className="font-mono">{a.type}</span>
                        <span className="mx-1">·</span>
                        {formatTime(a.createdAt)}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {a.conversationTitle ?? '（无会话）'}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTargetId(a.id)
                    }}
                    title="删除产物"
                    className={cn(
                      'shrink-0 self-center opacity-0 transition group-hover:opacity-100 hover:text-red-600',
                    )}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      {/* 删除确认 */}
      <Dialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除产物</DialogTitle>
            <DialogDescription>
              确定删除「{deleteTarget?.title}」吗？聊天里指向该产物的卡片将不再可预览。该操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>
              取消
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? '删除中...' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TypeIcon({ type }: { type: string }) {
  const className = 'mt-0.5 size-4 shrink-0 text-muted-foreground'
  if (type === 'image') return <ImageIcon className={className} />
  if (type === 'document') return <FileText className={className} />
  return <Layers className={className} />
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
