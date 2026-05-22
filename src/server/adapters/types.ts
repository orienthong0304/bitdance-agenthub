import type { AdapterName, ModelProvider, StreamEvent } from '@/shared/types'

/**
 * AgentPlatformAdapter — 屏蔽不同 Agent 平台（Claude Code / Codex / Custom / Mock）
 * 的 API 差异，对上层提供统一的事件流。
 *
 * 详细规格见 specs/05-adapter-interface.md。
 */
export interface AgentPlatformAdapter {
  readonly name: AdapterName

  stream(input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent>
}

export interface AdapterInput {
  agentId: string
  conversationId: string
  runId: string

  /** 已被外层拼好的完整 prompt（群聊场景用 XML 包装） */
  prompt: string

  /** 工作目录绝对路径 */
  workspacePath: string

  /** 仅 CustomAgentAdapter 使用 */
  customConfig?: {
    systemPrompt: string
    modelProvider: ModelProvider
    modelId: string
  }
}
