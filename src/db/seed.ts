/**
 * Seed 初始 Agent。
 *
 * 运行：pnpm db:seed
 *
 * 只 seed 一次。重复运行会跳过已存在的 Agent。
 */
import { eq } from 'drizzle-orm'

import { db, schema } from './client'
import type { AgentInsert } from './schema'

const seedAgents: AgentInsert[] = [
  {
    id: 'ag_mock_default',
    name: 'Mock Agent',
    avatar: '🤖',
    description: '不调用真实 LLM，用预设脚本验证端到端骨架。开发与演示备份用。',
    capabilities: ['mock', 'development', 'demo'],
    systemPrompt: 'You are a mock agent for development and testing. Respond with scripted replies.',
    adapterName: 'mock',
    toolNames: [],
    isBuiltin: true,
    isOrchestrator: false,
    createdAt: Date.now(),
  },
]

async function seed() {
  for (const agent of seedAgents) {
    const existing = await db.query.agents.findFirst({
      where: eq(schema.agents.id, agent.id),
    })
    if (existing) {
      console.log(`[seed] skip ${agent.id} (already exists)`)
      continue
    }
    await db.insert(schema.agents).values(agent)
    console.log(`[seed] insert ${agent.id} (${agent.name})`)
  }
  console.log('[seed] done')
}

seed().catch((err) => {
  console.error('[seed] failed', err)
  process.exit(1)
})
