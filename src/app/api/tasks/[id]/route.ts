import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { deleteBoardTask, updateBoardTask } from '@/server/task-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

const PatchBody = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    note: z.string().trim().max(2000).optional(),
    status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
  })
  .strict()

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const raw = await req.json().catch(() => null)
  const parsed = PatchBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const task = await updateBoardTask(id, parsed.data)
    return NextResponse.json({ task })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  try {
    await deleteBoardTask(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
