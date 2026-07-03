import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  clearFileWrites,
  detectWaveConflicts,
  getFileWrites,
  recordFileWriteFromDisk,
  type RunFileWrites,
} from './dispatch-file-writes'

function run(taskId: string, agentId: string, writes: Record<string, string>): RunFileWrites {
  return {
    taskId,
    agentId,
    runId: `run_${taskId}`,
    writes: new Map(Object.entries(writes)),
  }
}

describe('detectWaveConflicts', () => {
  it('returns no conflict when runs touch different files', () => {
    expect(
      detectWaveConflicts([
        run('t1', 'ag_pm', { '/ws/a.md': 'h1' }),
        run('t2', 'ag_fe', { '/ws/b.ts': 'h2' }),
      ]),
    ).toEqual([])
  })

  it('flags two runs writing the same file with different content', () => {
    const conflicts = detectWaveConflicts([
      run('t1', 'ag_fe', { '/ws/index.html': 'hashA' }),
      run('t2', 'ag_design', { '/ws/index.html': 'hashB' }),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].path).toBe('/ws/index.html')
    expect(conflicts[0].contributors.map((c) => c.taskId).sort()).toEqual(['t1', 't2'])
  })

  it('does not flag identical concurrent writes (same hash)', () => {
    expect(
      detectWaveConflicts([
        run('t1', 'ag_fe', { '/ws/index.html': 'same' }),
        run('t2', 'ag_design', { '/ws/index.html': 'same' }),
      ]),
    ).toEqual([])
  })

  it('detects a conflict among three writers and lists all contributors', () => {
    const conflicts = detectWaveConflicts([
      run('t1', 'a', { '/ws/x': 'h1' }),
      run('t2', 'b', { '/ws/x': 'h2' }),
      run('t3', 'c', { '/ws/x': 'h1' }),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].contributors).toHaveLength(3)
  })

  it('ignores a single run even if it writes many files', () => {
    expect(
      detectWaveConflicts([run('t1', 'a', { '/ws/a': 'h1', '/ws/b': 'h2', '/ws/c': 'h3' })]),
    ).toEqual([])
  })
})

describe('recordFileWriteFromDisk', () => {
  it('hashes files from disk so SDK writes join conflict detection', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-fw-'))
    try {
      const fileA = path.join(dir, 'same.txt')
      fs.writeFileSync(fileA, 'identical content')
      recordFileWriteFromDisk('run_disk_1', fileA)
      recordFileWriteFromDisk('run_disk_2', fileA)
      // 同内容 → 哈希一致 → 不算冲突
      expect(
        detectWaveConflicts([
          { taskId: 't1', agentId: 'a1', runId: 'run_disk_1', writes: getFileWrites('run_disk_1') },
          { taskId: 't2', agentId: 'a2', runId: 'run_disk_2', writes: getFileWrites('run_disk_2') },
        ]),
      ).toEqual([])

      // 第二个 run 覆写不同内容后再记 → 冲突
      recordFileWriteFromDisk('run_disk_3', fileA)
      fs.writeFileSync(fileA, 'divergent content')
      recordFileWriteFromDisk('run_disk_4', fileA)
      const conflicts = detectWaveConflicts([
        { taskId: 't3', agentId: 'a3', runId: 'run_disk_3', writes: getFileWrites('run_disk_3') },
        { taskId: 't4', agentId: 'a4', runId: 'run_disk_4', writes: getFileWrites('run_disk_4') },
      ])
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].path).toBe(fileA)
    } finally {
      for (const id of ['run_disk_1', 'run_disk_2', 'run_disk_3', 'run_disk_4']) clearFileWrites(id)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips missing files silently', () => {
    recordFileWriteFromDisk('run_disk_missing', '/nonexistent/agenthub-test-file')
    expect(getFileWrites('run_disk_missing').size).toBe(0)
  })
})
