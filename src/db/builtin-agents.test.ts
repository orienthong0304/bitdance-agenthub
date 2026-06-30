import { describe, expect, it } from 'vitest'

import type { AdapterName } from '@/shared/types'

import { BUILTIN_AGENTS } from './builtin-agents'

const VALID_ADAPTERS: AdapterName[] = ['claude-code', 'codex', 'custom', 'mock']

describe('BUILTIN_AGENTS (写作编辑部)', () => {
  it('恰好 6 个角色，id 集合固定', () => {
    expect(BUILTIN_AGENTS).toHaveLength(6)
    const ids = BUILTIN_AGENTS.map((a) => a.id).sort()
    expect(ids).toEqual(
      ['ag_designer', 'ag_frontend', 'ag_orchestrator', 'ag_pm', 'ag_researcher', 'ag_reviewer'].sort(),
    )
  })

  it('恰好一个 Orchestrator，且是 ag_orchestrator', () => {
    const orchestrators = BUILTIN_AGENTS.filter((a) => a.isOrchestrator)
    expect(orchestrators).toHaveLength(1)
    expect(orchestrators[0].id).toBe('ag_orchestrator')
  })

  it('资料研究员走 claude-code adapter；其余走 custom', () => {
    const researcher = BUILTIN_AGENTS.find((a) => a.id === 'ag_researcher')!
    expect(researcher.adapterName).toBe('claude-code')
    expect(researcher.modelProvider).toBe('anthropic')
    expect(researcher.modelId).toBe('claude-sonnet-4-6')
    for (const a of BUILTIN_AGENTS) {
      if (a.id === 'ag_researcher') continue
      expect(a.adapterName).toBe('custom')
    }
  })

  it('所有 adapterName 合法，关键字段非空', () => {
    for (const a of BUILTIN_AGENTS) {
      expect(VALID_ADAPTERS).toContain(a.adapterName)
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.avatar.length).toBeGreaterThan(0)
      expect(a.description.length).toBeGreaterThan(0)
      expect(a.systemPrompt.length).toBeGreaterThan(0)
      expect(a.isBuiltin).toBe(true)
    }
  })

  it('研究员不带 plan_tasks（非计划阶段），但能写产物', () => {
    const researcher = BUILTIN_AGENTS.find((a) => a.id === 'ag_researcher')!
    expect(researcher.toolNames).not.toContain('plan_tasks')
    expect(researcher.toolNames).toContain('write_artifact')
    // 原生 WebSearch/WebFetch 不在 toolNames 里（由 claude-code adapter 默认放行）
    expect(researcher.toolNames).not.toContain('WebSearch')
    expect(researcher.toolNames).not.toContain('WebFetch')
  })

  it('主笔与润色编辑用质量更高的 deepseek-v4', () => {
    const writer = BUILTIN_AGENTS.find((a) => a.id === 'ag_frontend')!
    const editor = BUILTIN_AGENTS.find((a) => a.id === 'ag_designer')!
    expect(writer.modelId).toBe('deepseek-v4')
    expect(editor.modelId).toBe('deepseek-v4')
  })

  it('其余角色用 deepseek-v4-flash', () => {
    const orch = BUILTIN_AGENTS.find((a) => a.id === 'ag_orchestrator')!
    const planner = BUILTIN_AGENTS.find((a) => a.id === 'ag_pm')!
    const reviewer = BUILTIN_AGENTS.find((a) => a.id === 'ag_reviewer')!
    expect(orch.modelId).toBe('deepseek-v4-flash')
    expect(planner.modelId).toBe('deepseek-v4-flash')
    expect(reviewer.modelId).toBe('deepseek-v4-flash')
  })

  it('Orchestrator prompt 含写作链标记（迁移幂等性依赖）', () => {
    const orch = BUILTIN_AGENTS.find((a) => a.id === 'ag_orchestrator')!
    expect(orch.systemPrompt).toContain('资料简报')
  })

  it('写作角色不含开发向工具（bash/fs_write/deploy）', () => {
    const devTools = ['bash', 'fs_write', 'deploy_artifact', 'deploy_workspace']
    for (const id of ['ag_frontend', 'ag_designer', 'ag_reviewer']) {
      const agent = BUILTIN_AGENTS.find((a) => a.id === id)!
      for (const t of devTools) {
        expect(agent.toolNames).not.toContain(t)
      }
    }
  })
})
