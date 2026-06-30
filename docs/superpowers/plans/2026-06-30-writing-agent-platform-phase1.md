# 写作平台改造 · 阶段一 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把内置的 5 个软件开发 Agent 重写为 6 个「编辑部」写作角色，并让全新库与已有库都正确迁移，使 AgentHub 成为可用的通用写作平台。

**Architecture:** 不动五层架构 / StreamEvent / Artifact 版本链。改动集中在三处：①内置 Agent 定义（`builtin-agents.ts`）②老库迁移（新增 `migrate-writing-agents.ts` + 改 `bootstrap.ts`）③Orchestrator 派单 prompt 脚手架与文档措辞（`agent-runner.ts` + specs/OVERVIEW/CLAUDE）。联网由「资料研究员」走 `claude-code` adapter 承担（复用原生 WebSearch/WebFetch，零新依赖）。

**Tech Stack:** TypeScript (strict) · Drizzle + better-sqlite3 · Vitest · Next.js 16 · `@anthropic-ai/claude-agent-sdk`。

## Global Constraints

- 不新增依赖。联网用 `claude-code` adapter 原生 `WebSearch`/`WebFetch`，**不在 toolNames 里声明**（它们是 SDK 原生工具，由 `canUseTool` 默认放行；`toolNames` 只过滤 AgentHub 的 MCP 工具）。
- `AdapterName` 合法值仅 `'claude-code' | 'codex' | 'custom' | 'mock'`（`src/shared/types.ts:188`）。
- 复用 5 个旧 ID（`ag_orchestrator` `ag_pm` `ag_designer` `ag_frontend` `ag_reviewer`）+ 新增 `ag_researcher`，保证现有会话 `conversations.agent_ids` 引用不失效。
- 迁移必须**幂等**：重复启动不重复插入、不重复改写。幂等标记 = Orchestrator systemPrompt 是否含 `WRITING_AGENTS_MARKER`。
- 文件命名 `kebab-case.ts`；测试与被测同目录 `*.test.ts`；DB 列名 `snake_case`；不写 `console.log`（迁移脚本沿用现有 `bootstrap.ts` 风格，无 log）。
- 每个任务结束 `pnpm typecheck` 必须过。
- 测试命令：`pnpm test <file>`（= `pnpm sqlite:ensure:node && vitest run`，单文件传路径过滤）。typecheck：`pnpm typecheck`。lint：`pnpm lint`。
- 产物形态：阶段一写作流水线只产 `document`(markdown)；`ppt` 隐藏、`web_app` 排版导出归阶段二（本计划不含）。

---

## 文件结构

| 文件 | 动作 | 责任 |
|---|---|---|
| `src/db/builtin-agents.ts` | 重写 | 6 个写作角色定义（数据） |
| `src/db/builtin-agents.test.ts` | 新建 | 内置 Agent 不变量测试 |
| `src/db/migrate-writing-agents.ts` | 新建 | `rewriteBuiltinAgentsForWriting(sqlite)` + `WRITING_AGENTS_MARKER` |
| `src/db/migrate-writing-agents.test.ts` | 新建 | 迁移逻辑 + bootstrap 端到端测试 |
| `src/db/bootstrap.ts` | 改 | ①删旧开发向 prompt-append 逻辑 ②挂接 rewrite 迁移 |
| `src/server/agent-runner.ts` | 改 | Orchestrator 派单 prompt 里的开发向示例 → 写作链 |
| `OVERVIEW.md` / `CLAUDE.md` / `openspec/specs/orchestrator/spec.md` / `specs/06-orchestrator-flow.md` | 改 | 角色与产物链描述同步 |

---

## Task 1: 重写内置 Agent 定义为 6 个写作角色

**Files:**
- Modify: `src/db/builtin-agents.ts`（整体重写 `BUILTIN_AGENTS`，移除 `UI_DESIGNER_ARTIFACT_PROMPT_HINT` 导出）
- Modify: `src/db/bootstrap.ts`（移除对 `UI_DESIGNER_ARTIFACT_PROMPT_HINT` 的 import、3 个开发向 hint 常量、`upgradeBuiltinAgents` 里 5 个开发向 systemPrompt-append 分支）
- Test: `src/db/builtin-agents.test.ts`（新建）

