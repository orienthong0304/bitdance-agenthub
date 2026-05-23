'use client'

import { useState } from 'react'

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
import { Textarea } from '@/components/ui/textarea'
import { createAgent, type CreateAgentBody } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

type Provider = 'deepseek' | 'anthropic' | 'openai'

const PROVIDER_DEFAULTS: Record<Provider, { label: string; defaultModel: string }> = {
  deepseek: { label: 'DeepSeek', defaultModel: 'deepseek-chat' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-opus-4-7' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o' },
}

const AVAILABLE_TOOLS = ['write_artifact', 'read_artifact'] as const

export function CreateAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const upsertAgent = useAppStore((s) => s.upsertAgent)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [capabilitiesText, setCapabilitiesText] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [provider, setProvider] = useState<Provider>('deepseek')
  const [modelId, setModelId] = useState(PROVIDER_DEFAULTS.deepseek.defaultModel)
  const [toolNames, setToolNames] = useState<Set<string>>(
    new Set(['write_artifact', 'read_artifact']),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setName('')
    setDescription('')
    setCapabilitiesText('')
    setSystemPrompt('')
    setProvider('deepseek')
    setModelId(PROVIDER_DEFAULTS.deepseek.defaultModel)
    setToolNames(new Set(['write_artifact', 'read_artifact']))
    setError(null)
  }

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    setModelId(PROVIDER_DEFAULTS[p].defaultModel)
  }

  const toggleTool = (t: string) => {
    setToolNames((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const submit = async () => {
    if (submitting) return
    setError(null)

    const trimmed = name.trim()
    if (!trimmed) return setError('名称不能为空')
    if (!description.trim()) return setError('描述不能为空')
    if (!systemPrompt.trim()) return setError('System Prompt 不能为空')

    const body: CreateAgentBody = {
      name: trimmed,
      avatar: '',
      description: description.trim(),
      capabilities: capabilitiesText
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      systemPrompt: systemPrompt.trim(),
      modelProvider: provider,
      modelId: modelId.trim(),
      toolNames: Array.from(toolNames),
    }

    setSubmitting(true)
    try {
      const agent = await createAgent(body)
      upsertAgent(agent)
      resetForm()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建 Agent</DialogTitle>
          <DialogDescription>
            为这个 Agent 设定身份与能力。它会出现在新建对话的选择列表里。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-[80px_1fr] items-start gap-3">
            <Label required>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：TestBot"
            />
          </div>

          <div className="grid grid-cols-[80px_1fr] items-start gap-3">
            <Label required>描述</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话讲清楚它能做什么"
            />
          </div>

          <div className="grid grid-cols-[80px_1fr] items-start gap-3">
            <Label>能力标签</Label>
            <div>
              <Input
                value={capabilitiesText}
                onChange={(e) => setCapabilitiesText(e.target.value)}
                placeholder="testing, react, vitest"
              />
              <div className="mt-1 text-[10px] text-muted-foreground">用逗号或空格分隔</div>
            </div>
          </div>

          <div className="grid grid-cols-[80px_1fr] items-start gap-3">
            <Label required>System Prompt</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="你是…&#10;你的核心产出是…&#10;遵守以下原则…"
              className="min-h-[160px] font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-[80px_1fr] items-start gap-3">
            <Label>底层模型</Label>
            <div className="flex gap-2">
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as Provider)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {(Object.keys(PROVIDER_DEFAULTS) as Provider[]).map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_DEFAULTS[p].label}
                  </option>
                ))}
              </select>
              <Input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="model id"
                className="flex-1 font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-[80px_1fr] items-start gap-3">
            <Label>工具集</Label>
            <div className="space-y-1">
              {AVAILABLE_TOOLS.map((t) => (
                <label
                  key={t}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition hover:border-foreground/30',
                    toolNames.has(t) && 'border-primary bg-primary/5',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={toolNames.has(t)}
                    onChange={() => toggleTool(t)}
                    className="accent-primary"
                  />
                  <code className="font-mono text-xs">{t}</code>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div className="pt-2 text-xs text-muted-foreground">
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </div>
  )
}
