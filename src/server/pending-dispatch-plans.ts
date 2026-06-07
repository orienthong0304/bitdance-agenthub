import type { DispatchPlanItem, PendingDispatchPlan } from '@/shared/types'

import { eventBus } from './event-bus'
import { newPendingDispatchPlanId } from './ids'

type PlanValidator = (plan: DispatchPlanItem[]) => DispatchPlanItem[]

interface PendingEntry {
  pendingPlan: PendingDispatchPlan
  resolver: ((plan: DispatchPlanItem[] | null) => void) | null
  validator: PlanValidator
}

export type PendingDispatchPlanResult =
  | { ok: true }
  | { ok: false; error: string }

class PendingDispatchPlansStore {
  private map = new Map<string, PendingEntry>()

  register(args: {
    conversationId: string
    agentId: string
    runId: string
    plan: DispatchPlanItem[]
    validator: PlanValidator
  }): PendingDispatchPlan {
    const id = newPendingDispatchPlanId()
    const pendingPlan: PendingDispatchPlan = {
      id,
      conversationId: args.conversationId,
      agentId: args.agentId,
      runId: args.runId,
      plan: args.plan,
      createdAt: Date.now(),
    }
    this.map.set(id, {
      pendingPlan,
      resolver: null,
      validator: args.validator,
    })

    eventBus.publish({
      type: 'dispatch.plan.pending',
      conversationId: args.conversationId,
      timestamp: pendingPlan.createdAt,
      pendingPlan,
    })

    return pendingPlan
  }

  attachResolver(
    id: string,
    resolver: (plan: DispatchPlanItem[] | null) => void,
  ): void {
    const entry = this.map.get(id)
    if (entry) entry.resolver = resolver
  }

  get(id: string): PendingDispatchPlan | undefined {
    return this.map.get(id)?.pendingPlan
  }

  listByConversation(conversationId: string): PendingDispatchPlan[] {
    return Array.from(this.map.values())
      .filter((entry) => entry.pendingPlan.conversationId === conversationId)
      .map((entry) => entry.pendingPlan)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  approve(id: string, plan: DispatchPlanItem[]): PendingDispatchPlanResult {
    const entry = this.map.get(id)
    if (!entry) return { ok: false, error: 'Pending dispatch plan not found' }

    let compiledPlan: DispatchPlanItem[]
    try {
      compiledPlan = entry.validator(plan)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }

    entry.resolver?.(compiledPlan)
    this.finalize(id, true)
    return { ok: true }
  }

  reject(id: string): boolean {
    const entry = this.map.get(id)
    if (!entry) return false
    entry.resolver?.(null)
    this.finalize(id, false)
    return true
  }

  cancel(id: string): void {
    const entry = this.map.get(id)
    if (!entry) return
    entry.resolver?.(null)
    this.finalize(id, false)
  }

  private finalize(id: string, approved: boolean): void {
    const entry = this.map.get(id)
    if (!entry) return
    this.map.delete(id)
    eventBus.publish({
      type: 'dispatch.plan.resolved',
      conversationId: entry.pendingPlan.conversationId,
      timestamp: Date.now(),
      pendingId: id,
      runId: entry.pendingPlan.runId,
      approved,
    })
  }
}

const globalForPDP = globalThis as unknown as {
  __agenthubPendingDispatchPlans?: PendingDispatchPlansStore
}

export const pendingDispatchPlans =
  globalForPDP.__agenthubPendingDispatchPlans ?? new PendingDispatchPlansStore()

if (!globalForPDP.__agenthubPendingDispatchPlans) {
  globalForPDP.__agenthubPendingDispatchPlans = pendingDispatchPlans
}
