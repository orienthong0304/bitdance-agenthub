import { z } from 'zod'

import { db, schema } from '@/db/client'
import { eventBus } from '@/server/event-bus'
import { newArtifactId } from '@/server/ids'
import type { ArtifactContent, ArtifactType } from '@/shared/types'

import type { ToolDef } from './types'

/**
 * write_artifact —— 创建一个新产物。修改已有产物请通过新版本（递增 version + parentArtifactId）。
 *
 * MVP 阶段仅支持 web_app / document / image 三种 DB 类型；code_file 需配合 workspace
 * 写入逻辑（后续 milestone）。
 */

const ArgsSchema = z.object({
  type: z.enum(['web_app', 'document', 'image']),
  title: z.string().min(1),
  content: z.unknown(),
})

export const writeArtifactTool: ToolDef = {
  name: 'write_artifact',
  description: 'Create a new artifact in the current conversation. Use this to produce code/web/docs/images that the user can preview.',
  parameters: {
    type: 'object',
    required: ['type', 'title', 'content'],
    properties: {
      type: {
        type: 'string',
        enum: ['web_app', 'document', 'image'],
        description: 'web_app for HTML/CSS/JS bundles, document for markdown text, image for URL or data URI',
      },
      title: { type: 'string', description: 'Short human-readable title' },
      content: {
        type: 'object',
        description:
          'Artifact body. For web_app: { files: { "index.html": "...", "style.css"?, "script.js"? }, entry: "index.html" }. For document: { format: "markdown", content: "..." }. For image: { url: "...", alt: "..." }',
      },
    },
  },
  async handler(args, ctx) {
    const parsed = ArgsSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `Invalid args: ${parsed.error.message}` }
    }

    const { type, title, content } = parsed.data
    const fullContent = buildArtifactContent(type, content)
    if (!fullContent) {
      return { ok: false, error: `Invalid content for type ${type}` }
    }

    const artifactId = newArtifactId()
    const createdAt = Date.now()

    await db.insert(schema.artifacts).values({
      id: artifactId,
      conversationId: ctx.conversationId,
      type,
      title,
      content: fullContent,
      version: 1,
      createdByAgentId: ctx.agentId,
      createdAt,
    })

    eventBus.publish({
      type: 'artifact.create',
      conversationId: ctx.conversationId,
      timestamp: createdAt,
      artifact: {
        id: artifactId,
        conversationId: ctx.conversationId,
        type,
        title,
        content: fullContent,
        version: 1,
        createdByAgentId: ctx.agentId,
        createdAt,
      },
    })

    return { ok: true, value: { artifactId, title, type } }
  },
}

function buildArtifactContent(type: ArtifactType, raw: unknown): ArtifactContent | null {
  if (!raw || typeof raw !== 'object') return null

  if (type === 'web_app') {
    const obj = raw as { files?: Record<string, string>; entry?: string }
    if (!obj.files || typeof obj.files !== 'object') return null
    return {
      type: 'web_app',
      files: obj.files,
      entry: obj.entry ?? 'index.html',
    }
  }

  if (type === 'document') {
    const obj = raw as { format?: string; content?: string }
    if (typeof obj.content !== 'string') return null
    return {
      type: 'document',
      format: 'markdown',
      content: obj.content,
    }
  }

  if (type === 'image') {
    const obj = raw as { url?: string; alt?: string }
    if (typeof obj.url !== 'string') return null
    return {
      type: 'image',
      url: obj.url,
      alt: obj.alt ?? '',
    }
  }

  return null
}
