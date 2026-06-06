import { eq } from 'drizzle-orm'
import JSZip from 'jszip'
import { NextResponse } from 'next/server'

import { db, schema } from '@/db/client'
import type { ArtifactContent } from '@/shared/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/artifacts/:id/export —— 产物一键导出。
 *
 * 按 type 分发：
 *  - web_app  → ZIP 含所有源码文件，文件名 `<title>-v<version>.zip`
 *  - document → 单 Markdown 文件 `<title>-v<version>.md`
 *  - image    → 302 跳转到 image.url（外部图片）
 *  - ppt      → pptxgenjs 生成真 .pptx 二进制
 *  - code_file / diff / 其它 → JSON dump
 */
export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params

  const row = await db.query.artifacts.findFirst({
    where: eq(schema.artifacts.id, id),
  })
  if (!row) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  }

  const safeTitle = sanitizeFileName(row.title) || 'artifact'
  const baseName = `${safeTitle}-v${row.version}`
  const content = row.content as ArtifactContent

  if (content.type === 'web_app') {
    const zip = new JSZip()
    for (const [name, body] of Object.entries(content.files)) {
      zip.file(name, body)
    }
    // README 提示如何打开
    zip.file(
      'README.txt',
      `Artifact: ${row.title}\nVersion: v${row.version}\nEntry: ${content.entry}\n\n` +
        `打开 ${content.entry} 即可在浏览器中查看。\n` +
        `导出时间: ${new Date().toISOString()}\n`,
    )
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}.zip"`,
      },
    })
  }

  if (content.type === 'document') {
    return new NextResponse(content.content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}.md"`,
      },
    })
  }

  if (content.type === 'image') {
    // 外部 URL：直接 302 让浏览器走原 URL
    return NextResponse.redirect(content.url, 302)
  }

  if (content.type === 'ppt') {
    const { slidesToPptxBuffer } = await import('@/server/ppt-export')
    const buf = await slidesToPptxBuffer(content, row.title)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}.pptx"`,
      },
    })
  }

  // 兜底：原始 JSON
  return new NextResponse(JSON.stringify(content, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}.json"`,
    },
  })
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60)
    .trim()
}
