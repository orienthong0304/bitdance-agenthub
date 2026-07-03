# AgentHub 详细功能清单

> 面向人类读者的**产品功能清单**:AgentHub 能做什么、做到什么程度。与其它文档的分工:本文档回答「有哪些功能」,`OVERVIEW.md` 回答「代码在哪」,`specs/` 回答「契约细节」。
>
> 状态标记:✅ 已实现 · 🟡 部分实现 · ⏳ 开发中 · 📋 设计中/未实现
>
> 最后更新:2026-07-02(依据 OVERVIEW.md、specs/03–15 及代码核实整理)

---

## 定位

> 把多 Agent 协作做成 IM 群聊体验 —— Agent 是「联系人」,对话是「工作空间」,Orchestrator 是「群里的项目经理」。

本地优先运行(`pnpm dev` / Electron 桌面版),SQLite 文件数据库,Agent 执行、文件读写、命令执行全部留在本机,不依赖任何托管服务。

---

## 1. IM 会话与消息 ✅

### 会话管理
- 多会话并行,侧栏会话列表(搜索 / 置顶 / 归档 / 未读标记)
- 单聊(1 个 Agent)与群聊(多 Agent,`@mention` 点名)
- 每个会话绑定独立 workspace(见 §9)
- 会话大纲导航、pinned 消息横幅

### 消息操作
- 引用回复、撤回、编辑重发、重新生成
- 收藏(☆ 书签,支持跳转定位 + 辉光提示)
- Pin(钉选):消息被永久注入 LLM 长期上下文,无视历史截断
- 撤回/编辑采用物理删除,连带删除该轮产生的产物
- 输入框:附件上传、审批模式切换、选区引用、斜杠命令(`/` 弹命令浮层:打开设置、Agents 库、`/deploy`、`/compact` 等)
- 选区改写:选中消息文字直接发起改写

### 消息状态视觉
- streaming(转圈)/ complete / error(红边)/ aborted(灰边)
- 运行中可随时中止(级联中止 Orchestrator 子任务)

## 2. 消息内容类型(MessagePart,10 种)✅

一条消息是结构化「部件」数组,不是一整段 markdown 字符串:

| 类型 | 渲染效果 |
|---|---|
| `text` | Markdown 渲染(GFM + 代码高亮),流式逐字追加 |
| `code` | 独立代码块,语法高亮 |
| `thinking` | 思考链(DeepSeek reasoning / Anthropic extended thinking),默认折叠可展开 |
| `tool_use` + `tool_result` | 按调用 ID 合并成工具卡片(调用中/完成/失败三态);`bash` 提升为终端样式块,显示 stdout/stderr,可复制;失败/中止时自动补错误结果,不卡「调用中」 |
| `artifact_ref` | 产物卡片(标题/类型/版本),点击打开右侧预览面板;产物删除后显示墓碑卡 |
| `deploy_status` | 部署状态卡,ready 后可打开/复制预览 URL、下载源码包/容器包 |
| `deploy_candidates` | 多个网页产物时列候选卡供用户选择部署目标 |
| `image_attachment` / `file_attachment` | 用户上传附件,缩略图/文件 chip,图片可点开放大 |

## 3. 多 Agent 接入(4 个 Adapter)✅

统一适配器层屏蔽平台差异,所有 adapter 产出同一套 `StreamEvent`:

| Adapter | 底层 | 一句话 |
|---|---|---|
| **Claude Code** | `@anthropic-ai/claude-agent-sdk` | 把整个 Claude Code 接进来当一个 Agent |
| **Codex** | `@openai/codex-sdk` | OpenAI Codex,线程续接 + 运行时隔离 |
| **Custom Agent** | OpenAI Chat Completions 协议 | DeepSeek / OpenAI / 火山方舟 / 任意兼容端点 |
| **Mock** | 假事件流 | 开发期不烧 token |

### Claude Code adapter 细节
- SDK 内置全套工具(Bash / Read / Write / Edit / Grep / Glob / WebFetch / WebSearch / Task / TodoWrite 等)——内置「资料研究员」的联网检索能力来源于此
- **审批桥(canUseTool)**:每次 SDK 工具调用前过 AgentHub 安全策略——路径沙箱、Bash 黑名单 + 关键命令审批、fs_write 双栏 diff 审批
- Session 续接(SDK session resume);撤回/编辑/重生成/压缩时自动清理 session
- 通过进程内 MCP server 额外获得 AgentHub 工具:write_artifact / read_artifact / deploy_artifact / deploy_workspace / ask_user / report_task_result
- 支持 OAuth 订阅令牌(sk-ant-oat)、第三方网关 Base URL、本机已登录 Claude Code 直接兜底

