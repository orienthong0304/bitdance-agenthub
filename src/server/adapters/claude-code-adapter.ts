import { AbortError, query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { WorkspaceRow } from '@/db/schema'
import { readIfExists } from '@/server/fs-service'
import { newMessageId, newToolCallId } from '@/server/ids'
import { pendingWrites } from '@/server/pending-writes'
import { findBannedPattern } from '@/server/security'
import { assertPathWithinWorkspace, getEffectiveCwd } from '@/server/workspace-utils'
import type { StreamEvent } from '@/shared/types'

import type { AdapterInput, AgentPlatformAdapter } from './types'

/**
 * ClaudeCodeAdapter —— 使用 `@anthropic-ai/claude-agent-sdk`，复用 Claude Code 一整套能力：
 *  - 内置工具集（Bash / Read / Write / Edit / Grep / Glob / WebFetch / WebSearch / Task / TodoWrite…）
 *  - 子 agent (Task) 嵌套调度
 *  - 自动 agent loop（多轮思考 + 工具调用，无需我们手写）
 *
 * 桥接策略：
 *  - 路径沙箱、Bash 黑名单、fs_write 审批都在 `canUseTool` 里拦截
 *  - 用户应用 Edit/Write 后由 SDK 自己写盘（pendingWrites.register 传 skipWrite: true）
 *  - 事件流翻译：SDK 的 SDKMessage → 我们的 StreamEvent (message.start/end + part.* + tool.*)
 *
 * 详见 specs/05-adapter-interface.md「ClaudeCodeAdapter」一节。
 */

const DEFAULT_MODEL = 'claude-opus-4-7'
/** SDK 内置工具中会改文件的，需要走审批 */
const FS_WRITE_TOOLS = new Set(['Write', 'Edit'])
/** 需要路径沙箱检查的工具（Bash 单独走黑名单 + cwd 限定） */
const PATH_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit'])

type CanUseToolFn = NonNullable<Options['canUseTool']>
type PermissionResult = Awaited<ReturnType<CanUseToolFn>>

export class ClaudeCodeAdapter implements AgentPlatformAdapter {
  readonly name = 'claude-code' as const

  async *stream(input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const messageId = newMessageId()
    const baseEvent = <T extends Record<string, unknown>>(body: T) => ({
      ...body,
      conversationId: input.conversationId,
      timestamp: Date.now(),
    })

    yield baseEvent({
      type: 'message.start' as const,
      messageId,
      agentId: input.agentId,
      runId: input.runId,
    }) as StreamEvent

    // 取 workspace + 审批模式（用于 canUseTool）
    const workspace = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.conversationId, input.conversationId),
    })
    if (!workspace) {
      throw new Error(`Workspace not found for conversation ${input.conversationId}`)
    }
    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, input.conversationId),
    })
    const approvalMode = conv?.fsWriteApprovalMode ?? 'review'

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })

    // 翻译状态
    let nextPartIndex = 0
    let activeTextPartIndex = -1 // -1 表示当前没有开放的 text part
    const toolCallIdByUseId = new Map<string, string>()

    const options: Options = {
      cwd: getEffectiveCwd(workspace),
      abortController: controller,
      model: input.modelId ?? DEFAULT_MODEL,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: input.systemPrompt,
      },
      tools: { type: 'preset', preset: 'claude_code' },
      includePartialMessages: true,
      // 'project' = 只读绑定目录里的 CLAUDE.md（项目级上下文），不读用户全局 ~/.claude 设定（避免污染）
      settingSources: ['project'],
      permissionMode: 'default', // 自己 canUseTool 接管
      env: buildSdkEnv(input.apiKey, input.apiBaseUrl),
      canUseTool: (toolName, toolInput) =>
        bridgePermission(toolName, toolInput, { workspace, approvalMode, input }),
    }

    try {
      const q = query({ prompt: input.prompt, options })
      for await (const m of q) {
        // partial streaming：includePartialMessages=true 时优先用这个推 delta
        if (m.type === 'stream_event') {
          const ev = m.event as { type?: string; delta?: { type?: string; text?: string } }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            if (activeTextPartIndex === -1) {
              activeTextPartIndex = nextPartIndex++
              yield baseEvent({
                type: 'part.start' as const,
                messageId,
                partIndex: activeTextPartIndex,
                part: { type: 'text' as const, content: '' },
              }) as StreamEvent
            }
            yield baseEvent({
              type: 'part.delta' as const,
              messageId,
              partIndex: activeTextPartIndex,
              delta: { type: 'text.append' as const, text: ev.delta.text },
            }) as StreamEvent
          }
          continue
        }

        if (m.type === 'assistant') {
          // 完整 assistant 消息 —— 处理 tool_use 块（text 已经在 stream_event 里增量过）
          const content = m.message?.content as Array<{
            type: string
            id?: string
            name?: string
            input?: Record<string, unknown>
            text?: string
          }>
          if (!Array.isArray(content)) continue
          for (const block of content) {
            if (block.type === 'tool_use' && block.id && block.name) {
              // tool_use 出现 → 关闭当前 text part 上下文
              activeTextPartIndex = -1
              const callId = newToolCallId()
              toolCallIdByUseId.set(block.id, callId)
              yield baseEvent({
                type: 'tool.call' as const,
                messageId,
                callId,
                toolName: block.name,
                args: block.input ?? {},
              }) as StreamEvent
            } else if (block.type === 'text' && activeTextPartIndex === -1 && block.text) {
              // 没开 partial stream（或者 partial 漏了）时的兜底：把整段 text 作为一个 part
              const idx = nextPartIndex++
              yield baseEvent({
                type: 'part.start' as const,
                messageId,
                partIndex: idx,
                part: { type: 'text' as const, content: block.text },
              }) as StreamEvent
            }
          }
          continue
        }

        if (m.type === 'user') {
          // tool_result 块（SDK 内部执行完工具后的返回）
          const content = m.message?.content as
            | Array<{
                type: string
                tool_use_id?: string
                content?: unknown
                is_error?: boolean
              }>
            | undefined
          if (!Array.isArray(content)) continue
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const callId = toolCallIdByUseId.get(block.tool_use_id)
              if (!callId) continue
              yield baseEvent({
                type: 'tool.result' as const,
                messageId,
                callId,
                result: block.content ?? null,
                isError: !!block.is_error,
              }) as StreamEvent
            }
          }
          continue
        }

        if (m.type === 'result') {
          // 终止信号
          break
        }
        // 其他系统消息（init / status / hook 事件 / task notification 等）暂时忽略
      }
    } catch (err) {
      if (err instanceof AbortError || signal.aborted) {
        // 主动中止：吞掉，run.end 状态由 AgentRunner 决定
      } else {
        throw err
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
    }

    yield baseEvent({ type: 'message.end' as const, messageId }) as StreamEvent
  }
}

