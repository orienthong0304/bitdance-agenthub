import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db, schema } from '@/db/client'
import { buildArtifactContent } from '@/server/artifact-content'
import { newArtifactId } from '@/server/ids'

import type { ToolDef } from './types'

/**
 * write_artifact —— 创建产物，或基于已有 artifactId 创建新版本（version 自增）。
 *
 * 用法：
 *  - 全新产物：传 type / title / content
 *  - 修改已有产物：额外传 parentArtifactId，新 row 的 version = parent.version + 1，
 *    parentArtifactId 链接父行；ArtifactPreviewPanel 的版本切换器据此构造版本链
 *
 * 仅写入 DB 并返回 artifactId；不直接发布 artifact.create 事件。Adapter 在 tool.result
 * 之后检测到返回值里的 artifactId 会统一发 artifact.create，AgentRunner 再注入
 * artifact_ref part 到当前 message。这样保证事件流的单一来源（来自 adapter）。
 *
 * 内容规整逻辑 buildArtifactContent 抽到 @/server/artifact-content，与用户面板的
 * createArtifactVersion 共用（单一校验来源）。
 */

const ArgsSchema = z.object({
  type: z.enum(['web_app', 'document', 'image', 'diff', 'ppt']),
  title: z.string().min(1),
  content: z.unknown(),
  /** 可选：已有产物的 id，传则创建该产物的新版本（version+1，parentArtifactId 链接） */
  parentArtifactId: z.string().optional(),
})

export const writeArtifactTool: ToolDef = {
  name: 'write_artifact',
  description:
    'Create a new artifact, or a new version of an existing one. Pass parentArtifactId to create a version that links to the prior; version auto-increments. Use this to produce code/web/docs/images that the user can preview.',
  parameters: {
    type: 'object',
    required: ['type', 'title', 'content'],
    properties: {
      type: {
        type: 'string',
        enum: ['web_app', 'document', 'image', 'diff', 'ppt'],
        description:
          'web_app for HTML/CSS/JS bundles, document for markdown text, image for URL or data URI, diff for a patch against an existing artifact, ppt for slide decks (structured JSON, exportable to a real .pptx)',
      },
      title: { type: 'string', description: 'Short human-readable title' },
      content: {
        type: 'object',
        description:
          'Artifact body — pass as a JSON OBJECT, do NOT JSON-stringify it into a quoted string. For web_app: { files: { "index.html": "...", "style.css"?, "script.js"? }, entry: "index.html" }. For document: { format: "markdown", content: "...markdown text..." }. For image: { url: "...", alt: "..." }. For diff: { targetArtifactId: "art_xxx", hunks: [{ oldStart, oldLines, newStart, newLines, lines: [" line", "-old", "+new"] }] } or { targetArtifactId, diff: "@@ -1 +1 @@\\n-old\\n+new" }. For ppt: { title?, theme?: { primaryColor?: "1E40AF", fontFace?: "Arial" }, slides: [{ title, bullets: ["point 1", "point 2"], notes?, layout?: "title"|"title-bullets"|"section" }] } — one slide per page, "title" for the cover and "title-bullets" (default) for content; bullets are plain text (no markdown); hex colors WITHOUT "#". Common mistake to avoid: sending content as a string like "{\\"format\\":\\"markdown\\",...}" — send the raw object, not its JSON text.',
      },
      parentArtifactId: {
        type: 'string',
        description:
          'Optional: id of an existing artifact to base a new version on. When provided, the new row links to it and version increments from the parent.',
      },
    },
  },
  async handler(args, ctx) {
    const parsed = ArgsSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `Invalid args: ${parsed.error.message}` }
    }

    const { type, title, content, parentArtifactId } = parsed.data
    const fullContent = buildArtifactContent(type, content)
    if (!fullContent) {
      return { ok: false, error: `Invalid content for type ${type}` }
    }

    let version = 1
    let resolvedParent: string | null = null
    if (parentArtifactId) {
      const parent = await db.query.artifacts.findFirst({
        where: eq(schema.artifacts.id, parentArtifactId),
      })
      if (!parent) {
        return { ok: false, error: `parentArtifactId not found: ${parentArtifactId}` }
      }
      if (parent.conversationId !== ctx.conversationId) {
        return { ok: false, error: 'parentArtifactId belongs to a different conversation' }
      }
      version = parent.version + 1
      resolvedParent = parent.id
    }

    const artifactId = newArtifactId()
    const createdAt = Date.now()

    await db.insert(schema.artifacts).values({
      id: artifactId,
      conversationId: ctx.conversationId,
      type,
      title,
      content: fullContent,
      version,
      parentArtifactId: resolvedParent,
      createdByAgentId: ctx.agentId,
      createdAt,
    })

    return {
      ok: true,
      value: { artifactId, title, type, version, parentArtifactId: resolvedParent },
    }
  },
}
