'use client'

import { Download, FolderOpen, GitBranch, Loader2, Package, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { deleteSkillPackage, fetchSkillPackages, importSkillPackage } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { SkillPackage } from '@/shared/types'

type ImportMode = 'github' | 'local'

/**
 * Agent Skills 技能包浏览 / 导入面板。
 *
 * 列出已安装的包（builtin + imported）与各自包含的 skill；支持从 GitHub 仓库
 * clone 或本地目录导入新包（install-only，绝不执行包内容），imported 包可移除。
 */
export function SkillLibraryDialog({
  open,
  onOpenChange,
  onPackagesChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 导入 / 删除成功后通知外层刷新技能列表 */
  onPackagesChanged?: (packages: SkillPackage[]) => void
}) {
  const [packages, setPackages] = useState<SkillPackage[]>([])
  const [loading, setLoading] = useState(false)
  const [importMode, setImportMode] = useState<ImportMode>('github')
  const [importSource, setImportSource] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const pkgs = await fetchSkillPackages()
      setPackages(pkgs)
      onPackagesChanged?.(pkgs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [onPackagesChanged])

  useEffect(() => {
    if (!open) return
    setError(null)
    setImportSource('')
    void reload()
  }, [open, reload])

  const handleImport = async () => {
    const source = importSource.trim()
    if (!source || importing) return
    setImporting(true)
    setError(null)
    try {
      await importSkillPackage(importMode === 'github' ? { gitUrl: source } : { localPath: source })
      setImportSource('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (pkg: SkillPackage) => {
    setError(null)
    try {
      await deleteSkillPackage(pkg.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">技能包管理</DialogTitle>
          <DialogDescription>
            浏览已安装的 Agent Skills 技能包，或从 GitHub / 本地目录导入新包。技能仅对 Claude Code
            agent 生效。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {/* 导入区 */}
          <div className="space-y-2 rounded-md border px-3 py-2.5">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setImportMode('github')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition hover:border-foreground/30 hover:bg-muted/60',
                  importMode === 'github' && 'border-primary bg-primary/5',
                )}
              >
                <GitBranch className="size-3" />
                GitHub 仓库
              </button>
              <button
                type="button"
                onClick={() => setImportMode('local')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition hover:border-foreground/30 hover:bg-muted/60',
                  importMode === 'local' && 'border-primary bg-primary/5',
                )}
              >
                <FolderOpen className="size-3" />
                本地目录
              </button>
            </div>
            <div className="flex gap-2">
              <Input
                value={importSource}
                onChange={(e) => setImportSource(e.target.value)}
                placeholder={
                  importMode === 'github'
                    ? 'https://github.com/<owner>/<repo>'
                    : '/absolute/path/to/skill-package'
                }
                className="h-9 flex-1 font-mono text-xs focus:border-primary"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleImport()
                }}
              />
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => void handleImport()}
                disabled={importing || !importSource.trim()}
              >
                {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                导入
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              导入只做文件拷贝与 SKILL.md 校验，不会执行包内容；技能运行时的命令仍走 AgentHub
              审批与沙箱。
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}

          {/* 包列表 */}
          {loading && packages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              加载技能包…
            </div>
          ) : packages.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              还没有安装任何技能包
            </div>
          ) : (
            packages.map((pkg) => (
              <div key={pkg.id} className="rounded-md border px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Package className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-medium">{pkg.name}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium',
                        pkg.source === 'builtin'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {pkg.source === 'builtin' ? '内置' : '已导入'}
                    </span>
                  </div>
                  {pkg.source === 'imported' && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(pkg)}
                      className="shrink-0 rounded-[7px] p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      title="移除技能包"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {pkg.sourceRef}
                </div>
                <div className="mt-1.5 space-y-1">
                  {pkg.skills.map((s) => (
                    <div key={s.qualifiedName} className="rounded bg-muted/40 px-2 py-1.5">
                      <code className="font-mono text-[11px] font-medium">{s.name}</code>
                      <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                        {s.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
