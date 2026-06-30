# 设计：AgentHub → 通用写作平台改造

> 状态：设计已确认，待写实现计划
> 日期：2026-06-30
> 范围：把内置 Agent 阵容从「软件开发团队」改造为「编辑部」，使平台成为产出高质量 Markdown 文档的通用写作平台。

---

## 1. 背景与目标

AgentHub 现状是一个**多 Agent 软件开发协作平台**：内置的 5 个 Agent（Orchestrator / PM / UI 设计师 / 前端工程师 / Reviewer）和 Orchestrator 的调度链都围绕「做产品」设计，产物链路写死为 `PRD → 风格指南 → web_app → review`。

**目标**：在**不改动五层架构、StreamEvent 契约、Artifact 版本链、Orchestrator 走同一 AgentRunner** 这些核心设计的前提下，把「住在群聊里的角色」从开发团队换成**编辑部**，让平台成为一个**通用万能写作平台**——给主题或素材，就能协作产出高质量 Markdown 长文。

### 已确认的产品决策

| 维度 | 决策 |
|---|---|
| 写作类型 | **通用万能写作**（不锁领域，按主题自适应：散文/报告/商务文书/各类长文） |
| 联网检索 | **核心能力**——需要网页搜索/抓取作为写作素材，单设「资料/研究」角色 |
| 产物形态 | **Markdown(`document`) 为核心** + 保留**网页(`web_app`)导出**做排版美化阅读页；`ppt` 隐藏 |
| 阵容方案 | **完整编辑部**：主编 + 5 岗，共 6 个角色 |
| 联网落地 | **资料研究员走 Claude Code adapter**，复用其原生 WebSearch/WebFetch，**零新依赖** |
| 实现范围 | 覆盖阶段一（核心）+ 阶段二（打磨） |

---

## 2. 总体设计：把「编辑部」搬进群聊

平台隐喻不变——「IM 群聊 + 群里的项目经理」。只是把开发团队换成**编辑部**：主编（Orchestrator）坐镇群聊，按需把稿子拆给不同岗位。

### 写作流水线（产物链）

```
资料简报(md) → 写作 Brief+提纲(md) → 初稿(md) → 润色稿(md, 新版本) → 审校报告(文字)
   研究员           内容策划            主笔         润色编辑           审校
```

主编对**简单需求直接写/直接答**，只有成体系的长稿才开流水线（沿用现有「简单问题不分派」原则，避免过度编排）。

### 不变量（明确不动的东西）

- 五层分层（L1–L5）、跨层调用铁律。
- `StreamEvent` 联合类型（事件协议）。
- `Message = parts 数组`、`Artifact 独立于 Message + 版本链`。
- Orchestrator 走同一个 `AgentRunner`，仅靠 system prompt + `dispatch_to_agent`/`plan_tasks` 工具区分。
- `web_app` / `ppt` 的产物**基础设施**（预览 / 导出 / deploy 的 ~20 个文件）保留在代码中。

---

## 3. 六角色编辑部（核心改动）

| 角色 | Avatar | 复用 ID | Adapter / 模型 | 工具集 | 核心产出 |
|---|---|---|---|---|---|
| **主编** Orchestrator | 🎯 | `ag_orchestrator` | custom / deepseek-flash | plan_tasks, ask_user, fs_list, fs_read, read_attachment, read_artifact | 拆稿、分派、聚合定稿 |
| **资料研究员** Researcher | 🔎 | `ag_researcher`（**新增**） | **claude-code** / Claude | **WebSearch, WebFetch**(原生) + write_artifact, read_attachment, read_artifact, fs_read | 带出处的「资料简报」(md) |
| **内容策划** Planner | 🧭 | `ag_pm` | custom / deepseek | write_artifact, read_artifact, read_attachment, ask_user, fs_list, fs_read | 写作 Brief + 提纲 (md) |
| **主笔** Writer | ✍️ | `ag_frontend` | custom / deepseek（建议非 flash） | write_artifact, read_artifact, read_attachment, ask_user, fs_list, fs_read | 高质量 Markdown 初稿 |
| **润色编辑** Editor | ✨ | `ag_designer` | custom / deepseek | write_artifact, read_artifact, read_attachment, ask_user, fs_list, fs_read | 润色稿（产物新版本）/ 选区改写 |
| **审校** Proofreader | 🔍 | `ag_reviewer` | custom / deepseek | read_artifact, read_attachment, ask_user, fs_list, fs_read | 审校报告（事实/逻辑/一致性） |

