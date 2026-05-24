import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  addAgentsToConversation,
  deleteConversation,
  renameConversation,
  setConversationApprovalMode,
  togglePinConversation,
} from '@/server/conversation-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  try {
    await deleteConversation(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 404 })
  }
}

const PatchBody = z
  .object({
    addAgentIds: z.array(z.string()).min(1).optional(),
    title: z.string().min(1).max(100).optional(),
    fsWriteApprovalMode: z.enum(['auto', 'review']).optional(),
    togglePin: z.literal(true).optional(),
  })
  .refine(
    (d) =>
      d.addAgentIds !== undefined ||
      d.title !== undefined ||
      d.fsWriteApprovalMode !== undefined ||
      d.togglePin !== undefined,
    { message: 'At least one of addAgentIds / title / fsWriteApprovalMode / togglePin is required' },
  )

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const raw = await req.json().catch(() => null)
  const parsed = PatchBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    let conversation
    if (parsed.data.title !== undefined) {
      conversation = await renameConversation(id, parsed.data.title)
    }
    if (parsed.data.addAgentIds !== undefined) {
      conversation = await addAgentsToConversation({
        conversationId: id,
        agentIds: parsed.data.addAgentIds,
      })
    }
    if (parsed.data.fsWriteApprovalMode !== undefined) {
      conversation = await setConversationApprovalMode(id, parsed.data.fsWriteApprovalMode)
    }
    if (parsed.data.togglePin) {
      conversation = await togglePinConversation(id)
    }
    return NextResponse.json({ conversation })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
