# add-usage-cost Tasks

## 1. 定价领域 + 聚合扩展（server / shared）

- [ ] 1.1 `src/shared/model-pricing.ts`：`ModelPrice` / `ModelPriceTable` 类型、`DEFAULT_MODEL_PRICES`（公开牌价快照，注明日期；拿不准的模型不录）、`resolvePriceTable`（字段级 merge）、`computeBucketCost` / `formatCost` 纯函数。
- [ ] 1.2 `app_settings.model_prices` JSON 列（schema + bootstrap DDL + drizzle 同步）+ settings-service / `/api/settings` PATCH 读写（zod）。
- [ ] 1.3 `/api/usage/summary` 扩展：byModel / byAgent 行保留四段 token 细分；byModel 带生效单价与成本；byAgent 带 avatar 与主用 model；顶层 `totalCost{usd,cny}` / `cacheRate` / `unpricedTokens` / `pricing`。
- [ ] 1.4 纯函数单测：computeBucketCost（含 cache 段 / 缺省 cache 价）、resolvePriceTable（字段级 merge）、cacheRate（div0）、formatCost（双币/单币/零）。

## 2. 主区用量页 + rail 提升（UI）

- [ ] 2.1 `railMode` 提升为 app-store 切片；sidebar / icon-rail 改读 store；ui-command（open-agents / open-tasks）行为不变。
- [ ] 2.2 `src/app/page.tsx`：railMode === 'analytics' 时主区渲染新 `usage-page.tsx`（880px：4 指标卡 / 按 Agent / 按模型价目表）。
- [ ] 2.3 按模型表单价行内编辑（输入/输出单价 + 币种，PATCH settings 后重拉 summary 重算）。
- [ ] 2.4 侧栏分析面板瘦身：时间桶 + 按会话（条形，点击跳会话并切回 conversations 模式）。
- [ ] 2.5 UsageBadge 弹层加「成本（自算）」行（client 用 shared 定价函数 + settings overrides）。

## 3. Mock 用量 + E2E + 文档

- [ ] 3.1 mock adapter 每脚本收尾发 `run.usage`（固定数值，model `mock-model`；不入默认价目表）。
- [ ] 3.2 `e2e/usage.spec.ts`：发消息产生用量 → 打开分析 → 主区卡片非零 → mock-model 行「未定价」→ 行内定价 → 成本出现；UsageBadge 弹层成本行。
- [ ] 3.3 文档同步：specs/08（app_settings 列）、specs/09（railMode 切片 / usage-page 组件树）、OVERVIEW 功能矩阵；本 tasks.md 勾选。
