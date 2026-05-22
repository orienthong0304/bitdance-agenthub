import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { listMessages, sendMessage } from '@/server/conversation-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

const SendBody = z.object({
  content: z.string().min(1),
  mentionedAgentIds: z.array(z.string()).optional(),
})

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const messages = await listMessages(id)
  return NextResponse.json({ messages })
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const raw = await req.json().catch(() => null)
  const parsed = SendBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const result = await sendMessage({
      conversationId: id,
      content: parsed.data.content,
      mentionedAgentIds: parsed.data.mentionedAgentIds,
    })
    return NextResponse.json(result, { status: 202 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
