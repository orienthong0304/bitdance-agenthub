## Why

用户用 Claude Design 重新设计了整套 UI（`docs/design/Helm-Agent.dc.html`，源项目 claude.ai/design `16744dea-0459-4c5e-8611-c65b7844da55`），要求按设计稿改造现有界面。设计稿覆盖全应用：新的三栏 + 图标栏应用壳、聊天列、工作区坞、全部弹窗（含 Agent Skills 管理、审批、导出），并统一了配色 / 字号 / 圆角体系。

## What Changes

- **设计 token**：主色从字节蓝 `#3370FF` 切换为 teal `#0d9488`（dark 模式提亮档），destructive 对齐 red-600，圆角基准 8px，中性色维持 neutral 系；清理组件里硬编码的 `#3370FF`（25 处）改用 `primary` token。
- **应用壳重构**：现有单侧栏（4 个 tab 按钮 + 列表同栏）改为「56px 图标栏（Icon Rail）+ 262px 二级列表面板（Secondary List Panel）」。图标栏：logo、会话 / Agents / 产物 / 用量四个导航（带未读 badge）、底部设置与用户位。二级面板按导航切换：会话列表（置顶 / 最近分组 + 搜索 + 已归档折叠）、Agent 库、产物库、用量分析。
- **聊天列 / 工作区坞 / 弹窗族**：按设计稿分阶段对齐样式与信息层级（消息流、输入区、产物 dock、settings / create-agent / new-conversation / skill-manager / 审批 / export / toast）。
- 保持既有功能语义与 StreamEvent / API 契约不变——这是**视觉与信息架构重构，不是功能变更**。设计稿中的「用量成本自算（价目表）」是新功能，**不在本变更范围**，单独提案。

## Capabilities

### Modified Capabilities

- `frontend`：应用壳布局结构、设计 token、组件视觉规范。

## Impact

- `src/app/globals.css`：palette / radius token。
- `src/components/sidebar.tsx` → 拆分为 icon rail + secondary panel（新组件）。
- `src/components/` 各 UI 组件分阶段重构样式；硬编码色值清理。
- `e2e/`：选择器随布局调整同步适配（每阶段跑全量 e2e 回归）。
- `specs/09-frontend-architecture.md`：应用壳结构文档同步。
