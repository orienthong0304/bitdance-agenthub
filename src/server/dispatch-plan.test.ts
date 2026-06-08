import { describe, expect, it } from 'vitest'

import type { DispatchPlanItem } from '@/shared/types'

import {
  assertAcyclicDispatchPlan,
  buildReplanContext,
  collectDependencyClosure,
  compileDispatchPlan,
  parseDispatchPlanToolArgs,
  shouldReplan,
  taskExpectsArtifact,
  validateDispatchPlan,
} from './dispatch-plan'

const agents = [
  { id: 'ag_pm' },
  { id: 'ag_designer' },
  { id: 'ag_frontend' },
  { id: 'ag_reviewer' },
]

function task(
  id: string,
  agentId: string,
  dependsOn?: string[],
  instruction = `Do ${id}`,
): DispatchPlanItem {
  const item: DispatchPlanItem = { id, agentId, task: instruction }
  if (dependsOn) item.dependsOn = dependsOn
  return item
}

describe('parseDispatchPlanToolArgs', () => {
  it('parses valid plan_tasks args', () => {
    expect(
      parseDispatchPlanToolArgs({
        tasks: [
          { id: 't1', agentId: 'ag_pm', task: 'Write PRD' },
          { id: 't2', agentId: 'ag_frontend', task: 'Build UI', dependsOn: ['t1'] },
        ],
      }),
    ).toEqual([
      { id: 't1', agentId: 'ag_pm', task: 'Write PRD' },
      { id: 't2', agentId: 'ag_frontend', task: 'Build UI', dependsOn: ['t1'] },
    ])
  })

  it('parses task contracts for artifact handoff', () => {
    expect(
      parseDispatchPlanToolArgs({
        tasks: [
          {
            id: 't1',
            agentId: 'ag_pm',
            task: 'Write PRD',
            expectedOutputs: [
              {
                id: 'prd',
                type: 'document',
                description: 'Product requirements',
              },
            ],
            acceptanceCriteria: ['Includes P0 scope'],
          },
          {
            id: 't2',
            agentId: 'ag_frontend',
            task: 'Build UI',
            inputs: [{ fromTaskId: 't1', outputId: 'prd' }],
            expectedOutputs: [{ id: 'web_app', type: 'web_app' }],
          },
        ],
      }),
    ).toEqual([
      {
        id: 't1',
        agentId: 'ag_pm',
        task: 'Write PRD',
        expectedOutputs: [
          {
            id: 'prd',
            type: 'document',
            description: 'Product requirements',
          },
        ],
        acceptanceCriteria: ['Includes P0 scope'],
      },
      {
        id: 't2',
        agentId: 'ag_frontend',
        task: 'Build UI',
        inputs: [{ fromTaskId: 't1', outputId: 'prd' }],
        expectedOutputs: [{ id: 'web_app', type: 'web_app' }],
      },
    ])
  })

  it('rejects malformed tool args', () => {
    expect(() => parseDispatchPlanToolArgs(null)).toThrow('tasks array')
    expect(() => parseDispatchPlanToolArgs({ tasks: ['bad'] })).toThrow(
      'task at index 0 must be an object',
    )
    expect(() => parseDispatchPlanToolArgs({ tasks: [{ id: '', agentId: 'ag_pm', task: 'x' }] }))
      .toThrow('task at index 0 id must be a non-empty string')
    expect(() =>
      parseDispatchPlanToolArgs({ tasks: [{ id: 't1', agentId: 'ag_pm', task: 'x', dependsOn: 't0' }] }),
    ).toThrow('dependsOn must be an array')
    expect(() =>
      parseDispatchPlanToolArgs({ tasks: [{ id: 't1', agentId: 'ag_pm', task: 'x', dependsOn: [1] }] }),
    ).toThrow('dependsOn[0] must be a non-empty string')
  })
})