### Codex adapter 细节
- Review 模式 read-only sandbox(SDK 无审批 hook,故不许自动写盘);Auto 模式 workspace-write
- 线程续接(按会话 + Agent 缓存 threadId)
- 运行时隔离:独立 `CODEX_HOME`,不读用户本机 `~/.codex`
- 通过 stdio MCP bridge 获得与 Claude Code 相同的 6 个 AgentHub 工具
- Base URL 仅接受 Codex/Responses 兼容端点(Chat Completions-only 的 DeepSeek 等请走 Custom)

### Custom adapter 细节
- 自驱 tool loop(最多 8 轮),网络/限流错误自动重试 2 次(指数退避)
- DeepSeek 思考链(reasoning_content)处理与回传
- 多模态:supportsVision 开启后图片以 base64 投给 LLM
- 消费 AgentHub 注入的跨 run 历史(见 §10)
- Anthropic provider 路径 📋 未实装(选了会在发消息时报错)

### 共通
- API Key 四层解析:per-agent key → 设置面板 → 环境变量 → (仅 Claude Code)OAuth 凭据
- 所有真实 adapter 上报 token usage(输入/输出/缓存)

## 4. 自建 Agent(Agent Builder)✅

前端表单创建/编辑 Agent,无需改代码。两种入口:**对话式创建**(描述意图 → 生成草稿 → review)或**详细配置**。

可配置项:
- **身份**:name、description、capabilities
- **行为**:systemPrompt(预填模板可改)
- **底层**:adapter(custom / claude-code / codex)、modelProvider + modelId
- **凭据**:per-agent apiKey(最高优先级)、apiBaseUrl
- **能力**:工具集勾选 + supportsVision(仅 custom;SDK adapter 用各自内置工具集)
- 4 个一键工具预设:全栈通用 / 本地代码 / 产物交付 / 审查验证

规则与限制:
- 内置 Agent 可改配置不可删;自建可删
- 自建不能成为 Orchestrator(📋 待开放)
- 📋 待办:Avatar 选择器、Agent 配置导入/导出、删除二次确认

## 5. 内置 Agent:写作编辑部(6 个)✅

首次启动自动 seed 一支「写作编辑部」,产物链路:资料简报 → 写作 Brief + 提纲 → 初稿 → 润色稿 → 审校报告。

| 名字 | 头像 | 角色 | adapter / 模型 |
|---|---|---|---|
| 主编 | 🎯 | 唯一 Orchestrator:理解目标、拆任务、分派、聚合定稿 | custom / deepseek-v4-flash |
| 资料研究员 | 🔎 | 联网检索、抓网页、读附件,产出带出处的资料简报 | claude-code / claude-opus-4-8 |
| 内容策划 | 🧭 | 产出写作 Brief + 结构提纲 | custom / deepseek-v4-flash |
| 主笔 | ✍️ | 写完整 Markdown 初稿 | custom / deepseek-v4 |
| 润色编辑 | ✨ | 语言润色、结构优化,产出新版本 | custom / deepseek-v4 |
| 审校 | 🔍 | 终审事实/逻辑/一致性,输出审校报告 | custom / deepseek-v4-flash |

## 6. Orchestrator 编排 ✅

Orchestrator 是**特殊 Agent 而非独立服务**:群聊里不 @ 任何人时自动接管;@ 了具体 Agent 则直接派给它;单聊不参与。三阶段:

### Stage 1 — PLAN(计划)
- 可先用 `ask_user` 发结构化澄清问题(2–4 个选项)
- 强制调 `plan_tasks` 输出结构化计划:每个任务含 id / 执行 Agent / 任务描述 / dependsOn / 预期产出 / 验收标准
- 计划编译:确定性推断缺失依赖(识别「t1 产物」「审查」等信号);语义校验(id 唯一、依赖存在、无循环,必须是 DAG)
- **计划审批**:执行前用户可批准 / 编辑 / 拒绝;编辑后重新编译校验