**Interfaces:**
- Produces: `BUILTIN_AGENTS: AgentInsert[]`（6 项，ids = `ag_orchestrator` `ag_researcher` `ag_pm` `ag_frontend` `ag_designer` `ag_reviewer`）。Task 2 的迁移以它为 source-of-truth。
- Consumes: `AgentInsert`（`@/db/schema`）。

- [ ] **Step 1: 确认 `UI_DESIGNER_ARTIFACT_PROMPT_HINT` 仅被 bootstrap 引用**

Run: `grep -rn "UI_DESIGNER_ARTIFACT_PROMPT_HINT" src`
Expected: 只出现在 `src/db/builtin-agents.ts`（定义）与 `src/db/bootstrap.ts`（import + 使用）。若有其它引用，需在本任务一并处理。

- [ ] **Step 2: 写失败测试 `src/db/builtin-agents.test.ts`**

```typescript
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
  })

  it('主笔与润色编辑用质量更高的 deepseek-v4', () => {
    const writer = BUILTIN_AGENTS.find((a) => a.id === 'ag_frontend')!
    const editor = BUILTIN_AGENTS.find((a) => a.id === 'ag_designer')!
    expect(writer.modelId).toBe('deepseek-v4')
    expect(editor.modelId).toBe('deepseek-v4')
  })

  it('Orchestrator prompt 含写作链标记（迁移幂等性依赖）', () => {
    const orch = BUILTIN_AGENTS.find((a) => a.id === 'ag_orchestrator')!
    expect(orch.systemPrompt).toContain('资料简报')
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test src/db/builtin-agents.test.ts`
Expected: FAIL（当前 `BUILTIN_AGENTS` 仍是 5 个开发 Agent，无 `ag_researcher`，长度断言与 adapter 断言失败）。

- [ ] **Step 4: 重写 `src/db/builtin-agents.ts`**

整体替换文件内容为：

```typescript
/**
 * 内置 Agent 数据 —— 写作编辑部（6 角色）。
 *
 * 被三处共用：
 *  - `src/db/seed.ts` —— `pnpm db:seed` 手动 seed（dev）
 *  - `src/db/bootstrap.ts` —— 全新库首次启动自动 seed
 *  - `src/db/migrate-writing-agents.ts` —— 已有库从开发角色迁移到写作角色的 source-of-truth
 *
 * 改这里要同步检查上述三处仍合理（特别是 ids / adapterName / toolNames / systemPrompt）。
 */
import type { AgentInsert } from './schema'

export const BUILTIN_AGENTS: AgentInsert[] = [
  {
    id: 'ag_orchestrator',
    name: '主编',
    avatar: '🎯',
    description: '主协调者。理解写作目标，拆解写作任务，分派给合适的编辑部成员，并聚合定稿。',
    capabilities: ['planning', 'coordination'],
    systemPrompt: `你是 AgentHub 写作平台的主编（主协调者）。你负责理解用户的写作目标与目标读者，决定是否需要多角色协作，并用 plan_tasks 把成体系的写作任务分派给群聊中合适的编辑部成员。

