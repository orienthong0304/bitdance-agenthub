# AgentHub 产品路线图(对标 LobsterAI)

> 2026-07-03 定向。本文档取代 `helio-gap-analysis.md` 成为产品规划北极星:对标产品从 Helio 切换为**有道龙虾 LobsterAI**(github.com/netease-youdao/lobsterai)。
> 规划变更须与用户讨论;各 Phase 落地走 openspec 提案 → SDD 流水线。

## 1. 定位

**一句话**:个人本地优先的超级 Agent 工作台——用户自建 Agent,Agent 能自己孵化子 Agent 干活,技能生态供装配,专家套件一键成型。

### 明确不做(与 LobsterAI 的差异边界)

| LobsterAI 的做法 | 我们的立场 |
|---|---|
| OpenClaw 作为核心引擎 | **不换引擎**。自有 L2 适配器层(Claude Code / Codex / Custom)是资产,多引擎可插拔本身就是差异化 |
| IM 通道远控(微信/钉钉/飞书/Telegram) | **不做 IM 通信**。本地 Web UI 是唯一交互面 |
| Electron 桌面分发为先 | 桌面版(Spec 12)保持低优先级,`pnpm dev` 本地跑是主形态 |
| SaaS 化 | 不做,个人单用户 |
| 移动端 | 不做(用户明确排除) |

### 我们已有而 LobsterAI 叙事里弱的差异化

- **任务看板**:跨会话任务聚合、三来源、实时推送
- **用量成本自算**:本地价目表、不信任 provider 报价
- **产物系统**:版本链、内联预览、二次编辑、部署
- **多引擎适配**:同一会话可混搭 Claude Code / Codex / 自建 Agent

## 2. 现状盘点(地基已有多少)

| 产品能力 | LobsterAI | AgentHub 现状 |
|---|---|---|
| 用户自建 Agent(身份/模型/工具) | Custom Agents | ✅ agent-builder(角色、模型、工具集、技能勾选、effort) |
| Agent 编排协作 | Cowork 模式 | ✅ Orchestrator:计划审批、并行 wave、冲突检测、任务看板登记 |
| **Agent 孵化子 Agent** | 引擎内建 | ❌ **只能 dispatch 给既有 roster,不能运行时定义新角色** |
| Skill 供用户选择 | 28 内置 + 热加载 | ⚠️ 有 SkillPackage 导入 + per-agent 勾选,但内置库薄 |
| Skill 创作 | skill-creator | ❌ |
| **专家套件(多 Skill 组合)** | Expert Kit 可安装 | ❌ |
| 持久记忆 | 跨会话偏好/上下文 | ❌(有跨 run 会话历史,无跨会话记忆) |
| 定时任务 | 内建 | ❌ |
| 办公产物(PPT/文档/网页) | Skill 驱动 | ✅ 产物系统 + 导出(docx/pptx) |

## 3. 路线图

优先级依据用户定向:子 Agent 孵化是标志性诉求 > Skill 生态 > 专家套件(用户原话「未来」)> 记忆/定时(LobsterAI 特性清单内,继承自旧路线图)。

### Phase 1 — Agent 孵化子 Agent(`spawn_agent`)

任意 Agent 在运行中定义并孵化**临时子 Agent**去执行任务:给定角色名、system prompt、工具集(≤ 父 Agent 权限)、可选技能,子 Agent 在同 workspace 跑完任务把结果交回父 Agent。

- 复用 AgentRunner + dispatch 基建(子 run 挂 parentRunId,已有事件族 dispatch.start/end 可扩展)
- 临时 Agent 不进 Agent 库(ephemeral,run 结束即弃),但会话内可见其消息流与工具卡
- 安全边界:子 Agent 工具权限是父的子集;审批模式继承会话设置;孵化深度限制(防递归爆炸)
- 与 Orchestrator 的关系:Orchestrator 仍是「调度既有专家」;spawn_agent 是「临时造一个帮手」,两者互补不合并

### Phase 2 — 技能生态扩容

- **内置技能库**对标 LobsterAI 的基础盘:web-search、数据分析、文章写作等(docx/pptx/网页已有产物工具覆盖,不重复造)
- **skill-creator**:让 Agent 帮用户写技能包(SKILL.md + 资源文件),写完热加载进技能库——吃我们自己的 spawn_agent 狗粮
- 技能库 UI 升级:分类、搜索、启用统计(哪些 Agent 在用)

### Phase 3 — 专家套件(Expert Kit)

新实体 `ExpertKit` = 技能组合 + 预设 Agent 模板(system prompt、工具集、默认模型档位):

- 一键安装 = 导入 N 个技能 + 生成一个成品 Agent(如「股票专家」「投标撰写专家」)
- 内置若干套件 + 文件级导入/导出(可分享给别人)
- 套件与技能的关系:套件引用技能(不复制),卸载套件不删被共用的技能

### Phase 4 — 长期记忆与定时自动化

- per-agent 记忆文件:跨会话沉淀用户偏好与项目上下文,注入 system prompt(继承旧路线图,LobsterAI 亦有)
- 定时任务:cron 表达式触发某 Agent 在指定会话跑一个 prompt(晨报/巡检/周报)

## 4. 与现有 specs 的衔接

- Phase 1 动 orchestrator/tools/stream-events 三个 capability,须新 openspec change(`add-agent-spawn`)
- Phase 2 主要扩 agent-skills capability;skill-creator 是新工具 + 流程
- Phase 3 新 capability(`expert-kits`),动 persistence/frontend
- Phase 4 对应旧候选,各自独立 change