describe('validateDispatchPlan', () => {
  it('accepts a valid acyclic plan', () => {
    const plan = [
      task('t1', 'ag_pm'),
      task('t2', 'ag_frontend', ['t1']),
      task('t3', 'ag_reviewer', ['t2']),
    ]

    expect(() => validateDispatchPlan(plan, agents, 'ag_orchestrator')).not.toThrow()
  })

  it('rejects empty plans and duplicate task ids', () => {
    expect(() => validateDispatchPlan([], agents, 'ag_orchestrator')).toThrow(
      'tasks must not be empty',
    )
    expect(() =>
      validateDispatchPlan([task('t1', 'ag_pm'), task('t1', 'ag_frontend')], agents, 'ag_orchestrator'),
    ).toThrow('duplicate task id(s): t1')
  })

  it('rejects unavailable or recursive agent targets', () => {
    expect(() => validateDispatchPlan([task('t1', 'ag_orchestrator')], agents, 'ag_orchestrator'))
      .toThrow('dispatches to the orchestrator itself')
    expect(() => validateDispatchPlan([task('t1', 'ag_missing')], agents, 'ag_orchestrator'))
      .toThrow('references unavailable agentId "ag_missing"')
  })

  it('rejects invalid dependencies', () => {
    expect(() => validateDispatchPlan([task('t1', 'ag_pm', ['t1'])], agents, 'ag_orchestrator'))
      .toThrow('cannot depend on itself')
    expect(() => validateDispatchPlan([task('t1', 'ag_pm', ['t0'])], agents, 'ag_orchestrator'))
      .toThrow('depends on unknown task "t0"')
    expect(() =>
      validateDispatchPlan([task('t1', 'ag_pm'), task('t2', 'ag_frontend', ['t1', 't1'])], agents, 'ag_orchestrator'),
    ).toThrow('lists duplicate dependency "t1"')
  })

  it('accepts dependencies on resolved external tasks during replan', () => {
    expect(() =>
      validateDispatchPlan(
        [task('t4', 'ag_frontend', ['t2'])],
        agents,
        'ag_orchestrator',
        [task('t2', 'ag_pm')],
      ),
    ).not.toThrow()
  })

  it('rejects invalid task contracts', () => {
    expect(() =>
      validateDispatchPlan(
        [
          {
            ...task('t1', 'ag_pm'),
            expectedOutputs: [
              { id: 'prd', type: 'document' },
              { id: 'prd', type: 'document' },
            ],
          },
        ],
        agents,
        'ag_orchestrator',
      ),
    ).toThrow('duplicate expected output "prd"')

    expect(() =>
      validateDispatchPlan(
        [
          { ...task('t1', 'ag_pm'), expectedOutputs: [{ id: 'prd', type: 'document' }] },
          {
            ...task('t2', 'ag_frontend'),
            inputs: [{ fromTaskId: 't1', outputId: 'missing' }],
          },
        ],
        agents,
        'ag_orchestrator',
      ),
    ).toThrow('input references unknown output "missing" from task "t1"')
  })

  it('accepts inputs from resolved external tasks during replan', () => {
    expect(() =>
      validateDispatchPlan(
        [
          {
            ...task('t4', 'ag_frontend'),
            inputs: [{ fromTaskId: 't2', outputId: 'prd' }],
          },
        ],
        agents,
        'ag_orchestrator',
        [{ ...task('t2', 'ag_pm'), expectedOutputs: [{ id: 'prd', type: 'document' }] }],
      ),
    ).not.toThrow()
  })

  it('rejects circular dependencies', () => {
    const plan = [task('t1', 'ag_pm', ['t2']), task('t2', 'ag_frontend', ['t1'])]

    expect(() => validateDispatchPlan(plan, agents, 'ag_orchestrator')).toThrow(
      'circular dependency t1 -> t2 -> t1',
    )
  })
})

describe('compileDispatchPlan', () => {
  it('infers missing dependencies from task id artifact references', () => {
    const { plan, inferredDependencies } = compileDispatchPlan([
      task('t1', 'ag_pm', undefined, '请产出 PRD 文档，并写入 artifact。'),
      task('t2', 'ag_frontend', undefined, '读取 t1 产物后实现 web_app artifact。'),
    ])

    expect(plan[1].dependsOn).toEqual(['t1'])
    expect(inferredDependencies).toEqual([
      {
        taskId: 't2',
        dependsOn: ['t1'],
        reason: 'task text references earlier task output',
      },
    ])
    expect(() => validateDispatchPlan(plan, agents, 'ag_orchestrator')).not.toThrow()
  })

  it('infers the PRD to UI to frontend to reviewer incident pattern', () => {
    const { plan } = compileDispatchPlan([
      task('t1', 'ag_pm', undefined, '输出一份 PRD 文档，并写入 artifact。'),
      task('t2', 'ag_designer', undefined, '读取 PRD artifact 后输出一份 UI 设计方案。'),
      task('t3', 'ag_frontend', undefined, '读取 PRD 和 UI 设计，输出一个 web_app artifact。'),
      task(
        't4',
        'ag_reviewer',
        undefined,
        '审查前端工程师产出的 web_app artifact，检查是否符合 PRD 和 UI 设计，并输出审查报告。',
      ),
    ])

    expect(plan.map((item) => ({ id: item.id, dependsOn: item.dependsOn }))).toEqual([
      { id: 't1', dependsOn: undefined },
      { id: 't2', dependsOn: ['t1'] },
      { id: 't3', dependsOn: ['t1', 't2'] },
      { id: 't4', dependsOn: ['t1', 't2', 't3'] },
    ])
  })

  it('preserves explicit dependencies while adding missing review predecessors', () => {
    const { plan } = compileDispatchPlan([
      task('t1', 'ag_pm', undefined, '输出一份 PRD 文档，并写入 artifact。'),
      task('t2', 'ag_designer', ['t1'], '读取 PRD artifact 后输出一份 UI 设计方案。'),
      task('t3', 'ag_frontend', ['t2'], '读取 UI 设计，输出一个 web_app artifact。'),
      task('t4', 'ag_reviewer', ['t3'], '审查实现是否符合 PRD 和 UI 设计，并输出审查报告。'),
    ])

    expect(plan[3].dependsOn).toEqual(['t3', 't1', 't2'])
  })

  it('compiles task inputs into dependencies', () => {
    const { plan } = compileDispatchPlan([
      { ...task('t1', 'ag_pm'), expectedOutputs: [{ id: 'prd', type: 'document' }] },
      {
        ...task('t2', 'ag_frontend'),
        inputs: [{ fromTaskId: 't1', outputId: 'prd' }],
      },
    ])

    expect(plan[1].dependsOn).toEqual(['t1'])
    expect(() => validateDispatchPlan(plan, agents, 'ag_orchestrator')).not.toThrow()
  })
})

