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

  /** 当前 run 可用的工具名列表。AgentRunner 已经做完 override 选择，adapter 直接用。 */
  toolNames: string[]

  /** 触发消息的附件（图片 / 文件），adapter 决定是否注入到 LLM content */
  attachments?: AdapterAttachment[]

  /** 仅 CustomAgentAdapter 使用 */
  customConfig?: {
    systemPrompt: string
    modelProvider: ModelProvider
    modelId: string
    /** 该 agent 的 model 是否支持视觉（来自 agent.supportsVision） */
    supportsVision?: boolean
    /** 该 agent 单独配置的 API key（来自 agent.apiKey）；空时 fallback env */
    apiKey?: string | null
  }
}

export interface AdapterAttachment {
  id: string
  fileName: string
  mimeType: string
  kind: 'image' | 'file'
  /** 文件的本地绝对路径，adapter 读 base64 用 */
  absPath: string
}
