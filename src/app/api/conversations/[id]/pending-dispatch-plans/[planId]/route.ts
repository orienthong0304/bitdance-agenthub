import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { pendingDispatchPlans } from '@/server/pending-dispatch-plans'

interface RouteContext {
  params: Promise<{ id: string; planId: string }>
}

const ExpectedOutputSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['web_app', 'document', 'image', 'ppt']),
  required: z.boolean().optional(),
  description: z.string().optional(),
})

const InputSchema = z.object({
  fromTaskId: z.string().min(1),
  outputId: z.string().min(1),
  required: z.boolean().optional(),
  description: z.string().optional(),
})

const TaskSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  task: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).optional(),
  expectedOutputs: z.array(ExpectedOutputSchema).optional(),
  inputs: z.array(InputSchema).optional(),
  acceptanceCriteria: z.array(z.string().min(1)).optional(),
})

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    plan: z.array(TaskSchema).min(1),
  }),
  z.object({
    action: z.literal('reject'),
  }),
])

/** POST /api/conversations/:id/pending-dispatch-plans/:planId */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, planId } = await ctx.params
  const raw = await req.json().catch(() => null)
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  const existing = pendingDispatchPlans.get(planId)
  if (!existing || existing.conversationId !== id) {
    return NextResponse.json({ error: 'Pending dispatch plan not found' }, { status: 404 })
  }

  if (parsed.data.action === 'reject') {
    const ok = pendingDispatchPlans.reject(planId)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to reject pending dispatch plan' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  const result = pendingDispatchPlans.approve(planId, parsed.data.plan)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
