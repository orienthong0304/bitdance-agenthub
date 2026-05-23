import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createCustomAgent, listAgentsOrdered } from '@/server/agent-service'

export async function GET() {
  const agents = await listAgentsOrdered()
  return NextResponse.json({ agents })
}

const CreateBody = z.object({
  name: z.string().min(1).max(64),
  avatar: z.string().max(8).optional(),
  description: z.string().min(1).max(280),
  capabilities: z.array(z.string()).default([]),
  systemPrompt: z.string().min(1),
  modelProvider: z.enum(['anthropic', 'openai', 'deepseek']),
  modelId: z.string().min(1),
  toolNames: z.array(z.string()).default([]),
})

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null)
  const parsed = CreateBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const agent = await createCustomAgent({
      ...parsed.data,
      avatar: parsed.data.avatar ?? '',
    })
    return NextResponse.json({ agent }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
