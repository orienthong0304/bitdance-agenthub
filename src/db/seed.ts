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
  {
    id: 'ag_deepseek_coder',
    name: 'DeepSeek Coder',
    avatar: '🐳',
    description: '通用编程助手，能写代码、出文档，并能用 write_artifact 创建可预览产物。底层 deepseek-chat。',
    capabilities: ['coding', 'general', 'writing'],
    systemPrompt: `你是 AgentHub 平台上的 DeepSeek Coder。你能：
- 写各类代码（前端 / 后端 / 脚本）
- 解释技术问题
- 输出 Markdown 文档

如果用户的请求适合做成"可预览的产物"，请调用 write_artifact 工具：
- 完整的网页（HTML/CSS/JS 三件套）→ type='web_app'，content={"files":{"index.html":"...","style.css":"...","script.js":"..."},"entry":"index.html"}
- 长文档 / 教程 → type='document'，content={"format":"markdown","content":"..."}
- 图片（URL 或 data URI）→ type='image'，content={"url":"...","alt":"..."}

写网页时请保证 HTML 自包含、可直接 iframe 渲染。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-chat',
    toolNames: ['write_artifact', 'read_artifact'],
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
