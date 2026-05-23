import { desc, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'

/**
 * Artifact 全局服务。
 *
 * 列表查询时一次性 JOIN 出会话标题（避免前端 N+1 查询）。
 */

export interface ArtifactWithMeta {
  id: string
  conversationId: string
  conversationTitle: string | null
  type: string
  title: string
  version: number
  createdByAgentId: string
  createdAt: number
}

export async function listArtifacts(): Promise<ArtifactWithMeta[]> {
  const rows = await db.query.artifacts.findMany({
    orderBy: [desc(schema.artifacts.createdAt)],
  })
  if (rows.length === 0) return []

  const convIds = Array.from(new Set(rows.map((r) => r.conversationId)))
  const convs = await db.query.conversations.findMany({
    where: inArray(schema.conversations.id, convIds),
  })
  const titleById = new Map(convs.map((c) => [c.id, c.title]))

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    conversationTitle: titleById.get(r.conversationId) ?? null,
    type: r.type,
    title: r.title,
    version: r.version,
    createdByAgentId: r.createdByAgentId,
    createdAt: r.createdAt,
  }))
}

export async function deleteArtifact(artifactId: string): Promise<void> {
  const deleted = await db
    .delete(schema.artifacts)
    .where(eq(schema.artifacts.id, artifactId))
    .returning({ id: schema.artifacts.id })

  if (deleted.length === 0) {
    throw new Error(`Artifact not found: ${artifactId}`)
  }
}
