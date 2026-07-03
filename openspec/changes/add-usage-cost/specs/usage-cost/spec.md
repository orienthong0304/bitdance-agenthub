# usage-cost Spec

## ADDED Requirements

### Requirement: 成本 SHALL 由本地价目表自算，不信任 provider 返回值

成本 = Σ(inputTokens × inputPer1M + outputTokens × outputPer1M + cacheReadTokens × cacheReadPer1M + cacheCreationTokens × cacheWritePer1M) / 1,000,000。系统 SHALL NOT 读取或展示任何 provider 返回的 total_cost 字段。价目表中不存在的模型 SHALL 标注「未定价」且不计入成本总额；usage 无 model 信息的 run 同样不计入（UI 说明口径）。

#### Scenario: 已定价模型
- **WHEN** 某模型累计 input 1M / output 0.5M tokens，价目为 $3 / $15 per 1M
- **THEN** 该模型成本显示 $10.50，并计入总成本卡。

#### Scenario: 未定价模型不猜价
- **WHEN** 某模型不在生效价目表中
- **THEN** 按模型表中该行成本列显示「未定价」
- **AND** 其 tokens 不计入总成本，页面提示存在未定价用量。

### Requirement: 价目表 SHALL 为「内置默认 + 用户覆盖」字段级合并

内置默认表是公开牌价快照（shared 常量，注明快照日期）。用户覆盖存 `app_settings.model_prices`，按模型条目做**字段级** merge（只覆盖填写的字段，未填字段沿用默认值）。覆盖保存后 SHALL 即时生效于所有成本展示处。

#### Scenario: 行内改价即时重算
- **WHEN** 用户在主区「按模型」表对某模型行内编辑输入/输出单价并保存
- **THEN** 覆盖写入 app_settings，页面成本与总成本卡立即按新价重算
- **AND** 该模型默认表中已有的 cache 单价不因本次覆盖丢失。

#### Scenario: 为未定价模型定价
- **WHEN** 用户对「未定价」模型填入单价（含币种）
- **THEN** 该模型开始计价并计入对应币种总额。

#### Scenario: 切换币种的覆盖视为整条替换
- **WHEN** 用户覆盖某模型的币种，使其与默认表条目的币种不同（如默认 USD 改为 CNY）
- **THEN** 该模型条目**整条替换**为用户覆盖，不做字段级 merge（默认表里旧币种的 cache 单价不并入新币种计费；用户未填的 cache 单价按 0 计）。

### Requirement: 多币种 SHALL 分桶求和，不做汇率折算

每个价目条目携带 currency（USD 或 CNY）。总成本按币种分别求和，同时展示（如 `$1.23 · ¥4.56`）；单一币种时只显示该币种；无成本时显示 `—`。

#### Scenario: 双币种并存
- **WHEN** 用量同时包含 USD 计价（Claude）与 CNY 计价（DeepSeek）模型
- **THEN** 成本卡同时显示两个币种的金额，互不折算。

### Requirement: 用量分析 SHALL 是主区级页面

rail「分析」激活时，主区 SHALL 渲染 880px 用量页：四指标卡（总 tokens / 成本自算 / cache 命中率 / 总 run 数）、按 Agent 条形行（头像 + 主用模型 + token 数）、按模型价目表（单价 / tokens / 成本，单价行内可编辑）。侧栏分析面板收窄为 时间桶 + 按会话列表。cache 命中率定义为 cacheReadTokens / (inputTokens + cacheReadTokens)，分母为 0 时显示 `—`。

#### Scenario: 打开分析
- **WHEN** 用户点击 rail「分析」
- **THEN** 主区显示用量页，侧栏显示按会话用量列表。

#### Scenario: 从分析跳回会话
- **WHEN** 用户点击侧栏按会话列表中的某会话
- **THEN** 激活该会话并切回会话模式（主区恢复聊天视图）。

### Requirement: 会话 UsageBadge SHALL 显示本会话成本（自算）

UsageBadge 弹层在 token 细分之后 SHALL 显示「成本（自算）」行：按本会话各 run 的 model 分别计价求和，口径与主区一致（未定价 / 无 model 的 run 不计入）。

#### Scenario: 徽章成本行
- **WHEN** 会话内存在已定价模型的用量
- **THEN** 弹层显示该会话累计成本（多币种规则同上）。
