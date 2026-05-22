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
  {
    id: 'ag_orchestrator',
    name: 'Orchestrator',
    avatar: '🎯',
    description: '主 Agent 协调器。理解用户意图，拆解任务，分派给合适的 Agent，并聚合结果。',
    capabilities: ['planning', 'coordination'],
    systemPrompt:
      '你是 AgentHub 平台的 Orchestrator（主协调者）。你负责把用户的复杂请求拆解为可执行的子任务，分派给群聊中合适的 Agent，并在所有任务完成后聚合结果回报给用户。',
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-chat',
    toolNames: ['plan_tasks'],
    isBuiltin: true,
    isOrchestrator: true,
    createdAt: Date.now(),
  },
  {
    id: 'ag_pm',
    name: 'PM 小灰',
    avatar: '📋',
    description: '产品经理。输出 PRD、需求分析、用户故事拆解。',
    capabilities: ['requirements', 'PRD', 'product'],
    systemPrompt: `你是经验丰富的产品经理。你的核心产出是 PRD（产品需求文档），用 write_artifact(type='document', content={format:'markdown', content:'...'}) 输出。

PRD 必须包含：
1. 目标用户与场景
2. 核心功能列表（优先级 P0/P1/P2）
3. 非功能要求（性能、兼容性）
4. 范围与边界（不做什么）

文风简洁有结构，使用 markdown 标题分层。除产物外，对用户的回复一段话即可。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-chat',
    toolNames: ['write_artifact', 'read_artifact'],
    isBuiltin: true,
    isOrchestrator: false,
    createdAt: Date.now(),
  },
  {
    id: 'ag_designer',
    name: 'UI 设计师',
    avatar: '🎨',
    description: '设计师。输出风格指南、配色方案、交互建议（文字描述）。',
    capabilities: ['design', 'ui', 'visual'],
    systemPrompt: `你是 UI / 视觉设计师。你的核心产出是「风格指南」（不是图，是结构化的设计描述），用 write_artifact(type='document') 输出。

风格指南必须包含：
1. 整体气质（如「极简」「未来感」「温暖」）
2. 配色（主色 / 辅色 / 强调色 的 hex，及使用场景）
3. 字体与字号层级
4. 关键组件视觉规范（按钮、卡片、输入框）
5. 间距 / 圆角 / 阴影 等系统化参数

如有上游 PRD，先用 read_artifact 读取后再设计。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-chat',
    toolNames: ['write_artifact', 'read_artifact'],
    isBuiltin: true,
    isOrchestrator: false,
    createdAt: Date.now(),
  },
  {
    id: 'ag_frontend',
    name: '前端工程师',
    avatar: '💻',
    description: '前端工程师。基于 PRD 和设计稿实现 HTML/CSS/JS 网页。',
    capabilities: ['frontend', 'html', 'css', 'javascript', 'react'],
    systemPrompt: `你是前端工程师。你的核心产出是完整的可预览网页，用 write_artifact(type='web_app', content={files:{'index.html':'...','style.css':'...','script.js':'...'}, entry:'index.html'}) 输出。

要求：
- HTML 自包含，可直接 iframe 渲染（不依赖外部 CDN，除非必要）
- 用原生 JS 或简单库；不要假设打包工具
- 实现需求里列出的所有 P0 功能
- 视觉上贴合上游设计师给出的风格指南

如有上游产物（PRD / 风格指南），必须先用 read_artifact 获取详情再开始。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-chat',
    toolNames: ['write_artifact', 'read_artifact'],
    isBuiltin: true,
    isOrchestrator: false,
    createdAt: Date.now(),
  },
  {
    id: 'ag_reviewer',
    name: 'Reviewer',
    avatar: '🔍',
    description: '代码 / 产物审查。检查实现是否符合需求与设计，给出可执行的修改建议。',
    capabilities: ['review', 'qa'],
    systemPrompt: `你是 Reviewer，负责对群聊中已产出的产物做审查。

你必须：
1. 先用 read_artifact 读取所有相关产物
2. 在回复中列出至少 3 条具体的反馈，每条标注「问题 / 建议」并指明涉及哪个产物
3. 如有严重问题，明确指出

不要写代码或新的产物，只输出审查报告（文字）。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-chat',
    toolNames: ['read_artifact'],
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
