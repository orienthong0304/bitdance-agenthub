import { z } from 'zod'

import type { ToolDef } from './types'

/**
 * plan_tasks —— Orchestrator 专用的「输出端工具」。
 *
 * 它本身不执行任何副作用，只是把 Orchestrator 拆解出的子任务列表以
 * 结构化形式输出。AgentRunner 在看到 plan_tasks 工具调用时进入调度模式，
 * 把这个 plan 拆成子 AgentRun 并发执行。
 *
 * 详细规格见 specs/06-orchestrator-flow.md。
 */

const TaskSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  task: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
})

const ArgsSchema = z.object({
  reasoning: z.string().min(1),
  tasks: z.array(TaskSchema).min(1),
})

export const planTasksTool: ToolDef = {
  name: 'plan_tasks',
  description:
    'Decompose the user request into sub-tasks and dispatch them to other agents in this group. Output a complete plan in a single call; do NOT call this tool multiple times.',
  parameters: {
    type: 'object',
    required: ['reasoning', 'tasks'],
    properties: {
      reasoning: {
        type: 'string',
        description: 'Brief explanation of why this decomposition makes sense, 3 sentences max',
      },
      tasks: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'agentId', 'task'],
          properties: {
            id: {
              type: 'string',
              description: 'Sub-task id, use t1/t2/t3 format',
            },
            agentId: {
              type: 'string',
              description: 'Agent id that should execute this task. Must come from the available list.',
            },
            task: {
              type: 'string',
              description: 'Concrete, self-contained instruction for that agent. The agent will not see the full group history.',
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ids of prerequisite tasks. Omit when the task can start immediately.',
            },
          },
        },
      },
    },
  },
  async handler(args) {
    const parsed = ArgsSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `Invalid plan: ${parsed.error.message}` }
    }
    // 实际执行在 AgentRunner 里完成。这里仅做格式校验并回 ack。
    return {
      ok: true,
      value: {
        acknowledged: true,
        taskCount: parsed.data.tasks.length,
      },
    }
  },
}
