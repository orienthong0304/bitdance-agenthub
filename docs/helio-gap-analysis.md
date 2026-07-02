# Helio 对标差距分析（个人版定位）

> 对标对象：[Helio](https://www.helio.im/)（"AI 原生工作空间"——AI 同事坐在相同频道、处理相同任务、交付相同工作产物）。
> AgentHub 定位差异：**个人使用的本地超级 Agent 工作台**，不做 SaaS、不做多渠道接入（Slack/Teams）、不做多人协作。因此只对标「单人 + 多 Agent」场景下有效的能力。
>
> 分析时间：2026-07-02。

## 能力对照

| Helio 能力 | AgentHub 现状 | 差距判断 |
|---|---|---|
| 统一频道（人机混合消息流） | ✅ IM 群聊范式即此(单聊/群聊/@mention) | 无差距,是同一范式 |
| 共享任务看板(Open/In Progress/Done) | 🟡 任务只活在单次 dispatch plan 卡里,跨会话不可见,run 结束即沉没 | **差距 #1(最大)** |
| AI 主动创建工单 | ❌ Agent 无法在对话外沉淀待办;发现的问题只能写在回复文字里 | **差距 #1 的一半** |
| 编码会话(工单→diff→审核) | ✅ local workspace + fs_write 审批 + diff tab 已覆盖 | 无结构性差距 |
| 多运行时(Claude Code/Codex/MCP/Docker) | ✅ 三 adapter;外部 MCP 有 spec 15 提案;Docker 不做(本地单机) | 基本对齐 |
| AI 角色系统 + 私人知识库 | 🟡 有角色(agent + systemPrompt),无长期记忆(跨 run 上下文只在会话内) | **差距 #2** |
| 早晨简报 / 定时自动化 | ❌ 无任何定时触发机制 | **差距 #3** |
| 审批溯源(谁起草/谁审批) | ✅ fs_write/bash 审批 + plan 审批已有;无审计视图但个人版足够 | 可接受 |
| 邮件/会议/社交内容 | 不做(多渠道 SaaS 场景) | 明确非目标 |

## 结论:三个值得做的方向(按价值排序)

### 1. 全局任务看板 + Agent 主动建单(→ openspec `add-task-board`,本次提案)

把「任务」升级为一等实体:跨会话聚合的看板视图(侧栏第五导航),状态流转 Open → In Progress → Done / Blocked;来源三种——用户手动建、Orchestrator dispatch 自动登记、**Agent 通过新工具 `create_task` 主动建**(Helio 的标志性能力:AI 发现该做的事就自己立一张单)。任务可回链到来源会话/消息/产物。

个人版价值:你同时开多个会话跑多个项目时,唯一的「我现在到底有哪些事在跑/卡着」入口。与现有 dispatch 体系天然衔接(dispatch 子任务就是看板任务的一个来源)。

### 2. Agent 长期记忆(后续提案)

per-agent 的本地记忆文件(markdown,`<dataDir>/agent-memory/<agentId>.md`),Agent 可通过工具追加「学到的事实/用户偏好」,每次 run 注入 system prompt。对应 Helio 的「AI 同事维护学习记录」。风险:记忆膨胀需要配额与手动清理入口。

### 3. 定时自动化(后续提案)

本地 cron 式「自动化」:定时以指定 prompt 唤起指定 agent(新会话或既有会话),产出早晨简报/定期检查类工作流。桌面版(Electron 常驻)是理想宿主;web 模式仅在进程存活时生效,需明示。

## 非目标(明确不做)

- 多人/多租户、Slack/Teams/Discord/邮件渠道、云端中继——与个人本地定位冲突
- 成本计费与配额管理面向团队的部分(个人版只要用量可见,已有 usage 仪表 + 设计稿中的价目自算可另行提案)