### 关键设计点

- **复用 5 个旧 ID + 新增 1 个**（研究员）：现有会话的 `conversations.agent_ids` 引用不失效；迁移时整体重写这 5 个的人设字段。ID 与新角色的映射按「工序位置」对齐（PM→策划、设计师→润色、前端→主笔、Reviewer→审校），语义略有错位但换 prompt 即可。
- 只有**研究员**走 Claude Code adapter，白嫖原生联网（零新依赖）；其余维持 DeepSeek，成本可控。
- **润色编辑**复用 UI 设计师位——原本就是「只产 document」约束，天然适配文字编辑，并接管平台已有的**选区改写**能力（v1→v2 走 Artifact 版本链）。
- **审校**做逻辑/一致性/与 Brief 对齐 + 标注「需联网核实的论断」；要真·联网复核时由主编回派研究员，保持「联网 = 研究员一个角色」的清爽边界。

### 各角色 system prompt 要点（实现期据此写最终 prompt）

- **主编**：理解写作意图与目标读者；简单需求直接产出，长稿才 `plan_tasks` 拆解；子任务面向结果（写清目标/输入/期望产物/依赖）；产物链 `资料简报 → Brief+提纲 → 初稿 → 润色 → 审校`，缺上游允许跳过或让对应角色补；聚合只给定稿位置 + 关键结论 + 待决策。
- **资料研究员**：用 WebSearch/WebFetch 检索并抓取网页正文，结合用户附件，整理成**带出处（标题+链接）的资料简报**（`document`/markdown）；区分事实与观点；不杜撰来源。
- **内容策划**：基于资料与目标产出**写作 Brief + 提纲**（`document`）——目标读者、核心信息/主旨、结构大纲（分节）、文风基调、目标篇幅、关键论点；信息不足时最多 3 个澄清问题或基于明确假设继续。
- **主笔**：严格按 Brief/提纲写出**完整、高质量** Markdown 初稿；markdown 分层标题、段落充实、不写占位；忠实提纲结构与文风；有上游产物先 `read_artifact`。
- **润色编辑**：在初稿基础上做语言润色、节奏、标题打磨、可读性与结构优化，产出**新版本**（版本链 v1→v2）；支持选区改写。（「排版/精美阅读页 → `web_app` 导出」属阶段二，见 §4、§9，阶段一润色编辑只产 `document`，工具集不含 `deploy_artifact`。）
- **审校**：先 `read_artifact` 读相关产物；核对与 Brief/目标一致性、逻辑、错别字；按严重度排序输出「问题/影响/建议」并指明涉及产物；标注需联网核实的事实性论断；只输出审校报告（文字），不产新产物。

---

## 4. 产物形态：Markdown 为核心 + 网页导出

- **写作产物 = `document`(markdown)**，贯穿全流水线；改稿靠现有**版本链**（v1 初稿 → v2 润色）天然承载。
- **`web_app` 保留**，改造成「**排版美化的阅读页**」按需导出（长文一键转精美网页）。**此导出能力属阶段二**：届时确定触发交互（润色编辑工具调用 vs 产物面板按钮，见 §9），并据此给对应角色补 `write_artifact(web_app)` + `deploy_artifact` 或加面板入口。阶段一写作流水线只产 `document`(markdown)。
- **`ppt` 隐藏**：写作角色不引导产出 ppt；UI 导出入口隐藏 ppt（阶段二）。`ppt` 基础设施代码保留，不删除，仅不暴露。
- `image` 保留（配图/参考图上传）。

---

## 5. 数据流（一次长稿协作）

用户发「写一篇关于 X 的深度长文」→ 主编判断需成体系 → `plan_tasks` 拆：

1. **研究员**（联网查 X）→ 资料简报
2. **内容策划**（基于简报）→ Brief + 提纲
3. **主笔**（按提纲）→ 初稿
4. **润色编辑** → 润色稿 v2
5. **审校** → 审校报告

每步产物经 `write_artifact` 落库，主编聚合时只给「定稿位置 + 关键结论 + 待决策」。**全部走现有 AgentRunner DAG 调度，不新增服务路径。**

---

## 6. 迁移策略（关键）

