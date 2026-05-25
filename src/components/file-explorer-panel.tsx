'use client'

import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { workspaceListDir } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useActiveConversation, useAppStore } from '@/stores/app-store'

interface DirEntry {
  name: string
  isDirectory: boolean
  size?: number
}

interface DirNode {
  relPath: string
  loaded: boolean
  expanded: boolean
  entries?: DirEntry[]
  error?: string
}

/**
 * 右侧文件浏览器面板。
 *
 * - 与 ArtifactPreviewPanel 互斥（store.fileExplorerOpen / previewArtifactId 同时只能一个有效）
 * - 列出当前 conversation workspace 的文件树
 * - 点击文件夹展开 / 收起；点击文件打开为中间 tab（store.openFile）
 */
export function FileExplorerPanel() {
  const conv = useActiveConversation()
  const open = useAppStore((s) => s.fileExplorerOpen)
  const setFileExplorerOpen = useAppStore((s) => s.setFileExplorerOpen)
  const openFile = useAppStore((s) => s.openFile)

  // 树状态：以 relPath 为 key 记录该节点是否展开 + 已加载条目
  const [nodes, setNodes] = useState<Record<string, DirNode>>({})
  const [loadingRoot, setLoadingRoot] = useState(false)

  const loadDir = useCallback(
    async (relPath: string) => {
      if (!conv) return
      setNodes((prev) => ({
        ...prev,
        [relPath]: {
          ...(prev[relPath] ?? { relPath }),
          relPath,
          expanded: true,
          loaded: false,
        },
      }))
      try {
        const result = await workspaceListDir(conv.id, relPath)
        setNodes((prev) => ({
          ...prev,
          [relPath]: {
            relPath,
            loaded: true,
            expanded: true,
            entries: result.entries,
          },
        }))
      } catch (err) {
        setNodes((prev) => ({
          ...prev,
          [relPath]: {
            relPath,
            loaded: true,
            expanded: true,
            error: err instanceof Error ? err.message : String(err),
          },
        }))
      }
    },
    [conv],
  )

  const toggleDir = (relPath: string) => {
    setNodes((prev) => {
      const cur = prev[relPath]
      if (cur && cur.expanded) {
        return { ...prev, [relPath]: { ...cur, expanded: false } }
      }
      return prev
    })
    if (!nodes[relPath] || !nodes[relPath].loaded) {
      void loadDir(relPath)
    } else {
      // 重新展开
      setNodes((prev) => ({ ...prev, [relPath]: { ...prev[relPath], expanded: true } }))
    }
  }

  const refresh = useCallback(() => {
    if (!conv) return
    setNodes({})
    setLoadingRoot(true)
    void loadDir('').finally(() => setLoadingRoot(false))
  }, [conv, loadDir])

  // 切换会话时清空 + 重新加载根；首次打开时同样加载
  useEffect(() => {
    if (!open || !conv) return
    setNodes({})
    setLoadingRoot(true)
    void loadDir('').finally(() => setLoadingRoot(false))
  }, [open, conv?.id, loadDir])

  if (!open || !conv) return null

  return (
    <aside className="flex w-80 min-w-[260px] shrink-0 flex-col border-l bg-card max-md:fixed max-md:inset-0 max-md:z-40 max-md:w-full max-md:min-w-0">
      <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">文件</span>
          <span className="truncate font-mono text-[10px] text-muted-foreground" title={conv.workspaceBoundPath ?? ''}>
            {conv.workspaceMode === 'local'
              ? (conv.workspaceBoundPath ?? '').split(/[\\/]/).pop()
              : '沙箱'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="icon" variant="ghost" onClick={refresh} title="刷新" disabled={loadingRoot}>
            <RefreshCw className={cn('size-4', loadingRoot && 'animate-spin')} />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setFileExplorerOpen(false)} title="关闭">
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1">
          <DirTreeNode
            relPath=""
            indent={0}
            nodes={nodes}
            onToggleDir={toggleDir}
            onOpenFile={(p) => openFile(conv.id, p)}
          />
        </div>
      </ScrollArea>
    </aside>
  )
}

function DirTreeNode({
  relPath,
  indent,
  nodes,
  onToggleDir,
  onOpenFile,
}: {
  relPath: string
  indent: number
  nodes: Record<string, DirNode>
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const node = nodes[relPath]
  if (!node) return null

  return (
    <>
      {/* root 自身不渲染行，从子条目开始 */}
      {node.expanded && (
        <>
          {!node.loaded && (
            <div
              className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: 12 + indent * 14 }}
            >
              <Loader2 className="size-3 animate-spin" />
              加载中...
            </div>
          )}
          {node.error && (
            <div
              className="px-3 py-1 text-xs text-red-600"
              style={{ paddingLeft: 12 + indent * 14 }}
            >
              {node.error}
            </div>
          )}
          {node.entries?.length === 0 && (
            <div
              className="px-3 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: 12 + indent * 14 }}
            >
              (空)
            </div>
          )}
          {node.entries?.map((e) => {
            const childPath = relPath === '' ? e.name : `${relPath}/${e.name}`
            const childNode = nodes[childPath]
            if (e.isDirectory) {
              const expanded = !!childNode?.expanded
              return (
                <div key={childPath}>
                  <button
                    type="button"
                    onClick={() => onToggleDir(childPath)}
                    className="flex w-full items-center gap-1 px-3 py-1 text-left text-xs hover:bg-accent"
                    style={{ paddingLeft: 12 + indent * 14 }}
                  >
                    {expanded ? (
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    {expanded ? (
                      <FolderOpen className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    ) : (
                      <Folder className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    )}
                    <span className="truncate">{e.name}</span>
                  </button>
                  {expanded && (
                    <DirTreeNode
                      relPath={childPath}
                      indent={indent + 1}
                      nodes={nodes}
                      onToggleDir={onToggleDir}
                      onOpenFile={onOpenFile}
                    />
                  )}
                </div>
              )
            }
            return (
              <button
                key={childPath}
                type="button"
                onClick={() => onOpenFile(childPath)}
                className="flex w-full items-center gap-1 px-3 py-1 text-left text-xs hover:bg-accent"
                style={{ paddingLeft: 12 + indent * 14 + 14 }}
              >
                <File className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{e.name}</span>
              </button>
            )
          })}
        </>
      )}
    </>
  )
}
