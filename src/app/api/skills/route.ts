import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { importSkillPackage, listSkillPackages } from '@/server/skills-service'

export async function GET() {
  try {
    const packages = await listSkillPackages()
    return NextResponse.json({ packages })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

const ImportBody = z
  .object({
    gitUrl: z.string().url().optional(),
    localPath: z.string().min(1).optional(),
  })
  .refine((d) => !!d.gitUrl !== !!d.localPath, {
    message: 'Provide exactly one of gitUrl or localPath',
  })

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null)
  const parsed = ImportBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const pkg = await importSkillPackage(parsed.data)
    return NextResponse.json({ package: pkg }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
