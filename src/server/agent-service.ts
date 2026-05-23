import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import { newAgentId } from '@/server/ids'
import type { AdapterName, ModelProvider } from '@/shared/types'

/**
 * 用户自建 Agent 的服务。
 *
 * 自建 Agent 一律走 adapterName='custom'，由用户指定底层 LLM 与工具集。
 * 内置 Agent (isBuiltin=true) 不可被删除或修改。
 */

export interface CreateAgentArgs {
  name: string
  avatar: string
  description: string
  capabilities: string[]
  systemPrompt: string
  modelProvider: ModelProvider
  modelId: string
  toolNames: string[]
  supportsVision?: boolean
  apiKey?: string | null
}

export async function createCustomAgent(args: CreateAgentArgs) {
  const id = newAgentId()
  const createdAt = Date.now()

  const row = {
    id,
    name: args.name.trim(),
    avatar: args.avatar.trim() || '🤖',
    description: args.description.trim(),
    capabilities: args.capabilities,
    systemPrompt: args.systemPrompt,
    adapterName: 'custom' as AdapterName,
    modelProvider: args.modelProvider,
    modelId: args.modelId,
    apiKey: args.apiKey?.trim() || null,
    toolNames: args.toolNames,
    isBuiltin: false,
    isOrchestrator: false,
    supportsVision: args.supportsVision ?? false,
    createdAt,
  }

  await db.insert(schema.agents).values(row)
  return row
}

export async function deleteCustomAgent(agentId: string): Promise<void> {
  // 防止误删内置
  const agent = await db.query.agents.findFirst({
    where: eq(schema.agents.id, agentId),
  })
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (agent.isBuiltin) throw new Error('Built-in agents cannot be deleted')

  const deleted = await db
    .delete(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.isBuiltin, false)))
    .returning({ id: schema.agents.id })

  if (deleted.length === 0) {
    throw new Error(`Failed to delete agent: ${agentId}`)
  }
}

export interface UpdateAgentPatch {
  name?: string
  description?: string
  capabilities?: string[]
  systemPrompt?: string
  modelProvider?: ModelProvider
  modelId?: string
  toolNames?: string[]
  supportsVision?: boolean
  /** 传 null 显式清除自定义 key（fallback 回 env）；undefined 表示不动 */
  apiKey?: string | null
}

export async function updateCustomAgent(agentId: string, patch: UpdateAgentPatch) {
  const agent = await db.query.agents.findFirst({
    where: eq(schema.agents.id, agentId),
  })
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  // 内建 agent 允许修改配置（API key / system prompt / model 等），但删除仍受保护

  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) updates.name = patch.name.trim()
  if (patch.description !== undefined) updates.description = patch.description.trim()
  if (patch.capabilities !== undefined) updates.capabilities = patch.capabilities
  if (patch.systemPrompt !== undefined) updates.systemPrompt = patch.systemPrompt
  if (patch.modelProvider !== undefined) updates.modelProvider = patch.modelProvider
  if (patch.modelId !== undefined) updates.modelId = patch.modelId
  if (patch.toolNames !== undefined) updates.toolNames = patch.toolNames
  if (patch.supportsVision !== undefined) updates.supportsVision = patch.supportsVision
  if (patch.apiKey !== undefined) updates.apiKey = patch.apiKey?.trim() || null

  if (Object.keys(updates).length === 0) return agent

  await db.update(schema.agents).set(updates).where(eq(schema.agents.id, agentId))

  const updated = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) })
  if (!updated) throw new Error('Update succeeded but row missing afterwards')
  return updated
}

export async function listAgentsOrdered() {
  // 内置在前，按 createdAt desc
  return db.query.agents.findMany({
    orderBy: [desc(schema.agents.isBuiltin), desc(schema.agents.createdAt)],
  })
}