### Stage 2 — EXECUTE(执行)
- DAG 拓扑调度,同波次无依赖任务并行;全局并发上限默认 4
- 每个子任务在调度卡(dispatch plan card)中可视化实时状态
- **完成判定严格**:子 Agent 必须调 `report_task_result` 上报;status=complete 且验收标准全过才算完成;代码任务还须附成功验证命令证据(build/test/typecheck exitCode=0)
- 失败/中止 → 下游任务 skipped 级联;不自动重试、不自动换 Agent
- **动态重规划(自愈)**:一轮后仍有失败,把结果摘要喂回 Orchestrator 补救一轮(最多 1 轮补救);已完成任务不重做
- **级联中止**:父 run 中止时所有子任务级联中止
- **同波次代码冲突检测**:并行子任务经 `fs_write` 写同一文件且内容不同 → 检测并在聚合阶段向用户说明(检测 + 上报,不自动合并)。盲区:bash 写文件、SDK adapter 自写盘
- **子 Agent 上下文隔离**:只看到任务描述 + 最近 5 条对话 + pinned + 上游产物摘要(需全文自己 `read_artifact`),不看完整群聊历史

### Stage 3 — AGGREGATE(聚合)
- 生成聚合消息:完成情况、失败原因、产物链接、下一步建议

## 7. 工具系统(12 个内置工具)✅

| 工具 | 功能 | 关键参数 | 审批/限制 |
|---|---|---|---|
| `write_artifact` | 创建可预览产物 | type(web_app/document/image/ppt)、title、content | 无 |
| `read_artifact` | 读当前会话产物全文 | id | 限当前会话 |
| `deploy_artifact` | 发布 web_app 产物为本地静态站 | artifactId | 无 |
| `deploy_workspace` | 发布 workspace 里已构建的静态目录 | path、title?、entry? | ≤2000 文件 / 100MB |
| `read_attachment` | 读用户上传附件 | attachmentId | 文本截断 5 万字符;PDF 抽文本;图片走多模态 |
| `ask_user` | 向用户发结构化选择题 | 1–4 题,每题 2–4 选项,可多选 | 阻塞等回答 |
| `plan_tasks` | Orchestrator 拆解子任务 | reasoning、tasks | 仅 Orchestrator |
| `report_task_result` | 子任务上报语义结果 | status、summary、acceptanceResults、blockers | Runner 自动注入子 Agent |
| `fs_list` | 列 workspace 目录 | path(默认根) | 路径沙箱 |
| `fs_read` | 读 workspace 文本文件 | path | ≤1MB,截断 5 万字符,路径沙箱 |
| `fs_write` | 写 workspace 文本文件 | path、content | **走审批**:Review 模式弹双栏 diff / Auto 直写;≤100KB |
| `bash` | 在 workspace 内跑 shell 命令 | command | **黑名单拦截 + 关键命令审批**;30s 超时,输出截断 1 万字符 |

- **bash 关键命令审批**(命中需用户放行):装依赖(npm/pnpm/pip install)、可能丢改动的 git(reset/clean/checkout)、批量删除(rm -rf / find -delete)、权限变更(chmod/chown)、Docker、Windows Remove-Item -Recurse
- **fs_write 审批模式**:会话头部 Shield/Zap 图标切换 Review / Auto;用户手动编辑文件不走审批
- 工具错误不抛异常,包装成 tool_result 让 LLM 看到并自行处理
- 📋 `web_fetch`(通用抓 URL)未实装

## 8. 产物(Artifact)系统 ✅

产物与消息解耦,有独立生命周期、版本链、二次编辑。8 种类型:

| 类型 | 预览 | 编辑 | 导出 |
|---|---|---|---|
| `web_app` 网页应用 | iframe 沙箱预览 + 多文件源码视图 | ✅ 面板内编辑 → 新版本 | 部署为静态站 |
| `document` 文档 | Markdown 渲染 | ✅ | — |
| `ppt` 幻灯片 | 分页预览(翻页/页码/全屏)+ 主题配色 token | ✅ 编辑 JSON → 新版本 | **导出真 .pptx**(Office 可继续编辑) |
| `image` 图片 | 居中预览 | ❌ | — |
| `code_file` 代码文件 | 从 workspace 加载源码 | ✅ 写回文件 + 新版本 | — |
| `project` 多文件项目 | 只读文件树 + 源码浏览 | ❌ | ZIP |
| `diagram` 图表 | Mermaid 渲染(流程/架构/时序图) | — | .mmd |
| `diff` 差异 | 只读双栏 diff(历史兼容) | ❌ | — |

