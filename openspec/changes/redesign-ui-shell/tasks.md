## 1. Phase A — 设计 token

- [x] 1.1 globals.css：primary → teal-600（dark 用 teal-500），ring / sidebar-primary / chart-1 随动；destructive → red-600；radius 基准 0.5rem。
- [x] 1.2 清理组件中硬编码 `#3370FF` / `#2860e5`（25 处）改用 `bg-primary` / `text-primary` 等 token 类。
- [x] 1.3 全量 e2e + 单测回归（纯样式改动不应破坏任何选择器）。

## 2. Phase B — 应用壳（Icon Rail + Secondary Panel）

- [x] 2.1 新组件 `icon-rail.tsx`：56px 竖栏（logo / 会话 / Agents / 产物 / 用量 / 设置 / 用户位），当前导航高亮 + 未读 badge。
- [x] 2.2 `sidebar.tsx` 重构为 262px 二级列表面板：会话态（置顶 / 最近分组 + 搜索 + 已归档折叠按钮）、Agent 库态、产物库态、用量态，样式对齐设计稿（行高 / 字号 / avatar 徽标 / Orchestrator 标签）。
- [x] 2.3 布局接线：`page.tsx` 组装 rail + panel + chat + dock；保留移动端响应式行为。
- [x] 2.4 E2E 选择器适配（新建对话按钮、产物库入口等）+ 全量回归。

## 3. Phase C — 聊天列

- [x] 3.1 会话头部（标题 / 成员 / 审批模式 toggle / 用量入口）对齐设计稿。
- [x] 3.2 消息流：气泡 / 工具卡 / 产物卡 / 调度卡视觉对齐（紧凑字号 11-13px 体系）。
- [x] 3.3 输入区：引用条 / 附件 / @提及 / 发送与中止按钮布局对齐。
- [x] 3.4 全量 e2e 回归。

## 4. Phase D — Workspace Dock（右侧）

- [x] 4.1 产物预览 dock 视觉对齐（空态「从左侧选择一个产物查看」、头部操作组）。
- [x] 4.2 用量详情视图：侧栏面板已对齐 token 体系（teal 8px 条 / mono 数字）；设计稿的主区 880px 用量页 + 成本自算价目表属新功能，随 usage-cost 提案另行立项。
- [x] 4.3 全量 e2e 回归。

## 5. Phase E — 弹窗族与反馈

- [x] 5.1 settings / new-conversation / create-agent（含向导步骤）/ skill-manager 弹窗对齐。
- [x] 5.2 fs_write diff 审批 / bash 审批 / ask_user / export word 弹窗对齐；toast 样式统一。
- [x] 5.3 全量 e2e 回归。

## 6. 文档

- [x] 6.1 `specs/09-frontend-architecture.md` 同步应用壳结构与 token 约定。
- [x] 6.2 OVERVIEW 功能矩阵 / 代码地图同步。
