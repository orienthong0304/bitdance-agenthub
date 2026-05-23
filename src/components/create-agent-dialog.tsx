'use client'

import { useEffect, useState } from 'react'

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
import type { AgentRow } from '@/db/schema'
import {
  createAgent,
  updateAgent,
  type CreateAgentBody,
  type UpdateAgentBody,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

type Provider = 'deepseek' | 'anthropic' | 'openai' | 'volcano-ark'

const PROVIDER_DEFAULTS: Record<Provider, { label: string; defaultModel: string }> = {
  deepseek: { label: 'DeepSeek', defaultModel: 'deepseek-v4-flash' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-opus-4-7' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o' },
  'volcano-ark': { label: '火山方舟 (豆包)', defaultModel: 'doubao-seed-2-0-lite-260428' },
}

const AVAILABLE_TOOLS = ['write_artifact', 'read_artifact', 'read_attachment'] as const

/**
 * 创建 / 编辑 Agent 的对话框。
 *
 * 传入 `agent` 进入编辑模式，未传则为创建模式。两种模式公用同一套字段、
 * 同一套校验，只是 submit 路径与文案不同。
 */
export function CreateAgentDialog({
  open,
  onOpenChange,
  agent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent?: AgentRow
}) {
  const upsertAgent = useAppStore((s) => s.upsertAgent)
  const isEdit = !!agent

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [capabilitiesText, setCapabilitiesText] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [provider, setProvider] = useState<Provider>('deepseek')
  const [modelId, setModelId] = useState(PROVIDER_DEFAULTS.deepseek.defaultModel)
  const [toolNames, setToolNames] = useState<Set<string>>(
    new Set(['write_artifact', 'read_artifact', 'read_attachment']),
  )
  const [supportsVision, setSupportsVision] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每次打开 / 切换 agent 时，重置表单到该 agent 的当前值（或创建态的默认）。
  useEffect(() => {
    if (!open) return
    if (agent) {
      setName(agent.name)
      setDescription(agent.description)
      setCapabilitiesText(agent.capabilities.join(', '))
      setSystemPrompt(agent.systemPrompt)
      const p = (agent.modelProvider ?? 'deepseek') as Provider
      setProvider(p)
      setModelId(agent.modelId ?? PROVIDER_DEFAULTS[p].defaultModel)
      setToolNames(new Set(agent.toolNames))
      setSupportsVision(agent.supportsVision)
      setApiKey(agent.apiKey ?? '')
    } else {
      setName('')
      setDescription('')
      setCapabilitiesText('')
      setSystemPrompt('')
      setProvider('deepseek')
      setModelId(PROVIDER_DEFAULTS.deepseek.defaultModel)
      setToolNames(new Set(['write_artifact', 'read_artifact', 'read_attachment']))
      setSupportsVision(true)
      setApiKey('')
    }
    setShowApiKey(false)
    setError(null)
  }, [open, agent])

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    // 切换 provider 时把 modelId 自动重置到该 provider 的默认（避免跨家串）
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

    const capabilities = capabilitiesText
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    setSubmitting(true)
    try {
      if (isEdit && agent) {
        const patch: UpdateAgentBody = {
          name: trimmed,
          description: description.trim(),
          capabilities,
          systemPrompt: systemPrompt.trim(),
          modelProvider: provider,
          modelId: modelId.trim(),
          toolNames: Array.from(toolNames),
          supportsVision,
          apiKey: apiKey.trim() || null,
        }
        const updated = await updateAgent(agent.id, patch)
        upsertAgent(updated)
      } else {
        const body: CreateAgentBody = {
          name: trimmed,
          avatar: '',
          description: description.trim(),
          capabilities,
          systemPrompt: systemPrompt.trim(),
          modelProvider: provider,
          modelId: modelId.trim(),
          toolNames: Array.from(toolNames),
          supportsVision,
          apiKey: apiKey.trim() || undefined,
        }
        const created = await createAgent(body)
        upsertAgent(created)
      }
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
          <DialogTitle>{isEdit ? '编辑 Agent' : '创建 Agent'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改这个 Agent 的配置。保存后立即生效，已存在的会话也会用新配置回复。'
              : '为这个 Agent 设定身份与能力。它会出现在新建对话的选择列表里。'}
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

          <div className="grid grid-cols-[80px_1fr] items-start gap-3">
            <Label>API Key</Label>
            <div>
              <div className="flex gap-2">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="留空则使用环境变量"
                  className="flex-1 font-mono text-xs"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowApiKey((v) => !v)}
                >
                  {showApiKey ? '隐藏' : '显示'}
                </Button>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                填写后该 agent 优先用此 key；留空则 fallback 到{' '}
                <code className="font-mono">
                  {provider === 'deepseek'
                    ? 'DEEPSEEK_API_KEY'
                    : provider === 'volcano-ark'
                      ? 'ARK_API_KEY'
                      : provider === 'openai'
                        ? 'OPENAI_API_KEY'
                        : 'ANTHROPIC_API_KEY'}
                </code>{' '}
                环境变量
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[80px_1fr] items-start gap-3">
            <Label>视觉</Label>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition hover:border-foreground/30',
                supportsVision && 'border-primary bg-primary/5',
              )}
            >
              <input
                type="checkbox"
                checked={supportsVision}
                onChange={(e) => setSupportsVision(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <div className="min-w-0">
                <div className="text-xs font-medium">该模型支持视觉（多模态）</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  勾选后，发图片时会以 base64 注入 messages.content。模型不支持会被 API 拒绝 (400)，请确认你填的 modelId 真的支持视觉。
                </div>
              </div>
            </label>
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
            {submitting ? (isEdit ? '保存中...' : '创建中...') : isEdit ? '保存' : '创建'}
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
