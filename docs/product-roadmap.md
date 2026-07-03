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
| Agent 孵化子 Agent | 引擎内建 | 后备(用户裁定不是当下重点,2026-07-03;方向保留待前三 Phase 后再议) |
| Skill 供用户选择 | 28 内置 + 热加载 | ⚠️ 有 SkillPackage 导入 + per-agent 勾选,但内置库薄 |
| Skill 创作 | skill-creator | ❌ |
| **专家套件(多 Skill 组合)** | Expert Kit 可安装 | ❌ |
| 持久记忆 | 跨会话偏好/上下文 | 不做(用户裁定:太重,暂不考虑,2026-07-03) |
| 定时任务 | 内建 | 暂缓(用户裁定:现有规划全部完善后再议,2026-07-03) |
| 办公产物(PPT/文档/网页) | Skill 驱动 | ✅ 产物系统 + 导出(docx/pptx) |

## 3. 路线图

优先级(用户重排,2026-07-03 晚):**模板陈列 + 技能生态是当下重点** > 专家套件(依赖技能生态)> 外部 MCP 接入(设计稿已画完整 UI)。与各 Phase 并行的还有 **UX 打磨 track**(全面体检驱动,见审计报告)。

**明确暂缓**(用户裁定,2026-07-03):长期记忆(太重)、定时自动化(现有规划全部完善后再议)——两者都不排期,不要作为候选提出。

**后备(方向认可、暂不排期)**:`spawn_agent` 子 Agent 孵化——用户裁定「不是当下重点」(2026-07-03 晚,提案已撤销);方向本身未被否,待前三个 Phase 落地后再议,重启时重新设计。

### Phase 1 — Agent 招新模板库 + 技能生态扩容

**Agent 招新模板库**(用户钦点的 Helio 式创建体验,2026-07-03 截图定向):

- 创建 Agent 的第一步改为**模板陈列**:「从空白开始」+ 分类人格模板卡(文档编辑、表格分析师、PPT 助手、调研员、周报助手、工程师、代码评审…),每卡 = 头像缩写 + 名字 + 一句人话简介 + 领域标签,顶部分类 tab(全部/推荐/Documentation/Personal Productivity/Engineering/Data…)
- 选模板 → 预填草稿进既有向导流(引擎/模型 → 资料:头像/名字/简介 → 完成),「从空白开始」走已有对话式/详细表单双路径
- 模板 = 轻量预设(persona prompt + 建议工具集 + 分类),存内置常量即可,不新增实体;与 P3 ExpertKit 的关系:Kit 安装后把成品 Agent 模板注入同一个陈列(模板库是 Kit 的展示面)
- 地基:`add-agent-create-wizard` 已交付「对话式草稿 + 详细表单」双路径,本项在其前面加一层模板选择,复用 AgentConfigDraft 预填机制

**技能生态扩容**:

- **内置技能库**对标 LobsterAI 的基础盘:web-search、数据分析、文章写作等(docx/pptx/网页已有产物工具覆盖,不重复造)
- **skill-creator**:让 Agent 帮用户写技能包(SKILL.md + 资源文件),写完热加载进技能库(走普通工具链 fs_write + 导入,不依赖 spawn)
- 技能库 UI 升级:分类、搜索、启用统计(哪些 Agent 在用)

**开工前置**:模板陈列是 UI 工作——按约定先 DesignSync 重拉最新设计稿(施工中),模板陈列以 Helio 截图为设计范本;设计稿若已含相应区域以设计稿为准。

### Phase 2 — 专家套件(Expert Kit)

新实体 `ExpertKit` = 技能组合 + 预设 Agent 模板(system prompt、工具集、默认模型档位):

- 一键安装 = 导入 N 个技能 + 生成一个成品 Agent(如「股票专家」「投标撰写专家」)
- 内置若干套件 + 文件级导入/导出(可分享给别人)
- 套件与技能的关系:套件引用技能(不复制),卸载套件不删被共用的技能

### Phase 3 — 外部 MCP Server 接入

用户设计稿(2026-07-03 更新)已画完整 UI;仓库 `specs/15-external-mcp.md` 已有设计提案。核心:设置面板登记外部 MCP server(全局表)→ Agent 侧勾选启用 → 每会话首次调用某工具弹审批门(批准后本会话免再问)→ 工具卡带「外部 MCP · server」徽标。信任边界文案:外部 MCP 在 AgentHub 沙箱之外、以应用权限运行。**等设计稿定稿后再立 change。**

## 4. 与现有 specs 的衔接

- Phase 1 模板陈列扩 agent-builder capability;技能部分扩 agent-skills;skill-creator 是新工具 + 流程
- Phase 2 新 capability(`expert-kits`),动 persistence/frontend
- Phase 3 落 spec 15(外部 MCP),动 tools/adapters/platform-security/frontend
- UX 打磨 track 按审计报告分批,小批次直改(fix/feat(ui)),大改动才立 change
- 后备 spawn_agent 重启时须重新立 change(旧提案 78ad67c 已撤销,不复用)
