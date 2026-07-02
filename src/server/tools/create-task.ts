import { z } from 'zod'

import { createBoardTask } from '@/server/task-service'

import type { ToolDef } from './types'

/**
 * create_task —— Agent 在对话中发现后续待办时主动立单，任务出现在全局任务看板（跨会话）。
 *
 * source 固定为 'agent'；conversationId / createdByAgentId 取自 ToolContext，不接受
 * LLM 传入，避免伪造来源。看板不反向触发 run（第一版）——这只是备忘/可视化层。
 */

const ArgsSchema = z.object({
  title: z.string().min(1).max(120),
  note: z.string().max(2000).optional(),
})

export const createTaskTool: ToolDef = {
  name: 'create_task',
  description:
    'Log a follow-up to-do on the global cross-conversation task board when you notice something that should happen later but is outside the current task (e.g. a bug to fix, a doc to update, a decision the user still owes). Not for tracking your own in-progress steps. Returns the created taskId.',
  parameters: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', description: 'Short task title (1-120 chars)' },
      note: { type: 'string', description: 'Optional longer note/context (up to 2000 chars)' },
    },
  },
  async handler(args, ctx) {
    const parsed = ArgsSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `Invalid args: ${parsed.error.message}` }
    }

    const { title, note } = parsed.data
    const task = await createBoardTask({
      title,
      note,
      source: 'agent',
      conversationId: ctx.conversationId,
      createdByAgentId: ctx.agentId,
    })

    return { ok: true, value: { taskId: task.id, title: task.title } }
  },
}
