import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// task-service 在模块级 `import { db, schema } from '@/db/client'`，而真实 client.ts 会打开落地文件 DB
// 并 bootstrap。这里用 in-memory drizzle 实例整体替换该模块，让 upsert/sync 的 DB 语义（幂等 / updatedAt gate /
// 状态映射）可做真实断言，同时不污染 .agenthub-data。bootstrap 已被 migrate-writing-agents.test.ts 证明对 :memory: 安全。
vi.mock('@/db/client', async () => {
  const Database = (await import('better-sqlite3')).default
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('@/db/schema')
  const { bootstrapDatabase } = await import('@/db/bootstrap')
  const sqlite = new Database(':memory:')
  bootstrapDatabase(sqlite)
  const db = drizzle(sqlite, { schema })
  return { db, schema, sqlite }
})

import { eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { TaskRow } from '@/db/schema'
import { eventBus } from '@/server/event-bus'
import {
  createBoardTask,
  mapDispatchStatusToBoard,
  syncDispatchTaskStatus,
  updateBoardTask,
  upsertDispatchTask,
  type DispatchSyncStatus,
} from '@/server/task-service'
import type { BoardTaskStatus } from '@/shared/types'

function rowByDispatch(dispatchTaskId: string): Promise<TaskRow | undefined> {
  return db.query.tasks.findFirst({ where: eq(schema.tasks.dispatchTaskId, dispatchTaskId) })
}

async function countTasks(): Promise<number> {
  return (await db.query.tasks.findMany()).length
}

/** 直接落一行 dispatch 任务，用可控的旧 updatedAt（1000）方便断言「有没有 bump」。 */
function seedDispatchRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task_seed1',
    title: 'Old',
    note: null,
    status: 'open',
    source: 'dispatch',
    conversationId: 'c1',
    messageId: null,
    artifactId: null,
    dispatchTaskId: 'run1:t1',
    createdByAgentId: 'ag1',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

let publishSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  await db.delete(schema.tasks)
  publishSpy = vi.spyOn(eventBus, 'publish').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('upsertDispatchTask', () => {
  it('幂等：同一 dispatchTaskId 重复登记不产生第二行，且第二次不发事件', async () => {
    const args = { dispatchTaskId: 'run1:t1', title: 'T1', conversationId: 'c1', agentId: 'ag1' }
    const first = await upsertDispatchTask(args)
    const second = await upsertDispatchTask(args)

    expect(second.id).toBe(first.id)
    expect(await countTasks()).toBe(1)
    // 首次 insert 发一次；第二次幂等命中且 title 未变 → 早退，不发
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  it('title 变更：写库 bump updatedAt 并发事件', async () => {
    await db.insert(schema.tasks).values(seedDispatchRow())
    publishSpy.mockClear()

    const changed = await upsertDispatchTask({
      dispatchTaskId: 'run1:t1',
      title: 'New',
      conversationId: 'c1',
      agentId: 'ag1',
    })

    expect(changed.title).toBe('New')
    expect(changed.updatedAt).not.toBe(1000)
    const row = await rowByDispatch('run1:t1')
    expect(row?.title).toBe('New')
    expect(row?.updatedAt).not.toBe(1000)
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  it('title 未变：不写库（updatedAt 不 bump）、不发事件', async () => {
    await db.insert(schema.tasks).values(seedDispatchRow())
    publishSpy.mockClear()

    const same = await upsertDispatchTask({
      dispatchTaskId: 'run1:t1',
      title: 'Old',
      conversationId: 'c1',
      agentId: 'ag1',
    })

    expect(same.updatedAt).toBe(1000)
    expect((await rowByDispatch('run1:t1'))?.updatedAt).toBe(1000)
    expect(publishSpy).not.toHaveBeenCalled()
  })
})

describe('mapDispatchStatusToBoard — 全终态映射', () => {
  it('覆盖 DispatchSyncStatus 全部枚举值', () => {
    const cases: Array<[DispatchSyncStatus, BoardTaskStatus]> = [
      ['pending', 'open'],
      ['running', 'in_progress'],
      ['complete', 'done'],
      ['failed', 'blocked'],
      ['aborted', 'blocked'],
      ['blocked', 'blocked'],
      ['skipped', 'blocked'],
    ]
    for (const [input, expected] of cases) {
      expect(mapDispatchStatusToBoard(input)).toBe(expected)
    }
  })
})

describe('syncDispatchTaskStatus', () => {
  it('状态变化：按映射写库 bump updatedAt 并发事件', async () => {
    await db.insert(schema.tasks).values(seedDispatchRow({ status: 'open' }))
    publishSpy.mockClear()

    await syncDispatchTaskStatus('run1:t1', 'running')

    const row = await rowByDispatch('run1:t1')
    expect(row?.status).toBe('in_progress')
    expect(row?.updatedAt).not.toBe(1000)
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  it('终态 complete/failed 分别映射到 done/blocked 并落库', async () => {
    await db.insert(schema.tasks).values(seedDispatchRow({ status: 'in_progress' }))
    await syncDispatchTaskStatus('run1:t1', 'complete')
    expect((await rowByDispatch('run1:t1'))?.status).toBe('done')

    await syncDispatchTaskStatus('run1:t1', 'failed')
    expect((await rowByDispatch('run1:t1'))?.status).toBe('blocked')
  })

  it('看板状态未变（running→running 均映射 in_progress）：不写库、不发事件', async () => {
    await db.insert(schema.tasks).values(seedDispatchRow({ status: 'in_progress' }))
    publishSpy.mockClear()

    await syncDispatchTaskStatus('run1:t1', 'running')

    expect((await rowByDispatch('run1:t1'))?.updatedAt).toBe(1000)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('未登记的 dispatchTaskId：静默跳过，不抛错、不发事件', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(syncDispatchTaskStatus('nope:x', 'complete')).resolves.toBeUndefined()
    expect(publishSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('createBoardTask / updateBoardTask', () => {
  it('createBoardTask：插入 open 任务并发事件', async () => {
    const task = await createBoardTask({ title: 'Manual', source: 'manual' })
    expect(task.status).toBe('open')
    expect(task.source).toBe('manual')
    expect(await countTasks()).toBe(1)
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  it('updateBoardTask：改状态写库并发事件', async () => {
    const created = await createBoardTask({ title: 'Manual', source: 'manual' })
    publishSpy.mockClear()

    const updated = await updateBoardTask(created.id, { status: 'done' })
    expect(updated.status).toBe('done')
    const row = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, created.id) })
    expect(row?.status).toBe('done')
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })
})
