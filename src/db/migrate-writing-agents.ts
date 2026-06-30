/**
 * 一次性迁移：把已有库里的开发角色内置 Agent 改写为写作编辑部角色，并补插资料研究员。
 *
 * 幂等：以 Orchestrator systemPrompt 是否含 WRITING_AGENTS_MARKER 作为「已迁移」标记。
 * source-of-truth 是 BUILTIN_AGENTS（builtin-agents.ts）。
 *
 * 全新库由 bootstrap 的 ensureBuiltinAgents 直接插入写作角色，此函数会因标记已存在而跳过。
 */
import type Database from 'better-sqlite3'

import { BUILTIN_AGENTS } from './builtin-agents'

/** 出现在写作版 Orchestrator systemPrompt 中、开发版没有的标记短语。 */
export const WRITING_AGENTS_MARKER = '资料简报'

export function rewriteBuiltinAgentsForWriting(sqlite: Database.Database): void {
  const orch = sqlite
    .prepare("SELECT system_prompt FROM agents WHERE id = 'ag_orchestrator'")
    .get() as { system_prompt: string } | undefined

  // 已迁移（Orchestrator 已带写作标记）→ 跳过
  if (orch && orch.system_prompt.includes(WRITING_AGENTS_MARKER)) return

  const exists = sqlite.prepare('SELECT 1 AS one FROM agents WHERE id = ?')
  const update = sqlite.prepare(`
    UPDATE agents SET
      name = @name, avatar = @avatar, description = @description,
      capabilities = @capabilities, system_prompt = @system_prompt,
      adapter_name = @adapter_name, model_provider = @model_provider, model_id = @model_id,
      tool_names = @tool_names, is_builtin = @is_builtin,
      is_orchestrator = @is_orchestrator, supports_vision = @supports_vision
    WHERE id = @id
  `)
  const insert = sqlite.prepare(`
    INSERT INTO agents (
      id, name, avatar, description, capabilities, system_prompt,
      adapter_name, model_provider, model_id, api_key, api_base_url,
      tool_names, is_builtin, is_orchestrator, supports_vision, created_at
    ) VALUES (
      @id, @name, @avatar, @description, @capabilities, @system_prompt,
      @adapter_name, @model_provider, @model_id, @api_key, @api_base_url,
      @tool_names, @is_builtin, @is_orchestrator, @supports_vision, @created_at
    )
  `)

  const tx = sqlite.transaction(() => {
    for (const a of BUILTIN_AGENTS) {
      const base = {
        id: a.id,
        name: a.name,
        avatar: a.avatar,
        description: a.description,
        capabilities: JSON.stringify(a.capabilities),
        system_prompt: a.systemPrompt,
        adapter_name: a.adapterName,
        model_provider: a.modelProvider ?? null,
        model_id: a.modelId ?? null,
        tool_names: JSON.stringify(a.toolNames),
        is_builtin: a.isBuiltin ? 1 : 0,
        is_orchestrator: a.isOrchestrator ? 1 : 0,
        supports_vision: a.supportsVision ? 1 : 0,
      }
      if (exists.get(a.id)) {
        // 改写身份字段，保留原 created_at（不传该列）
        update.run(base)
      } else {
        insert.run({ ...base, api_key: null, api_base_url: null, created_at: a.createdAt })
      }
    }
  })
  tx()
}
