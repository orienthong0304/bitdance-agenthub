import { describe, expect, it } from 'vitest'

import type { DispatchPlanItem } from '@/shared/types'

import { compileDispatchPlan, validateDispatchPlan } from './dispatch-plan'
import { pendingDispatchPlans } from './pending-dispatch-plans'

const agents = [{ id: 'ag_pm' }, { id: 'ag_frontend' }]

function validate(plan: DispatchPlanItem[]): DispatchPlanItem[] {
  const compiled = compileDispatchPlan(plan).plan
  validateDispatchPlan(compiled, agents, 'ag_orchestrator')
  return compiled
}

describe('pendingDispatchPlans', () => {
  it('resolves approval with the validated compiled plan', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_approve',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_approve',
      plan: [
        {
          id: 't1',
          agentId: 'ag_pm',
          task: 'Write PRD',
          expectedOutputs: [{ id: 'prd', type: 'document' }],
        },
      ],
      validator: validate,
    })
    let resolved: DispatchPlanItem[] | null | undefined
    pendingDispatchPlans.attachResolver(pending.id, (plan) => {
      resolved = plan
    })

    const result = pendingDispatchPlans.approve(pending.id, [
      {
        id: 't1',
        agentId: 'ag_pm',
        task: 'Write PRD',
        expectedOutputs: [{ id: 'prd', type: 'document' }],
      },
      {
        id: 't2',
        agentId: 'ag_frontend',
        task: 'Build UI',
        inputs: [{ fromTaskId: 't1', outputId: 'prd' }],
      },
    ])

    expect(result).toEqual({ ok: true })
    expect(resolved?.[1].dependsOn).toEqual(['t1'])
    expect(pendingDispatchPlans.get(pending.id)).toBeUndefined()
  })

  it('keeps invalid approvals pending', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_invalid',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_invalid',
      plan: [{ id: 't1', agentId: 'ag_pm', task: 'Write PRD' }],
      validator: validate,
    })
    let resolved = false
    pendingDispatchPlans.attachResolver(pending.id, () => {
      resolved = true
    })

    const result = pendingDispatchPlans.approve(pending.id, [
      { id: 't1', agentId: 'ag_missing', task: 'Write PRD' },
    ])

    expect(result.ok).toBe(false)
    expect(resolved).toBe(false)
    expect(pendingDispatchPlans.get(pending.id)).toBeDefined()
    expect(pendingDispatchPlans.reject(pending.id)).toBe(true)
  })

  it('resolves rejection with null and removes the pending plan', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_reject',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_reject',
      plan: [{ id: 't1', agentId: 'ag_pm', task: 'Write PRD' }],
      validator: validate,
    })
    let resolved: DispatchPlanItem[] | null | undefined
    pendingDispatchPlans.attachResolver(pending.id, (plan) => {
      resolved = plan
    })

    expect(pendingDispatchPlans.reject(pending.id)).toBe(true)
    expect(resolved).toBeNull()
    expect(pendingDispatchPlans.get(pending.id)).toBeUndefined()
  })
})
