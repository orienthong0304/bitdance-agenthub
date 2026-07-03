/**
 * 本地价目表 —— 成本纯自算，不信任 provider 返回的 total_cost。
 *
 * 默认价是公开牌价快照（见 DEFAULT_MODEL_PRICES 上的快照日期），可能过时；
 * 用户可在用量页行内覆盖，覆盖存 app_settings.model_prices，按字段级 merge
 * （只覆盖填写的字段，未填字段沿用默认值）。
 *
 * 详见 openspec/changes/add-usage-cost/specs/usage-cost/spec.md。
 */

export interface ModelPrice {
  inputPer1M: number
  outputPer1M: number
  /** 缺省按 0 计 */
  cacheReadPer1M?: number
  /** 缺省按 0 计 */
  cacheWritePer1M?: number
  currency: 'USD' | 'CNY'
}

export type ModelPriceTable = Record<string, ModelPrice>

/**
 * 内置默认价目表 —— 公开牌价快照（2026-07-03）。用户可在用量页覆盖。
 *
 * 只录能确证的公开牌价（拿不准的不录，成本上未定价诚实优先）：
 * - Anthropic Claude opus/sonnet/haiku 系（USD，含 cache 读 = 0.1×input、cache 写 = 1.25×input）
 * - OpenAI gpt-4o 系（USD，含 cache 读）
 * - DeepSeek chat/reasoner（CNY，prompt_cache_hit 映射到 cacheRead）
 */
export const DEFAULT_MODEL_PRICES: ModelPriceTable = {
  // ─── Anthropic (USD) ───────────────────────────────
  'claude-opus-4-8': { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25, currency: 'USD' },
  'claude-opus-4-8[1m]': { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25, currency: 'USD' },
  'claude-opus-4-7': { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25, currency: 'USD' },
  'claude-opus-4-7[1m]': { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25, currency: 'USD' },
  'claude-opus-4-6': { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25, currency: 'USD' },
  'claude-opus-4-5': { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25, currency: 'USD' },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75, currency: 'USD' },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75, currency: 'USD' },
  'claude-3-5-sonnet-latest': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75, currency: 'USD' },
  'claude-haiku-4-5-20251001': { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25, currency: 'USD' },

  // ─── OpenAI (USD) ──────────────────────────────────
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, cacheReadPer1M: 1.25, currency: 'USD' },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.075, currency: 'USD' },

  // ─── DeepSeek (CNY，prompt_cache_hit → cacheRead) ────
  'deepseek-chat': { inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.5, currency: 'CNY' },
  'deepseek-reasoner': { inputPer1M: 4, outputPer1M: 16, cacheReadPer1M: 1, currency: 'CNY' },
}

/**
 * 生效价目表 = 内置默认 + 用户覆盖（字段级 merge）。
 * 同 model 条目只覆盖 override 里已填的字段（未填沿用默认，不丢默认 cache 价）；
 * override 独有的模型直接加入。
 */
export function resolvePriceTable(overrides: ModelPriceTable | null | undefined): ModelPriceTable {
  const resolved: ModelPriceTable = { ...DEFAULT_MODEL_PRICES }
  if (!overrides) return resolved
  for (const [model, override] of Object.entries(overrides)) {
    const base = resolved[model]
    resolved[model] = base ? mergePrice(base, override) : override
  }
  return resolved
}

/** 字段级 merge：只用 override 里 defined 的字段覆盖 base，其余沿用 base。 */
function mergePrice(base: ModelPrice, override: ModelPrice): ModelPrice {
  const merged: ModelPrice = { ...base }
  if (override.inputPer1M !== undefined) merged.inputPer1M = override.inputPer1M
  if (override.outputPer1M !== undefined) merged.outputPer1M = override.outputPer1M
  if (override.cacheReadPer1M !== undefined) merged.cacheReadPer1M = override.cacheReadPer1M
  if (override.cacheWritePer1M !== undefined) merged.cacheWritePer1M = override.cacheWritePer1M
  if (override.currency !== undefined) merged.currency = override.currency
  return merged
}

/** 成本 = Σ(token 段 × 对应单价) / 1e6，缺省 cache 价按 0。单位 = p.currency 的元。 */
export function computeBucketCost(
  b: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number },
  p: ModelPrice,
): number {
  return (
    b.inputTokens * p.inputPer1M +
    b.outputTokens * p.outputPer1M +
    b.cacheReadTokens * (p.cacheReadPer1M ?? 0) +
    b.cacheCreationTokens * (p.cacheWritePer1M ?? 0)
  ) / 1_000_000
}

/** '$1.23 · ¥4.56' / 单币种只显一个 / 全零 '—'。 */
export function formatCost(usd: number, cny: number): string {
  const parts: string[] = []
  if (usd > 0) parts.push(`$${usd.toFixed(2)}`)
  if (cny > 0) parts.push(`¥${cny.toFixed(2)}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}
