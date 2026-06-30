import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

import { bootstrapDatabase } from './bootstrap'
import { rewriteBuiltinAgentsForWriting, WRITING_AGENTS_MARKER } from './migrate-writing-agents'

function makeAgentsDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      description TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      adapter_name TEXT NOT NULL,
      model_provider TEXT,
      model_id TEXT,
      api_key TEXT,
      api_base_url TEXT,
      tool_names TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      is_orchestrator INTEGER NOT NULL DEFAULT 0,
      supports_vision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `)
  return db
}

/** 模拟一个已经 seed 了旧开发 Agent 的老库（5 个，无写作标记，无 researcher）。 */
function seedLegacyDevAgents(db: Database.Database): void {
  const ids = ['ag_orchestrator', 'ag_pm', 'ag_designer', 'ag_frontend', 'ag_reviewer']
  const insert = db.prepare(`
    INSERT INTO agents (id, name, avatar, description, capabilities, system_prompt,
      adapter_name, model_provider, model_id, tool_names, is_builtin, is_orchestrator, supports_vision, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?)
  `)
  for (const id of ids) {
    insert.run(
      id, '旧' + id, '🤖', '旧开发角色', JSON.stringify(['dev']),
      '你是软件开发团队的一员，输出 PRD / web_app。', // 旧 prompt 不含写作标记，确保迁移的幂等判据会触发改写
      'custom', 'deepseek', 'deepseek-v4-flash', JSON.stringify(['write_artifact']),
      id === 'ag_orchestrator' ? 1 : 0, 100,
    )
  }
}

function countAgents(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n
}

describe('rewriteBuiltinAgentsForWriting', () => {
  let db: Database.Database
  beforeEach(() => { db = makeAgentsDb() })
  afterEach(() => { db.close() })

  it('老库：插入 researcher 并把 5 个旧角色改写为写作角色', () => {
    seedLegacyDevAgents(db)
    expect(countAgents(db)).toBe(5)

    rewriteBuiltinAgentsForWriting(db)

    expect(countAgents(db)).toBe(6)
    const researcher = db.prepare("SELECT adapter_name FROM agents WHERE id = 'ag_researcher'").get() as { adapter_name: string } | undefined
    expect(researcher?.adapter_name).toBe('claude-code')

    const pm = db.prepare("SELECT name FROM agents WHERE id = 'ag_pm'").get() as { name: string }
    expect(pm.name).toBe('内容策划')

    const orch = db.prepare("SELECT system_prompt FROM agents WHERE id = 'ag_orchestrator'").get() as { system_prompt: string }
    expect(orch.system_prompt).toContain(WRITING_AGENTS_MARKER)
  })

  it('幂等：已迁移库再跑一次不新增、不抛错', () => {
    seedLegacyDevAgents(db)
    rewriteBuiltinAgentsForWriting(db)
    expect(() => rewriteBuiltinAgentsForWriting(db)).not.toThrow()
    expect(countAgents(db)).toBe(6)
  })

  it('保留旧角色的 created_at（不重置排序）', () => {
    seedLegacyDevAgents(db)
    rewriteBuiltinAgentsForWriting(db)
    const pm = db.prepare("SELECT created_at FROM agents WHERE id = 'ag_pm'").get() as { created_at: number }
    expect(pm.created_at).toBe(100)
  })
})

describe('bootstrapDatabase 端到端（全新库）', () => {
  it('全新库直接得到 6 个写作角色', () => {
    const db = new Database(':memory:')
    bootstrapDatabase(db)
    const rows = db.prepare("SELECT id, name FROM agents WHERE is_builtin = 1 ORDER BY id").all() as { id: string; name: string }[]
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.id)).toContain('ag_researcher')
    const researcher = rows.find((r) => r.id === 'ag_researcher')!
    expect(researcher.name).toBe('资料研究员')
    db.close()
  })
})
