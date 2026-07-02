import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { TaskRow } from '@/db/schema'
import { newBoardTaskId } from '@/server/ids'
import type { BoardTask, BoardTaskSource, BoardTaskStatus } from '@/shared/types'

/**
 * 任务看板服务 — 跨会话聚合的任务 CRUD + Orchestrator dispatch 状态单向同步。
 *
 * 三种来源：manual（用户在看板创建）/ dispatch（plan 批准时 upsertDispatchTask 登记，
 * 执行状态经 syncDispatchTaskStatus 单向同步）/ agent（create_task 工具创建）。
 * 看板不反向触发 run（第一版）：编辑 / 拖动状态只改任务记录。详见 openspec task-board spec。
 */

function toBoardTask(row: TaskRow): BoardTask {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status as BoardTaskStatus,
    source: row.source as BoardTaskSource,
    conversationId: row.conversationId,
    messageId: row.messageId,
    artifactId: row.artifactId,
    dispatchTaskId: row.dispatchTaskId,
    createdByAgentId: row.createdByAgentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** 全量任务，按 updatedAt desc；分组按 status 的活留给调用方（UI 侧按状态分组渲染）。 */
export async function listBoardTasks(): Promise<BoardTask[]> {
  const rows = await db.query.tasks.findMany({ orderBy: [desc(schema.tasks.updatedAt)] })
  return rows.map(toBoardTask)
}

export interface CreateBoardTaskArgs {
  title: string
  note?: string
  source: BoardTaskSource
  conversationId?: string
  messageId?: string
  createdByAgentId?: string
}

/** 新建任务：manual 来源用户直填；agent 来源由 create_task 工具调用（source='agent'）。 */
export async function createBoardTask(args: CreateBoardTaskArgs): Promise<BoardTask> {
  const now = Date.now()
  const row: TaskRow = {
    id: newBoardTaskId(),
    title: args.title,
    note: args.note ?? null,
    status: 'open',
    source: args.source,
    conversationId: args.conversationId ?? null,
    messageId: args.messageId ?? null,
    artifactId: null,
    dispatchTaskId: null,
    createdByAgentId: args.createdByAgentId ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.tasks).values(row)
  return toBoardTask(row)
}

export interface UpdateBoardTaskArgs {
  title?: string
  note?: string
  status?: BoardTaskStatus
}

/** 编辑任务（看板内联编辑 / 拖动状态列都走这里）；不存在时报具体缺失 id，避免静默失败。 */
export async function updateBoardTask(id: string, patch: UpdateBoardTaskArgs): Promise<BoardTask> {
  const existing = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) })
  if (!existing) throw new Error(`updateBoardTask: task not found: ${id}`)

  const next: TaskRow = {
    ...existing,
    title: patch.title ?? existing.title,
    note: patch.note ?? existing.note,
    status: patch.status ?? existing.status,
    updatedAt: Date.now(),
  }
  await db
    .update(schema.tasks)
    .set({ title: next.title, note: next.note, status: next.status, updatedAt: next.updatedAt })
    .where(eq(schema.tasks.id, id))
  return toBoardTask(next)
}

export async function deleteBoardTask(id: string): Promise<void> {
  const existing = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) })
  if (!existing) throw new Error(`deleteBoardTask: task not found: ${id}`)
  await db.delete(schema.tasks).where(eq(schema.tasks.id, id))
}

export interface UpsertDispatchTaskArgs {
  /** 幂等键 `${runId}:${taskId}` */
  dispatchTaskId: string
  title: string
  conversationId: string
  agentId: string
}

/** plan 批准时为每个子任务登记看板任务；已存在则只改 title（不动 status，避免覆盖执行进度）。 */
export async function upsertDispatchTask(args: UpsertDispatchTaskArgs): Promise<BoardTask> {
  const existing = await db.query.tasks.findFirst({
    where: eq(schema.tasks.dispatchTaskId, args.dispatchTaskId),
  })
  if (existing) {
    const next: TaskRow = { ...existing, title: args.title, updatedAt: Date.now() }
    await db
      .update(schema.tasks)
      .set({ title: next.title, updatedAt: next.updatedAt })
      .where(eq(schema.tasks.id, existing.id))
    return toBoardTask(next)
  }

  const now = Date.now()
  const row: TaskRow = {
    id: newBoardTaskId(),
    title: args.title,
    note: null,
    status: 'open',
    source: 'dispatch',
    conversationId: args.conversationId,
    messageId: null,
    artifactId: null,
    dispatchTaskId: args.dispatchTaskId,
    createdByAgentId: args.agentId,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.tasks).values(row)
  return toBoardTask(row)
}

/** Orchestrator 子任务在其生命周期内可能上报的状态；比 DispatchTaskStatus 多一个 'blocked'（AgentRunner 判定阻塞时用）。 */
export type DispatchSyncStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed'
  | 'aborted'
  | 'blocked'
  | 'skipped'

/** dispatch 状态 → 看板状态映射（纯函数，供单测覆盖全部枚举值）。 */
export function mapDispatchStatusToBoard(status: DispatchSyncStatus): BoardTaskStatus {
  switch (status) {
    case 'pending':
      return 'open'
    case 'running':
      return 'in_progress'
    case 'complete':
      return 'done'
    case 'failed':
    case 'aborted':
    case 'blocked':
    case 'skipped':
      return 'blocked'
  }
}

/** 单向同步：dispatch 执行状态变化时调用，看板编辑不会反向影响 dispatch。未登记过的 dispatchTaskId 静默跳过。 */
export async function syncDispatchTaskStatus(
  dispatchTaskId: string,
  dispatchStatus: DispatchSyncStatus,
): Promise<void> {
  const existing = await db.query.tasks.findFirst({
    where: eq(schema.tasks.dispatchTaskId, dispatchTaskId),
  })
  if (!existing) {
    console.warn(`[task-service] syncDispatchTaskStatus: no board task for dispatchTaskId ${dispatchTaskId}`)
    return
  }
  await db
    .update(schema.tasks)
    .set({ status: mapDispatchStatusToBoard(dispatchStatus), updatedAt: Date.now() })
    .where(eq(schema.tasks.id, existing.id))
}