调度原则：
1. 简单需求（短文、改一段、答疑）直接自己写或直接回答；只有成体系的长稿、需要查资料、或需要多道工序时才分派。
2. 子任务面向结果，不要替成员规定过细的措辞。写清写作目标、目标读者、必要输入、期望产物和依赖关系。
3. 按成员 capabilities 选负责人，不要把同一职责重复派给多人。
4. 写作产物链路：资料简报 → 写作 Brief+提纲 → 初稿 → 润色稿 → 审校报告；缺少上游时允许跳过或让对应成员补齐。
5. 聚合时只总结关键结论、定稿产物位置和下一步决策，不重复每个成员的长篇过程。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-v4-flash',
    toolNames: ['plan_tasks', 'ask_user', 'fs_list', 'fs_read', 'read_attachment', 'read_artifact'],
    isBuiltin: true,
    isOrchestrator: true,
    supportsVision: true,
    createdAt: Date.now(),
  },
  {
    id: 'ag_researcher',
    name: '资料研究员',
    avatar: '🔎',
    description: '资料研究员。联网检索、抓取网页正文、阅读附件，整理成带出处的资料简报。',
    capabilities: ['research', 'web-search', 'sources'],
    systemPrompt: `你是编辑部的资料研究员。你的任务是为写作提供可靠素材：联网检索、抓取网页正文、阅读用户附件，整理成一份「资料简报」。

工作方式：
1. 用 WebSearch 检索主题相关的权威来源，用 WebFetch 抓取关键网页正文；用户上传了材料时先 read_attachment。
2. 区分事实与观点；对关键数据与论断标注来源（标题 + 链接）。不要杜撰来源或链接。
3. 把素材整理成结构化简报，用 write_artifact(type='document', content={format:'markdown', content:'...'}) 输出。

资料简报必须包含：
1. 主题概述与检索范围
2. 关键事实 / 数据（每条标注来源）
3. 不同观点 / 争议点
4. 可直接用于写作的要点清单
5. 来源列表（标题 + 链接）

对用户的回复一段话即可，正文放进产物。`,
    adapterName: 'claude-code',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    toolNames: ['write_artifact', 'read_artifact', 'read_attachment', 'ask_user', 'fs_list', 'fs_read'],
    isBuiltin: true,
    isOrchestrator: false,
    supportsVision: true,
    createdAt: Date.now(),
  },
  {
    id: 'ag_pm',
    name: '内容策划',
    avatar: '🧭',
    description: '内容策划。基于资料与目标，产出写作 Brief 与结构提纲。',
    capabilities: ['planning', 'outline', 'brief'],
    systemPrompt: `你是编辑部的内容策划。你的核心产出是「写作 Brief + 提纲」，用 write_artifact(type='document', content={format:'markdown', content:'...'}) 输出。

工作方式：
1. 有上游资料简报或用户附件时，先用 read_artifact / read_attachment 获取上下文。
2. 信息足够直接产出；关键信息缺失且无法合理假设时，先用简短文字提最多 3 个澄清问题。
3. 围绕写作目标提炼角度、结构与基调，不写空话。

Brief + 提纲必须包含：
1. 目标读者与使用场景
2. 核心信息 / 主旨（一句话能说清）
3. 文风基调与篇幅建议
4. 结构大纲（分节标题 + 每节要点）
5. 关键论点 / 必须覆盖的内容
6. 需规避的内容 / 边界

文风简洁有结构，用 markdown 分层。对用户回复一段话即可。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-v4-flash',
    toolNames: ['write_artifact', 'read_artifact', 'read_attachment', 'ask_user', 'fs_list', 'fs_read'],
    isBuiltin: true,
    isOrchestrator: false,
    supportsVision: true,
    createdAt: Date.now(),
  },
  {
    id: 'ag_frontend',
    name: '主笔',
    avatar: '✍️',
    description: '主笔。按写作 Brief 与提纲，写出完整高质量的 Markdown 初稿。',
    capabilities: ['writing', 'drafting', 'longform'],
    systemPrompt: `你是编辑部的主笔。你按照写作 Brief 和提纲，写出完整、高质量的 Markdown 初稿，用 write_artifact(type='document', content={format:'markdown', content:'...'}) 输出。

工作方式：
1. 有上游 Brief / 提纲 / 资料简报时，先用 read_artifact 读取详情后再动笔；用户上传了参考材料用 read_attachment。
2. 忠实提纲的结构与文风基调；覆盖 Brief 列出的全部关键论点。
3. 段落充实、论证完整，不写占位句、不写「此处略」。

要求：
1. 用 markdown 标题分层，层级清晰；长文有引言与结尾。
2. 事实性内容以资料简报为准；没有来源支撑的论断要克制，不要编造数据或引文。
3. 语言通顺、节奏自然，贴合目标读者。

调用 write_artifact 前自检：type 必须是 "document"，title 非空，content 是含 markdown 正文的对象。信息不足以成稿时先 ask_user 或基于明确假设继续，不要发起空工具调用。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-v4',
    toolNames: ['write_artifact', 'read_artifact', 'read_attachment', 'ask_user', 'fs_list', 'fs_read'],
    isBuiltin: true,
    isOrchestrator: false,
    supportsVision: true,
    createdAt: Date.now(),
  },
  {
    id: 'ag_designer',
    name: '润色编辑',
    avatar: '✨',
    description: '润色编辑。在初稿基础上做语言润色、结构优化与可读性打磨，产出新版本。',
    capabilities: ['editing', 'polish', 'readability'],
    systemPrompt: `你是编辑部的润色编辑。你在初稿基础上做语言润色、结构优化和可读性打磨，产出新版本。

工作方式：
1. 先用 read_artifact 读取要润色的初稿（按 id）。
2. 用 write_artifact 输出润色稿；如果是对已有产物的改进，传 parentArtifactId 形成版本链（v1→v2），不要新建无关产物。
3. 用户给了选区或具体段落时，只改该部分，保持其余不变。

润色重点：
1. 语言：去冗余、消歧义、统一术语与口吻。
2. 结构：调整段落顺序与层级，让逻辑更顺。
3. 标题：打磨标题与小标题，使其准确且有吸引力。
4. 可读性：句子长短节奏、过渡、排版（列表 / 强调的合理使用）。

不改变作者原意与事实；拿不准的事实性改动交回审校或保留并标注。对用户回复一段话即可。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-v4',
    toolNames: ['write_artifact', 'read_artifact', 'read_attachment', 'ask_user', 'fs_list', 'fs_read'],
    isBuiltin: true,
    isOrchestrator: false,
    supportsVision: true,
    createdAt: Date.now(),
  },
  {
    id: 'ag_reviewer',
    name: '审校',
    avatar: '🔍',
    description: '审校。终审稿件的事实、逻辑、一致性与文字，输出审校报告。',
    capabilities: ['proofreading', 'fact-check', 'qa'],
    systemPrompt: `你是编辑部的审校，对群聊中已产出的稿件做终审。

你必须：
1. 先用 read_artifact 读取相关稿件与上游 Brief / 资料简报；用户上传了核对材料再 read_attachment。
2. 核对：与写作 Brief / 目标读者是否一致、逻辑是否自洽、结构是否完整、有无错别字与病句。
3. 标注「需联网核实的事实性论断」（你不直接联网，列出待核实项，由主编回派资料研究员核实）。
4. 发现问题按严重程度排序，给出「问题 / 影响 / 建议」，指明涉及哪个产物或段落。
5. 没有明显问题时明确说「未发现阻塞问题」，再列剩余风险或未验证项。

只输出审校报告（文字），不写新稿件、不产新产物。`,
    adapterName: 'custom',
    modelProvider: 'deepseek',
    modelId: 'deepseek-v4-flash',
    toolNames: ['read_artifact', 'read_attachment', 'ask_user', 'fs_list', 'fs_read'],
    isBuiltin: true,
    isOrchestrator: false,
    supportsVision: true,
    createdAt: Date.now(),
  },
]
```

- [ ] **Step 5: 改 `src/db/bootstrap.ts`，移除开发向升级逻辑**

5a. 改 import（移除 `UI_DESIGNER_ARTIFACT_PROMPT_HINT`）：

将
```typescript
import { BUILTIN_AGENTS, UI_DESIGNER_ARTIFACT_PROMPT_HINT } from './builtin-agents'
```
改为
```typescript
import { BUILTIN_AGENTS } from './builtin-agents'
```

5b. 删除 3 个开发向 hint 常量（`FRONTEND_DEPLOYMENT_PROMPT_HINT`、`FRONTEND_LOCAL_WORKSPACE_PROMPT_HINT`、`REVIEWER_LOCAL_WORKSPACE_PROMPT_HINT`）整段定义。

5c. 在 `upgradeBuiltinAgents` 里，删除所有针对旧开发角色的 systemPrompt-append 分支（即对 `ag_frontend` 的 3 个 `if`、对 `ag_reviewer` 的 1 个 `if`、对 `ag_designer` 的 1 个 `if`，以及随之多余的 `let systemPrompt = row.system_prompt` / `if (changed) update.run(...)` 中 systemPrompt 相关部分）。改写后的 `upgradeBuiltinAgents` 只保留 **toolNames 同步**：

```typescript
function upgradeBuiltinAgents(sqlite: Database.Database): void {
  const rows = sqlite
    .prepare('SELECT id, tool_names FROM agents WHERE is_builtin = 1')
    .all() as { id: string; tool_names: string }[]

  const update = sqlite.prepare(
    'UPDATE agents SET tool_names = ? WHERE id = ? AND is_builtin = 1',
  )

  for (const row of rows) {
    let toolNames: string[]
    try {
      const parsed = JSON.parse(row.tool_names) as unknown
      toolNames = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      toolNames = []
    }

    let changed = false
    for (const toolName of BUILTIN_TOOL_UPGRADES.get(row.id) ?? []) {
      if (toolNames.includes(toolName)) continue
      toolNames.push(toolName)
      changed = true
    }

    if (changed) update.run(JSON.stringify(toolNames), row.id)
  }
}
```

> 说明：旧 `deploy_artifact` 插入位置的特判已无意义（写作角色 toolNames 不含 deploy_artifact），简化为顺序追加。

- [ ] **Step 6: 运行测试与类型检查**

Run: `pnpm test src/db/builtin-agents.test.ts`
Expected: PASS（6 项断言全过）。

Run: `pnpm typecheck`
Expected: PASS（无 `UI_DESIGNER_ARTIFACT_PROMPT_HINT` 未定义、无未使用常量报错）。

- [ ] **Step 7: 提交**

```bash
git add src/db/builtin-agents.ts src/db/builtin-agents.test.ts src/db/bootstrap.ts
git commit -m "feat(db): rewrite builtin agents into writing editorial roles

把 5 个开发 Agent 重写为 6 个编辑部写作角色（新增资料研究员，走 claude-code adapter 联网）；
移除 bootstrap 中过时的开发向 prompt-append 升级逻辑。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 老库迁移 + 接入 bootstrap

**Files:**
- Create: `src/db/migrate-writing-agents.ts`
- Modify: `src/db/bootstrap.ts`（`bootstrapDatabase` 挂接 rewrite 步骤）
- Test: `src/db/migrate-writing-agents.test.ts`（新建）

**Interfaces:**
- Produces: `rewriteBuiltinAgentsForWriting(sqlite: Database.Database): void`、`export const WRITING_AGENTS_MARKER = '资料简报'`。
- Consumes: `BUILTIN_AGENTS`（Task 1）、`bootstrapDatabase`（`./bootstrap`）。

- [ ] **Step 1: 写失败测试 `src/db/migrate-writing-agents.test.ts`**

```typescript
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
      '你是软件开发团队的一员，输出 PRD / web_app。', // 注意：不含写作标记
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/db/migrate-writing-agents.test.ts`
Expected: FAIL（`migrate-writing-agents` 模块不存在 / 导出未定义）。

- [ ] **Step 3: 写 `src/db/migrate-writing-agents.ts`**

```typescript
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
```

- [ ] **Step 4: 接入 `src/db/bootstrap.ts`**

4a. 顶部加 import：
```typescript
import { rewriteBuiltinAgentsForWriting } from './migrate-writing-agents'
```

4b. 在 `bootstrapDatabase` 末尾挂接（在 `ensureBuiltinAgents` 之后、`upgradeBuiltinAgents` 之前）：
```typescript
export function bootstrapDatabase(sqlite: Database.Database): void {
  ensureSchema(sqlite)
  ensureBuiltinAgents(sqlite)
  rewriteBuiltinAgentsForWriting(sqlite)
  upgradeBuiltinAgents(sqlite)
}
```

> 顺序说明：全新库 `ensureBuiltinAgents` 已插入写作角色（含标记）→ rewrite 跳过 → upgrade 同步 toolNames（已一致，no-op）。老库 `ensureBuiltinAgents` 见已有 builtin 跳过 → rewrite 改写 5 个 + 插 researcher → upgrade 同步 toolNames（已一致，no-op）。

- [ ] **Step 5: 运行测试与类型检查**

Run: `pnpm test src/db/migrate-writing-agents.test.ts`
Expected: PASS（迁移 4 项 + 端到端 1 项全过）。

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/db/migrate-writing-agents.ts src/db/migrate-writing-agents.test.ts src/db/bootstrap.ts
git commit -m "feat(db): migrate existing builtin agents to writing roles on bootstrap

新增幂等迁移 rewriteBuiltinAgentsForWriting：老库补插资料研究员并改写 5 个旧角色，
全新库自动跳过。挂接进 bootstrapDatabase。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 重写 Orchestrator 派单 prompt 脚手架（agent-runner.ts）

**Files:**
- Modify: `src/server/agent-runner.ts`（约 L2218、L2361、L2366–2371、L2399 的开发向措辞 → 写作链）

**Interfaces:** 无新导出。仅修改 prompt 字符串常量内容。

- [ ] **Step 1: 改 write_artifact 的 document 示例（约 L2218）**

将
```typescript
      'document 完整模板：write_artifact({ type: "document", title: "PRD", content: { format: "markdown", content: "# PRD\\n\\n## 1. 背景\\n...\\n\\n## 2. 目标\\n...\\n\\n## 3. 方案\\n..." } })。',
```
改为
```typescript
      'document 完整模板：write_artifact({ type: "document", title: "文章标题", content: { format: "markdown", content: "# 文章标题\\n\\n## 引言\\n...\\n\\n## 正文小节\\n...\\n\\n## 结尾\\n..." } })。',
```

- [ ] **Step 2: 改并行 sibling 说明（约 L2361）**

将
```typescript
    '- Frontend and backend implementation tasks usually both depend on PRD/API contracts, not on each other; plan them as parallel siblings unless one truly consumes the other output.',
```
改为
```typescript
    '- 写作工序通常是逐级依赖的串行链：资料研究 → 内容策划 → 主笔 → 润色编辑 → 审校；后一道工序在 dependsOn 里写上前一道。只有彼此真正无关的子任务（如同一篇里互不依赖的两块独立资料检索）才并行。',
```

- [ ] **Step 3: 改 plan 示例（约 L2366–2371）**

将
```typescript
    '示例（设计 → 前端 → 审查，逐级依赖；agentId 用上面可用列表里的真实 id）：',
    'tasks: [',
    '  { "id": "t1", "agentId": "<设计师 id>", "task": "产出 UI 设计稿" },',
    '  { "id": "t2", "agentId": "<前端 id>", "task": "按设计稿实现页面", "dependsOn": ["t1"] },',
    '  { "id": "t3", "agentId": "<Reviewer id>", "task": "审查 t2 的实现", "dependsOn": ["t2"] }',
    ']',
```
改为
```typescript
    '示例（资料 → 策划 → 主笔 → 润色 → 审校，逐级依赖；agentId 用上面可用列表里的真实 id）：',
    'tasks: [',
    '  { "id": "t1", "agentId": "<资料研究员 id>", "task": "联网检索主题资料，产出带出处的资料简报" },',
    '  { "id": "t2", "agentId": "<内容策划 id>", "task": "基于资料简报产出写作 Brief 与提纲", "dependsOn": ["t1"] },',
    '  { "id": "t3", "agentId": "<主笔 id>", "task": "按 Brief 与提纲写出 Markdown 初稿", "dependsOn": ["t2"] },',
    '  { "id": "t4", "agentId": "<润色编辑 id>", "task": "润色 t3 初稿，产出新版本", "dependsOn": ["t3"] },',
    '  { "id": "t5", "agentId": "<审校 id>", "task": "终审 t4 稿件，输出审校报告", "dependsOn": ["t4"] }',
    ']',
```

- [ ] **Step 4: 改传递依赖注释（约 L2399）**

将
```typescript
  // 使用传递依赖闭包，避免 Review 只看到直接上游实现而看不到 PRD / UI 设计。
```
改为
```typescript
  // 使用传递依赖闭包，避免审校只看到直接上游初稿而看不到资料简报 / 写作 Brief。
```

- [ ] **Step 5: 验证（typecheck + grep 确认开发措辞已清）**

Run: `pnpm typecheck`
Expected: PASS。

Run: `grep -nE "产出 UI 设计稿|按设计稿实现页面|审查 t2 的实现" src/server/agent-runner.ts`
Expected: 无输出（旧 plan 示例已替换）。

Run: `grep -nE "资料简报|写作 Brief|主笔|审校" src/server/agent-runner.ts`
Expected: 命中新写作链文案。

> 说明：本任务为 prompt 字符串内容编辑，无独立单元测试（`buildOrchestratorPlanPrompt` 未导出，强行导出测会过度侵入）；以 typecheck + grep 验证。L2226 的「project 产物不能用 write_artifact 创建 / 代码任务通过 fs_write」与 L2318–2328 的本地代码 workspace 规则**保留不动**（仅在 local 模式 + 代码任务触发，不影响写作流），归阶段二再评估。

- [ ] **Step 6: 提交**

```bash
git add src/server/agent-runner.ts
git commit -m "feat(orchestrator): switch dispatch prompt scaffolding to writing chain

把派单示例从「设计→前端→审查」改为「资料→策划→主笔→润色→审校」，
document 模板示例改为文章结构。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 同步文档（OVERVIEW / CLAUDE / orchestrator specs）

**Files:**
- Modify: `OVERVIEW.md`（builtin-agents 行 + 功能矩阵 Orchestrator/产物 行 + 当前现状）
- Modify: `CLAUDE.md`（出现旧产物链 `PRD → 风格指南 → web_app → review` 或旧角色名处）
- Modify: `openspec/specs/orchestrator/spec.md`、`specs/06-orchestrator-flow.md`（产物链 / 角色描述）

**Interfaces:** 纯文档，无代码接口。

- [ ] **Step 1: 改 `OVERVIEW.md` 内置 Agent 行**

将（约 L153）
```
| `builtin-agents.ts` · `seed.ts` | 5 个内置 Agent（Orchestrator / PM 小灰 / UI 设计师 / 前端工程师 / Reviewer） |
```
改为
```
| `builtin-agents.ts` · `seed.ts` · `migrate-writing-agents.ts` | 6 个内置写作 Agent（主编 / 资料研究员 / 内容策划 / 主笔 / 润色编辑 / 审校）；资料研究员走 claude-code adapter 联网 |
```

- [ ] **Step 2: 定位并改其余文档中的开发向产物链 / 角色名**

Run: `grep -rnE "PRD → 风格指南|PRD -> 风格指南|风格指南 → web_app|PM 小灰|前端工程师|UI 设计师" OVERVIEW.md CLAUDE.md openspec/specs/orchestrator/spec.md specs/06-orchestrator-flow.md`

对每处命中，按语义替换为写作链 `资料简报 → 写作 Brief+提纲 → 初稿 → 润色稿 → 审校报告` 与新角色名（主编 / 资料研究员 / 内容策划 / 主笔 / 润色编辑 / 审校）。保持各文档原有句式与上下文，不改与角色无关的内容。

> 注：`OVERVIEW.md` 功能矩阵里 Orchestrator 行、产物（artifact）行若描述 `PRD/风格指南/web_app` 产物链，改为写作链表述；ppt 在写作平台隐藏、web_app 作阶段二排版导出，可在产物行补一句「写作平台默认产 document，web_app 导出为阶段二」。

- [ ] **Step 3: 验证文档不再残留旧开发链表述**

Run: `grep -rnE "PRD → 风格指南|风格指南 → web_app|PM 小灰|前端工程师|UI 设计师" OVERVIEW.md CLAUDE.md openspec/specs/orchestrator/spec.md specs/06-orchestrator-flow.md`
Expected: 无输出（全部替换完成）。

- [ ] **Step 4: 提交**

```bash
git add OVERVIEW.md CLAUDE.md openspec/specs/orchestrator/spec.md specs/06-orchestrator-flow.md
git commit -m "docs(spec): sync orchestrator docs to writing editorial roles

把 OVERVIEW/CLAUDE/orchestrator spec 里的开发角色与 PRD→web_app 产物链
改为编辑部 6 角色与写作产物链。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 全量验证 + 全新库冒烟

**Files:** 无（仅运行验证）。

- [ ] **Step 1: 全量单测**

Run: `pnpm test`
Expected: PASS（含新增的 `builtin-agents.test.ts`、`migrate-writing-agents.test.ts`，以及既有 `dispatch-plan.test.ts` 等不回归）。

- [ ] **Step 2: 类型检查 + lint**

Run: `pnpm typecheck`
Expected: PASS。

Run: `pnpm lint`
Expected: PASS（无未使用变量/导入告警，特别是 bootstrap 删常量后）。

- [ ] **Step 3: 全新库冒烟（确认 seed 出 6 个写作角色）**

在一个临时数据目录跑一次 seed，确认内置角色正确（不污染用户现有 `.agenthub-data`）：

Run:
```bash
AGENTHUB_DATA_DIR=/private/tmp/claude-501/-Users-orienthong-mini-orca-workspaces-bitdance-agenthub-Helm-Agent/2c60a405-fa71-4f15-beba-b885a15962d1/scratchpad/agenthub-smoke pnpm db:seed
```
Expected: 日志显示 insert 了 6 个 agent，含 `ag_researcher (资料研究员)`。

> 若 `db:seed` 不读 `AGENTHUB_DATA_DIR`（取决于 client.ts 取数据目录的方式），改为：删除临时目录后，用 `migrate-writing-agents.test.ts` 的端到端用例已覆盖全新库路径，本步可跳过并在 PR 说明里注明「全新库路径由单测覆盖」。执行时先确认环境变量名（`grep -rn "DATA_DIR\|dataDir" src/db/client.ts electron/paths.ts`）。

- [ ] **Step 4: 完成**

阶段一完成。提交（若 Step 3 产生了需记录的说明，可在此追加一个 docs commit；否则无新增改动）。

---

## 阶段二（后续单独计划，不在本计划范围）

记录于设计文档 §7 阶段二：①`dispatch-plan.ts` 依赖推断启发式改写作链；②`agent-builder-config.ts` 自建 Agent 预设/联想词改写作向；③UI 隐藏 ppt 导出入口、清理斜杠命令开发措辞；④`web_app` 排版导出触发交互（润色编辑工具 vs 产物面板按钮）。每项做完前各自补一份 plan。

---

## Self-Review

**1. Spec coverage（对照设计文档各节）：**
- §3 六角色 → Task 1 ✅
- §6 迁移策略（幂等、补 researcher、改写 5 个、挂 bootstrap）→ Task 2 ✅
- §7 阶段一改动清单：builtin-agents（T1）/ bootstrap+migration（T1+T2）/ agent-runner 派单措辞（T3）/ spec 同步（T4）✅
- §8 模型建议（主笔/润色 deepseek-v4，研究员 claude-sonnet-4-6）→ Task 1 数据 + 测试断言 ✅
- §7 阶段二 → 明确排除，列入「阶段二」节 ✅
- §9 实现期核实点：Claude Code 原生工具映射 → 已在探查中确认（toolNames 不含原生工具，canUseTool 默认放行），Global Constraints 固化 ✅

**2. Placeholder 扫描：** 无 TBD/TODO；所有 step 含真实代码或确切命令与预期。Task 5 Step 3 的环境变量回退路径给了确切 grep 兜底，非占位。

**3. 类型/命名一致性：** `rewriteBuiltinAgentsForWriting` / `WRITING_AGENTS_MARKER` 在 Task 2 定义并在 bootstrap、测试中同名引用一致；`BUILTIN_AGENTS` ids 在 Task 1 数据、Task 1 测试、Task 2 迁移与测试中一致（`ag_orchestrator/ag_researcher/ag_pm/ag_frontend/ag_designer/ag_reviewer`）；adapterName 值 `'claude-code'`/`'custom'` 与 `AdapterName` 联合类型一致；modelId `'deepseek-v4'`/`'deepseek-v4-flash'`/`'claude-sonnet-4-6'` 均在 `model-registry.ts` 已知列表内。
