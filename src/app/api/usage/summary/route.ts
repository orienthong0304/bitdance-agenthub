import { inArray, isNotNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db, schema } from '@/db/client'
import type { RunUsage } from '@/db/schema'
import { getAppSettings } from '@/server/settings-service'
import {
  computeBucketCost,
  resolvePriceTable,
  type ModelPrice,
  type ModelPriceTable,
} from '@/shared/model-pricing'

/**
 * GET /api/usage/summary —— 全局 token 用量聚合 + 本地价目表成本自算。
 *
 * 成本口径（spec：usage-cost）：cost 不读 provider total_cost；未定价模型 cost=null 不计总额；
 * 无 model 的 run 不计成本；多币种分桶不折算；cacheRate = cacheRead / (input + cacheRead)。
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface UsageBucket {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  runs: number
}

/** byModel / byAgent 行携带的 token 细分，与 UsageBucket 同形。 */
export type UsageTokenBreakdown = UsageBucket

export interface UsageModelRow extends UsageTokenBreakdown {
  model: string
  /** 生效单价（默认 + 用户覆盖后）；未定价为 null */
  price: ModelPrice | null
  /** 成本（p.currency 的元）；未定价为 null，不计入 totalCost */
  cost: number | null
}

export interface UsageAgentRow extends UsageTokenBreakdown {
  agentId: string
  name: string
  avatar: string | null
  /** 该 agent token 数最多的 model；无 model 用量时 null */
  topModel: string | null
}

export interface UsageSummary {
  today: UsageBucket
  week: UsageBucket
  allTime: UsageBucket
  topConversations: Array<{
    id: string
    title: string
    totalTokens: number
    runs: number
    updatedAt: number
  }>
  byAgent: UsageAgentRow[]
  byModel: UsageModelRow[]
  /** 按币种分桶的成本总额（不折算） */
  totalCost: { usd: number; cny: number }
  /** allTime 桶的 cache 命中率；分母 0 → null */
  cacheRate: number | null
  /** 未计入成本的 token 数（未定价模型 + 无 model 的 run），供 UI 口径说明 */
  unpricedTokens: number
  /** 生效价目表（默认 + 用户覆盖），供 UI 展示与行内编辑基线 */
  pricing: ModelPriceTable
}

function empty(): UsageBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    runs: 0,
  }
}

function accumulate(b: UsageBucket, u: RunUsage) {
  b.inputTokens += u.inputTokens
  b.outputTokens += u.outputTokens
  b.cacheReadTokens += u.cacheReadTokens
  b.cacheCreationTokens += u.cacheCreationTokens
  // totalTokens = 所有处理过的 token（含 cache 读写）；与 ChatPanel UsageBadge 口径一致
  b.totalTokens +=
    u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens
  b.runs++
}