现有 `.agenthub-data/agenthub.db` 已 seed 旧的 5 个开发 Agent。`bootstrap.ts` 现有逻辑：
- `ensureBuiltinAgents`：**仅当一个 builtin 都没有时**整批插入 → 对已有库不生效，新研究员插不进去。
- `upgradeBuiltinAgents`：只**追加** toolNames / 特定 prompt 片段，**不重写**人设。

故仅改 `builtin-agents.ts` 对老库无效。方案：

> **新增一次性迁移 `migrate-writing-agents.ts`**（沿用现有 `migrate-add-*` 模式），幂等地：
> 1. 若缺 `ag_researcher` 则插入；
> 2. 用标记位判断（如 `ag_orchestrator` 的 systemPrompt 是否含写作链标记字符串），未改造过则**整体重写** 5 个 builtin 的 `name / avatar / description / systemPrompt / toolNames / adapterName / modelProvider / modelId` 为写作版。
>
> 在 `bootstrapDatabase()` 内挂上这步（在 `upgradeBuiltinAgents` 前/后均可，需保证幂等不互相打架）。全新库走 `ensureBuiltinAgents` 直接拿新定义，无需迁移。

幂等性要求：重复启动不重复改写、不重复插入。

---

## 7. 影响面与改动清单

### 阶段一（核心，做完即「是一个写作平台」）

1. `src/db/builtin-agents.ts` — 重写为 6 个写作角色 ⭐
2. `src/db/bootstrap.ts` + 新 `src/db/migrate-writing-agents.ts` — 老库迁移 ⭐
3. `src/server/agent-runner.ts`（约 L2217–2399）— orchestrator 派单 prompt 脚手架里的 PRD/web_app/前后端示例 → 换成写作链示例（资料简报/Brief/初稿等）
4. spec 同步（CLAUDE.md 强制）：`openspec/specs/orchestrator/spec.md`、`specs/06-orchestrator-flow.md`、必要时 `specs/01`；并更新 `OVERVIEW.md`、`CLAUDE.md` 里的角色与产物链描述

### 阶段二（打磨，不阻塞「能用」）

5. `src/server/dispatch-plan.ts` — 依赖推断启发式（`taskReadsPRD`/`taskProducesUI`/`taskProducesFrontend` 等正则）→ 改为写作链（读简报/读提纲/产初稿…）。注：这些是 LLM 未显式声明依赖时的**兜底**，不改不会崩，只是推断不准。
6. `src/shared/agent-builder-config.ts` — 自建 Agent 的工具预设（`all-purpose`/`local-code`/`artifact`/`review`）与能力联想词：开发向 → 写作向。
7. UI：隐藏 `ppt` 导出入口；清理斜杠命令/文案里残留的开发措辞。
8. `web_app` 排版导出：确定触发交互并接通（润色编辑工具 vs 产物面板按钮，见 §9），含对应角色 toolNames 或面板入口的改动。

---

## 8. 模型与质量建议

「高质量」是核心诉求，建议（均可在 Agent 库改）：
- **主笔 / 润色编辑**：DeepSeek 用**非 flash 的 v4**（写作质量明显更好）；主编/审校可留 flash 省钱。
- **研究员**：Claude Code adapter，需 **Anthropic key**（走现有三层 key 机制，缺 key 时仅该角色报错，不影响其它角色）。

---

## 9. 实现期需核实的点（记入待办，不阻塞设计）

- Claude Code adapter 的 `toolNames` 如何映射/启用 SDK 原生 `WebSearch`/`WebFetch`——builtins 的 toolNames 目前都是 AgentHub L3 工具名，原生工具的声明方式需在 `src/server/adapters/claude-code-adapter.ts` 确认（决定研究员 toolNames 怎么写、是否需在 adapter 侧放行原生工具）。
- 「长文 → web_app 排版导出」的具体触发交互（润色编辑的工具调用 vs 产物面板按钮），阶段二定。
- 迁移幂等标记的具体形式（prompt 标记字符串 vs 在 `app_settings` 存版本号），实现期选其一。

---

## 10. 非目标（YAGNI）

- 不删除 `ppt`/`web_app` 基础设施代码（只隐藏 ppt 暴露面）。
- 不自建通用 `web_search` L3 工具（联网由研究员的 Claude Code adapter 承担）。
- 不按文体细分多个写手角色（通用万能写作下文体无穷，按工序切而非按文体切）。
- 不改动 SQLite schema（6 个角色复用现有 `agents` 表结构）。