- **PPT 版式**:title / title-bullets / section / content / two-column / metrics / timeline / quote / blank;block 类型:heading / paragraph / bullets / metric / quote / timeline / columns / callout / divider / spacer
- **版本链**:新版本是新行(v2 → v1),不原地覆盖;三条建新版路径:Agent 驱动、用户面板内编辑(CodeMirror)、workspace 代码文件编辑
- **版本对比**:同链 2+ 版本可一键对比(document 比正文、web_app 逐文件、ppt 比 slides JSON)
- **产物库**:侧栏全局 tab,按时间倒序列所有产物,标注所属会话,点击跳转预览,可删除
- **安全**:iframe 强制 `sandbox="allow-scripts"`(不给 same-origin)+ CSP 双层隔离

### 部署与发布
- `deploy_artifact` / `deploy_workspace`:发布到本地静态目录,返回稳定预览 URL;提供源码包 ZIP、容器包 ZIP(含 Dockerfile / nginx.conf)下载
- **确定性部署命令**:用户直接发「部署 / 发布 / 上线 / /deploy」即触发,不经过 Agent;自动找常见静态产出目录(dist / build / out / client/dist),多候选时让用户选
- **外部静态发布**(可选):设置发布目录 + 公开根 URL 后,额外复制到外部目录并返回公开 URL(需用户自备 nginx / Caddy / Tailscale Serve)

## 9. Workspace 与安全沙箱 ✅

### 双模式 workspace
- **sandbox 模式**:文件存 `.agenthub-data/workspaces/<conversationId>/`,配额单目录 100MB / 1000 文件
- **local 模式**:会话绑定真实本地项目目录,不强制配额(用户用 git 自己管理);创建时 `isPathSafe` 拒绝敏感目录

### 安全模型(假设 LLM 输出不可信)
- 所有 fs_read / fs_write / bash 路径必须解析后落在 effective cwd 子树内;bash 的 cwd 强制为 effective cwd
- **双平台命令黑名单**(bash 工具与 Claude Code adapter 共享同一份):
  - POSIX:`rm -rf /`、`sudo`、`chmod 777 /`、fork bomb、`curl|bash`、`eval`、`exec`
  - Windows:删盘根、`Remove-Item -Recurse -Force`、`format`、`shutdown`、`reg delete`、`iex(iwr…)`、`Set-ExecutionPolicy`、`bcdedit` / `diskpart` 等
- 路径沙箱拒绝系统根目录与敏感子目录(`.ssh` / `.aws` / `.kube` / 凭据目录 / Windows 系统目录 / UNC 设备路径)
- API Key 本地存储(设置面板 / 环境变量 / per-agent),无托管 key 服务,不硬编码
- 已知限制:Claude Code SDK 自带写盘工具绕过 sandbox 配额(quota 只约束 AgentHub 管理的文件工具)

### 文件浏览器
- 会话内文件浏览面板(file explorer),浏览/打开 workspace 文件;fs_write 审批面板带双栏 diff

## 10. 跨 run 对话记忆 ✅

- **历史注入**:每轮自动序列化最近历史(默认 20 条 completed 消息)注入 LLM,解决「每次像新对话」
- **Agent 视角隔离**:群聊里他人发言以 `[名字]` 前缀作为 user 消息;丢弃 thinking / tool_use 等内部内容
- **产物不内联**:历史里产物折叠为 `[产物: title (id=…)]` 占位,需要全文 Agent 自己 `read_artifact`
- **Pinned 永久保留**:用户 pin 的消息无视截断永远注入
- **Token 预算**:按模型 contextWindow 自动估算,超预算从老到新丢弃非 pinned 项
- **手动压缩**:`/compact` 命令或用量 popover 一键压缩 → 生成长期摘要(原始消息不删),后续注入「摘要 + 未覆盖历史 + pinned」
- Claude Code / Codex 走各自 SDK session/线程续接,不消费注入历史

## 11. Token 计量与用量分析 ✅

- per-run / per-message 计量:输入 / 输出 / 缓存命中拆分
- 会话内 UsageBadge popover:累计 token、per-agent / per-model 拆分、当前上下文占用进度条(<50% 灰 / 50–80% 黄 / >80% 红)
- 侧栏全局「分析」tab:跨会话用量聚合

## 12. 设置面板 ✅

侧栏齿轮打开,3 个 tab:

| Tab | 配置项 |
|---|---|
| 供应商 Key | Anthropic API Key + Base URL(第三方网关)、OpenAI / DeepSeek / 火山方舟 API Key |
| 移动端 | Companion Mode(off / lan / tailnet)、设备 token(生成/复制/重新生成)、连接地址提示 |
| 发布 | 外部静态发布开关、发布目录、公开根 URL |