export async function GET() {
  // 拉取所有 usage 非空的 run（per-run JSON，量级几百~几万，全表扫够用）
  const runs = await db.query.agentRuns.findMany({
    where: isNotNull(schema.agentRuns.usage),
  })

  const now = Date.now()
  const todayStart = now - DAY_MS
  const weekStart = now - 7 * DAY_MS

  const today = empty()
  const week = empty()
  const allTime = empty()
  const byAgentMap = new Map<string, UsageBucket>()
  const byModelMap = new Map<string, UsageBucket>()
  const byConvMap = new Map<string, UsageBucket>()
  // per-agent 各 model 的 totalTokens，用来求 topModel
  const byAgentModelTokens = new Map<string, Map<string, number>>()

  for (const row of runs) {
    const u = row.usage as RunUsage | null
    if (!u) continue
    accumulate(allTime, u)
    if (row.startedAt >= weekStart) accumulate(week, u)
    if (row.startedAt >= todayStart) accumulate(today, u)

    let agentB = byAgentMap.get(row.agentId)
    if (!agentB) {
      agentB = empty()
      byAgentMap.set(row.agentId, agentB)
    }
    accumulate(agentB, u)

    if (u.model) {
      let modelB = byModelMap.get(u.model)
      if (!modelB) {
        modelB = empty()
        byModelMap.set(u.model, modelB)
      }
      accumulate(modelB, u)

      let perModel = byAgentModelTokens.get(row.agentId)
      if (!perModel) {
        perModel = new Map()
        byAgentModelTokens.set(row.agentId, perModel)
      }
      const runTokens =
        u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens
      perModel.set(u.model, (perModel.get(u.model) ?? 0) + runTokens)
    }

    let convB = byConvMap.get(row.conversationId)
    if (!convB) {
      convB = empty()
      byConvMap.set(row.conversationId, convB)
    }
    accumulate(convB, u)
  }

  // 生效价目表（默认 + 用户覆盖）
  const settings = await getAppSettings()
  const pricing = resolvePriceTable(settings.modelPrices)

  // 拉 agent 名称 + 头像
  const agentRows =
    byAgentMap.size > 0
      ? await db.query.agents.findMany({
          where: inArray(schema.agents.id, Array.from(byAgentMap.keys())),
        })
      : []
  const agentById = new Map(agentRows.map((a) => [a.id, a]))

  // 拉 conversation 标题 + 排序按 totalTokens 取 top 10
  const topConvIds = Array.from(byConvMap.entries())
    .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
    .slice(0, 10)
    .map(([id]) => id)
  const convRows =
    topConvIds.length > 0
      ? await db.query.conversations.findMany({
          where: inArray(schema.conversations.id, topConvIds),
        })
      : []
  const convById = new Map(convRows.map((c) => [c.id, c]))

  // byModel：保留四段细分 + 计价
  const totalCost = { usd: 0, cny: 0 }
  let unpricedTokens = 0
  const byModel: UsageModelRow[] = Array.from(byModelMap.entries())
    .map(([model, b]) => {
      const price = pricing[model] ?? null
      let cost: number | null = null
      if (price) {
        cost = computeBucketCost(b, price)
        if (price.currency === 'USD') totalCost.usd += cost
        else totalCost.cny += cost
      } else {
        unpricedTokens += b.totalTokens
      }
      return { model, ...b, price, cost }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)

  // 无 model 的 run 同样不计成本 —— 计入 unpricedTokens 让 UI 诚实提示
  const modeledTotal = byModel.reduce((s, r) => s + r.totalTokens, 0)
  unpricedTokens += allTime.totalTokens - modeledTotal

  // cacheRate（allTime）：cacheRead / (input + cacheRead)，分母 0 → null
  const cacheDenom = allTime.inputTokens + allTime.cacheReadTokens
  const cacheRate = cacheDenom > 0 ? allTime.cacheReadTokens / cacheDenom : null

  // byAgent：保留四段细分 + 头像 + topModel
  const byAgent: UsageAgentRow[] = Array.from(byAgentMap.entries())
    .map(([agentId, b]) => {
      const a = agentById.get(agentId)
      const perModel = byAgentModelTokens.get(agentId)
      let topModel: string | null = null
      if (perModel) {
        let best = -1
        for (const [model, tok] of perModel) {
          if (tok > best) {
            best = tok
            topModel = model
          }
        }
      }
      return {
        agentId,
        name: a?.name ?? agentId,
        avatar: a?.avatar ?? null,
        topModel,
        ...b,
      }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const summary: UsageSummary = {
    today,
    week,
    allTime,
    topConversations: topConvIds
      .map((id) => {
        const c = convById.get(id)
        const b = byConvMap.get(id)
        if (!c || !b) return null
        return {
          id,
          title: c.title,
          totalTokens: b.totalTokens,
          runs: b.runs,
          updatedAt: c.updatedAt,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    byAgent,
    byModel,
    totalCost,
    cacheRate,
    unpricedTokens,
    pricing,
  }

  return NextResponse.json(summary)
}
