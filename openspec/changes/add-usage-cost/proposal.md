# add-usage-cost：主区用量页 + 价目表成本自算

## Why

设计稿（`docs/design/Helm-Agent.dc.html`）把用量分析定为**主区级页面**（880px：指标卡 / 按 Agent / 按模型价目表），并注明「国产模型 total_cost 不可信，成本按 token × 本地价目表自算」。现状是：usage 数据链路已完整（`run.usage` / `message.usage` 落库，`/api/usage/summary` 聚合，侧栏「分析」面板，会话 UsageBadge），但——

1. **没有成本概念**。个人用户最关心「这个月花了多少钱」，现在只能看 token 数心算。
2. **分析被挤在 262px 侧栏**。按 Agent / 按模型条形图在窄栏里可读性差，与设计稿主区页面差距大。redesign-ui-shell 任务 4.2 当时明确「主区用量页随 usage-cost 提案另行立项」——即本提案。
3. **聚合丢细分**。`byAgent` / `byModel` 输出只有 totalTokens，四段细分（input/output/cacheRead/cacheWrite）在 map 步被丢弃，算不了成本也看不了 cache 命中率。

## What Changes

- **本地价目表**：新 `src/shared/model-pricing.ts` —— `ModelPrice`（inputPer1M / outputPer1M / cacheReadPer1M? / cacheWritePer1M? / currency ∈ USD|CNY）+ 常见模型内置默认价（公开牌价快照，可过时，用户可覆盖）。用户覆盖存 `app_settings.model_prices`（JSON 列），与默认表按**字段级 merge**（覆盖 input/output 不丢默认 cache 价）。
- **成本纯自算**：cost = Σ(token 段 × 对应单价) / 1e6。不读任何 provider 返回的 total_cost。**未定价模型明确标注「未定价」且不计入总额**——不猜价。无 model 信息的 run 同样不计成本（UI 小字说明口径）。
- **多币种诚实呈现**：按 currency 分桶求和，总成本同时显示 `$` 与 `¥`，不做汇率折算。
- **`/api/usage/summary` 扩展**：byModel / byAgent 行带四段 token 细分；byModel 行带生效单价与成本；顶层加 `totalCost{usd,cny}`、`cacheRate`（= cacheRead / (input + cacheRead)）、`unpricedTokens`、生效价目表。
- **主区用量页**：`RailMode` 状态从 sidebar 本地提升为 app-store 切片；rail「分析」激活时主区渲染 880px 用量页（4 指标卡：总 tokens / 成本自算 / cache 命中率 / 总 run 数；按 Agent 条形行含头像与主用模型；按模型价目表，**单价行内可编辑**，保存即重算）。
- **侧栏分析面板瘦身**：改为 时间桶 + 按会话（条形 + token 数，点击跳会话并切回会话模式）；按 Agent / 按模型移入主区，职责去重。
- **UsageBadge 弹层加「成本（自算）」行**：per-conversation，按各 run 的 model 分别计价求和。
- **mock adapter 补 `run.usage` 发射**（固定数值、model `mock-model`），让 e2e 覆盖「产生用量 → 主区页面 → 行内定价 → 成本出现」全链路。

## Capabilities

### New Capabilities

- `usage-cost`：价目表模型、成本自算口径、主区用量页、多币种呈现边界。

### Modified Capabilities

- `persistence`：`app_settings` 新增 `model_prices` 列。
- `frontend`：railMode 提升为 store 切片（主区首个非会话视图先例）；侧栏分析面板职责收窄。

不新增 StreamEvent，不新增工具。

## Impact

- `src/shared/model-pricing.ts`（新）：类型 + 默认价目表 + resolve/computeCost 纯函数。
- `src/db/schema.ts` + bootstrap：`app_settings.model_prices` JSON 列。
- `src/server/settings-service.ts` + `/api/settings`：读写 modelPrices（zod）。
- `src/app/api/usage/summary/route.ts`：细分保留 + 成本 + cacheRate。
- `src/stores/app-store.ts`：`railMode` 切片。
- `src/components/usage-page.tsx`（新，主区）/ `usage-dashboard.tsx`（瘦身）/ `usage-badge.tsx`（成本行）/ `sidebar.tsx` / `icon-rail.tsx` / `src/app/page.tsx`（渲染分支）。
- `src/server/adapters/mock-adapter.ts`：run.usage 发射。
- `e2e/usage.spec.ts`（新）。
- Docs：specs/08（app_settings 列）、09（railMode 切片 / 组件树）、OVERVIEW 功能矩阵。
