## MODIFIED Requirements

### Requirement: 应用壳 SHALL 采用「图标栏 + 二级列表面板 + 聊天列 + 工作区坞」四段布局

应用左缘为 56px 图标栏（logo、会话 / Agents / 产物 / 用量导航、设置、用户位）；其右为 262px 二级列表面板，内容随当前导航切换；中部为聊天列；右侧为可开合的工作区坞（产物预览 / 详情）。

#### Scenario: 导航切换二级面板
- **WHEN** 用户点击图标栏的某个导航
- **THEN** 二级列表面板切换为对应内容（会话列表 / Agent 库 / 产物库 / 用量）
- **AND** 图标栏高亮当前导航，会话导航展示未读 badge。

#### Scenario: 会话列表分组
- **WHEN** 二级面板处于会话态
- **THEN** 列表按「置顶 / 最近」分组展示，支持搜索过滤
- **AND** 已归档会话折叠在底部入口中。

### Requirement: 设计 token SHALL 以 teal 为主色的统一体系

主色 teal（light `#0d9488` 档 / dark 提亮档），destructive 对齐 red-600，中性色 neutral 系，圆角基准 8px。组件 MUST 使用 CSS 变量 token（`primary` / `destructive` 等），不得硬编码品牌色值。

#### Scenario: 主题色一致性
- **WHEN** 任意组件需要品牌色 / 危险色
- **THEN** 使用 `bg-primary` / `text-destructive` 等 token 类
- **AND** light / dark 两套主题均由 globals.css 变量驱动。