Key 优先级:agent.apiKey > 设置面板 > 环境变量(`.env.local`)。

## 13. 支持的 Provider / 模型 ✅

- **deepseek**:deepseek-chat / v4 / v4-flash(64K)、deepseek-reasoner / r1(128K,含思考链)
- **volcano-ark(火山方舟/豆包)**:doubao-seed-2-0-lite、豆包 pro 系列(32K–256K)
- **openai**:gpt-4o / 4o-mini / 4-turbo(128K)、o1 / o1-mini(reasoning)
- **openai-compatible**:任意兼容端点(通义千问 / 智谱 / MiniMax / OpenRouter / SiliconFlow / Moonshot 等),per-agent Base URL + Key
- **anthropic(经 Claude Code adapter)**:claude-opus-4-5/4-6/4-7、sonnet-4-5/4-6、haiku-4-5;opus-4-7[1m] 支持 100 万 token 上下文
- 各模型有精确上下文窗口表 + provider 级兜底

## 14. 桌面版(Electron)✅

- macOS DMG(arm64)/ Windows NSIS(x64)打包;`pnpm electron:dev` 开发、`pnpm electron:build` 打包
- 数据自动迁移到 userData 路径(macOS `~/Library/Application Support/AgentHub/data`,Windows `%APPDATA%/AgentHub/data`)
- `better-sqlite3` 在 Node ABI / Electron ABI 间按命令自动切换重建
- 📋 Linux 打包未配置

## 15. 平台抽象(Windows / POSIX)✅

- Shell 选择:POSIX 用用户 login shell(继承 nvm / Homebrew / pnpm 的 PATH);Windows 用 PowerShell 5.1 并强制 UTF-8(避免中文乱码)
- 子进程清理:POSIX 进程组 SIGTERM;Windows `taskkill /F /T` 递归杀进程树
- 多盘符目录选择器(DirPicker),过滤隐藏目录与 Windows 系统目录
- Windows 文件锁(EBUSY/EPERM)指数退避重试;symlink/junction 循环防护
- bash 工具描述按平台展示对应 shell 语法与黑名单文案

## 16. 移动端伴随 App ⏳

定位:Capacitor 手机 App 作**远程控制端**,桌面 AgentHub 是唯一 host(执行、文件、数据都留在桌面);网络优先 Tailscale,支持 LAN 直连。

已实现:
- 响应式 Web 已适配移动浏览器
- Capacitor 原生壳脚手架(`apps/mobile`,monorepo workspace)
- 桌面端 Companion Mode 设置(开关 / 设备 token / 连接地址提示)

📋 规划中(配对通信待打通):
- QR 配对流程、移动端聚合 API(snapshot / events / 操作)
- 手机上看会话与运行状态、审批 fs_write、回答 ask_user、发消息 / @Agent
- 推送通知、secure storage
- 明确非目标:手机不跑 Agent/LLM/工具,不做云同步,不做离线队列

## 17. 测试与工程质量 🟡

- Vitest 单元测试:security / workspace-utils / dispatch-plan / artifact-content / ppt-export / ppt-theme 等纯函数
- Playwright E2E:基建 + 核心 IM 流(mock agent);产物预览、群聊调度 E2E 待补
- TypeScript strict、`pnpm typecheck` / `pnpm lint` 全量门禁

---

## 设计中 / 未实现汇总 📋

| 项 | 状态 |
|---|---|
| 外部 MCP 工具接入(spec 15:接 filesystem / github / postgres 等第三方 MCP server) | 设计提案,未实现 |
| Custom adapter 的 Anthropic provider 路径 | 未实装 |
| 自建 Agent 成为 Orchestrator | 未开放 |
| Codex 写盘审批 hook | 受 SDK 限制,当前 Review 模式用 read-only sandbox 规避 |
| 冲突检测盲区(bash / SDK adapter 写盘) | 待补波次快照 |
| `web_fetch` 通用抓网页工具 | 未实装(联网检索目前靠 Claude Code adapter 内置 WebSearch/WebFetch) |
| 移动端配对通信 | 开发中 |
| PPT 图片 block、辅色语义着色 | 待深化 |

---

*备注:spec `07-tools.md` 的工具清单漏记了 `fs_list`(代码中已注册,见 `src/server/tools/registry.ts`),本清单以代码为准。*