// ─── canUseTool 桥 ────────────────────────────────────────

/**
 * 构造给 SDK 子进程的 env：
 *  - 配了 apiBaseUrl（第三方网关如 anyrouter）：设 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN，
 *    并清空 ANTHROPIC_API_KEY（避免 process env 覆盖 AUTH_TOKEN）
 *  - 只配了 apiKey：当 ANTHROPIC_API_KEY 传给 SDK
 *  - 都没配：透传 process.env，SDK fallback 到 env / ~/.claude OAuth
 */
function buildSdkEnv(
  apiKey: string | null,
  apiBaseUrl: string | null,
): Record<string, string | undefined> {
  if (apiBaseUrl) {
    return {
      ...process.env,
      ANTHROPIC_BASE_URL: apiBaseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey ?? '',
      ANTHROPIC_API_KEY: '',
    }
  }
  if (apiKey) {
    return { ...process.env, ANTHROPIC_API_KEY: apiKey }
  }
  return process.env as Record<string, string | undefined>
}

interface PermissionCtx {
  workspace: WorkspaceRow
  approvalMode: 'auto' | 'review'
  input: AdapterInput
}

async function bridgePermission(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: PermissionCtx,
): Promise<PermissionResult> {
  // SDK 的运行时 Zod schema 要求 allow 必带 updatedInput（TypeScript type 标 optional 但运行时必填）；
  // 无修改场景下回填原 input 即可。deny 必带 message。
  const allow = (updated: Record<string, unknown> = toolInput): PermissionResult => ({
    behavior: 'allow',
    updatedInput: updated,
  })
  const deny = (message: string): PermissionResult => ({ behavior: 'deny', message })

  // 1. 路径沙箱检查（Read/Write/Edit/NotebookEdit）
  if (PATH_TOOLS.has(toolName)) {
    const target =
      (toolInput.file_path as string | undefined) ?? (toolInput.path as string | undefined)
    if (target) {
      try {
        assertPathWithinWorkspace(ctx.workspace, target)
      } catch (e) {
        return deny(e instanceof Error ? e.message : `Path is outside workspace: ${target}`)
      }
    }
  }

  // 2. Bash 黑名单
  if (toolName === 'Bash') {
    const cmd = (toolInput.command as string | undefined) ?? ''
    const banned = findBannedPattern(cmd)
    if (banned) {
      return deny(`Command blocked by safety policy (matches ${banned}): ${cmd.slice(0, 100)}`)
    }
    return allow()
  }

  // 3. fs_write 审批 (Write / Edit)
  if (FS_WRITE_TOOLS.has(toolName)) {
    if (ctx.approvalMode === 'auto') return allow()
    const target = (toolInput.file_path as string) ?? (toolInput.path as string)
    if (!target) return deny('Missing file_path/path')

    const oldContent = readIfExists(ctx.workspace, target)
    const newContent = computeNewContent(toolName, toolInput, oldContent)
    if (newContent instanceof Error) {
      return deny(newContent.message)
    }

    let absPath: string
    try {
      absPath = assertPathWithinWorkspace(ctx.workspace, target)
    } catch (e) {
      return deny(e instanceof Error ? e.message : 'Path outside workspace')
    }

    const pending = pendingWrites.register({
      conversationId: ctx.input.conversationId,
      agentId: ctx.input.agentId,
      runId: ctx.input.runId,
      path: target,
      absolutePath: absPath,
      oldContent,
      newContent,
      workspace: ctx.workspace,
      skipWrite: true, // SDK 自己写盘
    })

    const decision = await new Promise<{ applied: boolean }>((resolve) => {
      pendingWrites.attachResolver(pending.id, resolve)
    })
    if (!decision.applied) {
      return deny('User rejected the file change')
    }
    return allow()
  }

  // 4. NotebookEdit：MVP 不支持审批 diff，直接 deny 让用户切 Auto
  if (toolName === 'NotebookEdit') {
    if (ctx.approvalMode === 'auto') return allow()
    return deny('NotebookEdit approval not yet supported in Review mode; switch to Auto mode.')
  }

  // 5. 默认放行（Read / Grep / Glob / WebFetch / WebSearch / Task / TodoWrite / ...）
  return allow()
}

/** 把 Write/Edit 的输入转成「应用后的完整文件内容」用于 diff viewer。 */
function computeNewContent(
  toolName: string,
  input: Record<string, unknown>,
  oldContent: string | null,
): string | Error {
  if (toolName === 'Write') {
    return (input.content as string | undefined) ?? ''
  }
  if (toolName === 'Edit') {
    const old = (input.old_string as string | undefined) ?? ''
    const fresh = (input.new_string as string | undefined) ?? ''
    const all = !!input.replace_all
    if (oldContent === null) {
      return new Error('Edit requires an existing file (use Write to create)')
    }
    if (!all) {
      const count = oldContent.split(old).length - 1
      if (count === 0) {
        return new Error(`old_string not found in ${input.file_path}`)
      }
      if (count > 1) {
        return new Error(
          `old_string matches ${count} occurrences; use replace_all=true or include more context`,
        )
      }
    }
    return all ? oldContent.split(old).join(fresh) : oldContent.replace(old, fresh)
  }
  return new Error(`Unsupported write tool: ${toolName}`)
}
