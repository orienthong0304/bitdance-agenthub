import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createBoardTask, listBoardTasks } from '@/server/task-service'

export async function GET() {
  try {
    const tasks = await listBoardTasks()
    return NextResponse.json({ tasks })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

const CreateBody = z
  .object({
    title: z.string().min(1).max(120),
    note: z.string().max(2000).optional(),
  })
  .strict()

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null)
  const parsed = CreateBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const task = await createBoardTask({ ...parsed.data, source: 'manual' })
    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