describe('collectDependencyClosure', () => {
  it('returns transitive dependencies in upstream order', () => {
    const plan = [
      task('t1', 'ag_pm'),
      task('t2', 'ag_designer', ['t1']),
      task('t3', 'ag_frontend', ['t2']),
      task('t4', 'ag_reviewer', ['t3']),
    ]

    expect(collectDependencyClosure(plan, 't4')).toEqual(['t1', 't2', 't3'])
  })
})

describe('taskExpectsArtifact', () => {
  it('distinguishes artifact-producing tasks from read-only tasks', () => {
    expect(taskExpectsArtifact(task('t1', 'ag_pm', undefined, '输出一个 document/markdown artifact。'))).toBe(true)
    expect(taskExpectsArtifact(task('t2', 'ag_frontend', undefined, '请实现一个完整的响应式网页应用。'))).toBe(true)
    expect(taskExpectsArtifact(task('t2', 'ag_reviewer', undefined, '读取 artifact 并总结主要问题。'))).toBe(false)
  })
})

describe('assertAcyclicDispatchPlan', () => {
  it('accepts linear DAGs', () => {
    expect(() =>
      assertAcyclicDispatchPlan([task('t1', 'ag_pm'), task('t2', 'ag_frontend', ['t1'])]),
    ).not.toThrow()
  })

  it('detects self and multi-node cycles', () => {
    expect(() => assertAcyclicDispatchPlan([task('t1', 'ag_pm', ['t1'])])).toThrow(
      'circular dependency t1 -> t1',
    )
    expect(() =>
      assertAcyclicDispatchPlan([task('t1', 'ag_pm', ['t2']), task('t2', 'ag_frontend', ['t1'])]),
    ).toThrow('circular dependency t1 -> t2 -> t1')
  })
})

describe('shouldReplan', () => {
  it('false when all tasks complete and no conflicts', () => {
    expect(
      shouldReplan(
        [
          { taskId: 't1', agentId: 'ag_pm', status: 'complete' },
          { taskId: 't2', agentId: 'ag_frontend', status: 'complete' },
        ],
        [],
      ),
    ).toBe(false)
  })

  it('true when a task failed or was skipped', () => {
    expect(
      shouldReplan(
        [
          { taskId: 't1', agentId: 'ag_pm', status: 'complete' },
          { taskId: 't2', agentId: 'ag_frontend', status: 'failed', error: 'no artifact' },
        ],
        [],
      ),
    ).toBe(true)
  })

  it('true when there is a write conflict even if all complete', () => {
    expect(
      shouldReplan(
        [{ taskId: 't1', agentId: 'ag_a', status: 'complete' }],
        [{ path: 'index.html', taskIds: ['t1', 't2'] }],
      ),
    ).toBe(true)
  })
})

describe('buildReplanContext', () => {
  it('lists complete + failed tasks + conflicts and instructs remediation', () => {
    const ctx = buildReplanContext(
      [
        { taskId: 't1', agentId: 'ag_pm', status: 'complete' },
        { taskId: 't2', agentId: 'ag_frontend', status: 'failed', error: 'missing artifact' },
      ],
      [{ path: 'index.html', taskIds: ['t2', 't3'] }],
    )
    expect(ctx).toContain('<previous_round_results>')
    expect(ctx).toContain('id="t1" agent="ag_pm" status="complete"')
    expect(ctx).toContain('status="failed"')
    expect(ctx).toContain('missing artifact')
    expect(ctx).toContain('<file_conflicts>')
    expect(ctx).toContain('index.html')
    expect(ctx).toContain('plan_tasks')
  })
})
