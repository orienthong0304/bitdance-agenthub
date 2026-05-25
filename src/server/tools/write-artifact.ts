import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db, schema } from '@/db/client'
import { newArtifactId } from '@/server/ids'
import type { ArtifactContent, ArtifactType } from '@/shared/types'

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
 */

const ArgsSchema = z.object({
  type: z.enum(['web_app', 'document', 'image']),
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
        enum: ['web_app', 'document', 'image'],
        description: 'web_app for HTML/CSS/JS bundles, document for markdown text, image for URL or data URI',
      },
      title: { type: 'string', description: 'Short human-readable title' },
      content: {
        type: 'object',
        description:
          'Artifact body. For web_app: { files: { "index.html": "...", "style.css"?, "script.js"? }, entry: "index.html" }. For document: { format: "markdown", content: "..." }. For image: { url: "...", alt: "..." }',
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

function buildArtifactContent(type: ArtifactType, raw: unknown): ArtifactContent | null {
  if (type === 'web_app') {
    // 情况 1: 标准 { files, entry }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>

      if (obj.files && typeof obj.files === 'object' && !Array.isArray(obj.files)) {
        const files = obj.files as Record<string, unknown>
        const normalised: Record<string, string> = {}
        for (const [k, v] of Object.entries(files)) {
          if (typeof v === 'string') normalised[k] = v
        }
        if (Object.keys(normalised).length === 0) return null
        return {
          type: 'web_app',
          files: normalised,
          entry: typeof obj.entry === 'string' ? obj.entry : 'index.html',
        }
      }

      // 情况 2: 扁平 { html, css, js }
      if (
        typeof obj.html === 'string' ||
        typeof obj.css === 'string' ||
        typeof obj.js === 'string'
      ) {
        const files: Record<string, string> = {}
        if (typeof obj.html === 'string') files['index.html'] = obj.html
        if (typeof obj.css === 'string') files['style.css'] = obj.css
        if (typeof obj.js === 'string') files['script.js'] = obj.js
        return { type: 'web_app', files, entry: 'index.html' }
      }

      // 情况 3: { content: '<html>...</html>' } 或 { code: '...' }
      if (typeof obj.content === 'string') {
        return {
          type: 'web_app',
          files: { 'index.html': obj.content },
          entry: 'index.html',
        }
      }
      if (typeof obj.code === 'string') {
        return {
          type: 'web_app',
          files: { 'index.html': obj.code },
          entry: 'index.html',
        }
      }
    }

    // 情况 4: 直接传 HTML 字符串
    if (typeof raw === 'string') {
      return { type: 'web_app', files: { 'index.html': raw }, entry: 'index.html' }
    }

    return null
  }

  if (type === 'document') {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj.content === 'string') {
        return { type: 'document', format: 'markdown', content: obj.content }
      }
      if (typeof obj.markdown === 'string') {
        return { type: 'document', format: 'markdown', content: obj.markdown }
      }
      if (typeof obj.text === 'string') {
        return { type: 'document', format: 'markdown', content: obj.text }
      }
    }
    if (typeof raw === 'string') {
      return { type: 'document', format: 'markdown', content: raw }
    }
    return null
  }

  if (type === 'image') {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj.url === 'string') {
        return {
          type: 'image',
          url: obj.url,
          alt: typeof obj.alt === 'string' ? obj.alt : '',
        }
      }
    }
    if (typeof raw === 'string') {
      return { type: 'image', url: raw, alt: '' }
    }
    return null
  }

  return null
}
