import { describe, expect, it } from 'vitest'

import {
  computeBucketCost,
  formatCost,
  resolvePriceTable,
  type ModelPrice,
  type ModelPriceTable,
} from './model-pricing'

describe('computeBucketCost', () => {
  it('sums all four token segments at their per-1M rates', () => {
    const price: ModelPrice = {
      inputPer1M: 3,
      outputPer1M: 15,
      cacheReadPer1M: 0.3,
      cacheWritePer1M: 3.75,
      currency: 'USD',
    }
    // 1M input @3 + 0.5M output @15 + 2M cacheRead @0.3 + 0.1M cacheWrite @3.75
    const cost = computeBucketCost(
      { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 100_000 },
      price,
    )
    expect(cost).toBeCloseTo(3 + 7.5 + 0.6 + 0.375, 6)
  })

  it('matches the spec scenario: input 1M / output 0.5M @ $3/$15 = $10.50', () => {
    const price: ModelPrice = { inputPer1M: 3, outputPer1M: 15, currency: 'USD' }
    const cost = computeBucketCost(
      { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 0, cacheCreationTokens: 0 },
      price,
    )
    expect(cost).toBeCloseTo(10.5, 6)
  })

  it('treats missing cache prices as 0', () => {
    const price: ModelPrice = { inputPer1M: 2, outputPer1M: 8, currency: 'CNY' }
    const cost = computeBucketCost(
      { inputTokens: 500_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 },
      price,
    )
    // cache segments contribute nothing when unpriced
    expect(cost).toBeCloseTo(1, 6)
  })
})

describe('resolvePriceTable', () => {
  it('returns a copy of the defaults when no overrides', () => {
    const resolved = resolvePriceTable(null)
    expect(resolved['claude-opus-4-8']).toEqual({
      inputPer1M: 5,
      outputPer1M: 25,
      cacheReadPer1M: 0.5,
      cacheWritePer1M: 6.25,
      currency: 'USD',
    })
  })

  it('field-level merges without dropping the default cache prices', () => {
    const overrides: ModelPriceTable = {
      // only input/output/currency filled — cache prices omitted
      'claude-opus-4-8': { inputPer1M: 4, outputPer1M: 20, currency: 'USD' },
    }
    const resolved = resolvePriceTable(overrides)
    expect(resolved['claude-opus-4-8']).toEqual({
      inputPer1M: 4,
      outputPer1M: 20,
      cacheReadPer1M: 0.5, // default preserved
      cacheWritePer1M: 6.25, // default preserved
      currency: 'USD',
    })
  })

  it('adds override-only models (previously unpriced)', () => {
    const overrides: ModelPriceTable = {
      'mock-model': { inputPer1M: 1, outputPer1M: 2, currency: 'USD' },
    }
    const resolved = resolvePriceTable(overrides)
    expect(resolved['mock-model']).toEqual({ inputPer1M: 1, outputPer1M: 2, currency: 'USD' })
  })

  it('does not mutate the default table across calls', () => {
    resolvePriceTable({ 'claude-opus-4-8': { inputPer1M: 99, outputPer1M: 99, currency: 'USD' } })
    const untouched = resolvePriceTable(null)
    expect(untouched['claude-opus-4-8'].inputPer1M).toBe(5)
  })
})

describe('formatCost', () => {
  it('shows both currencies joined when both present', () => {
    expect(formatCost(1.23, 4.56)).toBe('$1.23 · ¥4.56')
  })

  it('shows only the single non-zero currency', () => {
    expect(formatCost(1.5, 0)).toBe('$1.50')
    expect(formatCost(0, 4.5)).toBe('¥4.50')
  })

  it('shows a dash when both are zero', () => {
    expect(formatCost(0, 0)).toBe('—')
  })
})
