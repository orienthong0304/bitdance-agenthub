/**
 * 共享类型 — 前后端都引用此文件。
 * 与 specs/01-core-entities.md, specs/02-stream-events.md, specs/03-message-parts.md 对应。
 */

// ─── MessagePart 联合类型 ─────────────────────────────────
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; callId: string; toolName: string; args: unknown }
  | { type: 'tool_result'; callId: string; result: unknown; isError: boolean }
  | { type: 'artifact_ref'; artifactId: string }
  | { type: 'deploy_status'; deployment: DeployStatusRecord }
  | { type: 'deploy_candidates'; candidates: DeployCandidateRecord[] }
  | {
      type: 'image_attachment'
      attachmentId: string
      fileName: string
      size: number
      mimeType: string
    }
  | {
      type: 'file_attachment'
      attachmentId: string
      fileName: string
      size: number
      mimeType: string
    }

// ─── 增量 delta（流式追加）─────────────────────────────────
export type PartDelta =
  | { type: 'text.append'; text: string }
  | { type: 'code.append'; text: string }
  | { type: 'thinking.append'; text: string }

// ─── Artifact 内容（联合）─────────────────────────────────
export type ArtifactType = 'web_app' | 'code_file' | 'diff' | 'document' | 'image' | 'ppt'

export type ArtifactContent =
  | {
      type: 'web_app'
      files: Record<string, string>
      entry: string
    }
  | {
      type: 'code_file'
      workspacePath: string
      language: string
      sizeBytes: number
      checksum: string
    }
  | {
      type: 'diff'
      targetArtifactId: string
      hunks: DiffHunk[]
      applied: boolean
    }
  | {
      type: 'document'
      format: 'markdown'
      content: string
    }
  | {
      type: 'image'
      url: string
      alt: string
      width?: number
      height?: number
    }
  | {
      type: 'ppt'
      title?: string
      theme?: PptTheme
      slides: PptSlide[]
    }

export type PptLayout = 'title' | 'title-bullets' | 'section' | 'blank'

export interface PptSlide {
  title?: string
  bullets?: string[]
  notes?: string
  layout?: PptLayout
}

export interface PptTheme {
  /** 不带 # 的 hex，如 '1E40AF' */
  primaryColor?: string
  fontFace?: string
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

// ─── Adapter 名称 ──────────────────────────────────────────
export type AdapterName = 'claude-code' | 'codex' | 'custom' | 'mock'

export type ModelProvider = 'anthropic' | 'openai' | 'deepseek' | 'volcano-ark'

// ─── 调度 plan ────────────────────────────────────────────
export interface DispatchPlanItem {
  id: string
  agentId: string
  task: string
  dependsOn?: string[]
}

export type DispatchTaskStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed'
  | 'aborted'
  | 'skipped'

export type DispatchTaskEndStatus = Exclude<DispatchTaskStatus, 'pending' | 'running'>

// ─── Agent 写文件审批 ─────────────────────────────────────
/**
 * Agent 调 fs_write 在 review 模式下产出的「待审批」记录。后端持有 promise，
 * 前端展示 diff 让用户决定 approve / reject。详见 specs/07-tools.md fs_write 一节。
 */
export interface PendingWrite {
  id: string                  // pwr_<nanoid>
  conversationId: string
  agentId: string
  runId: string
  /** 相对 workspace 的路径 */
  path: string
  absolutePath: string
  /** null = 新建文件 */
  oldContent: string | null
  newContent: string
  createdAt: number
}

/**
 * Agent 调 ask_user 工具想结构化问用户问题；前端弹 dialog 让用户选项，
 * 选完后通过 attachResolver 唤醒 await，工具 handler 返回 answers。
 * Schema 对齐 Anthropic SDK 的 AskUserQuestion（1-4 questions × 2-4 options），
 * 让 CustomAgent / ClaudeCodeAdapter 共用同一 UI。
 */
export interface AskUserOption {
  label: string
  description?: string
  /** 可选的预览内容（mockup / code snippet 等），UI 显示在右侧或下方 */
  preview?: string
}
export interface AskUserQuestionItem {
  /** 完整问题文本 */
  question: string
  /** 短标签（chip） */
  header: string
  options: AskUserOption[]
  /** 默认 false。true 时允许多选；答案在 answers 里逗号分隔。 */
  multiSelect?: boolean
}
export interface PendingQuestion {
  id: string                  // pq_<nanoid>
  conversationId: string
  agentId: string
  runId: string
  questions: AskUserQuestionItem[]
  createdAt: number
}

export interface DeployStatusRecord {
  id: string
  artifactId: string
  title: string
  version: number
  previewPath: string
  status: 'ready' | 'failed'
  deploymentType?: 'local_static' | 'external_static'
  deploymentPath?: string
  localPreviewPath?: string
  publicUrl?: string
  publishPath?: string
  publishTargetType?: 'static_directory'
  sourceDownloadPath?: string
  containerDownloadPath?: string
  summaryInstruction?: string
  error?: string
  createdAt: number
}

export interface DeployCandidateRecord {
  artifactId: string
  title: string
  version: number
  createdByAgentId: string
  createdAt: number
}
/** 单条问题的答案：选中的 label 列表 + 可选自由文本（点「其他」时填）。 */
export interface AskUserAnswer {
  selectedLabels: string[]
  freeformNote?: string
}

// ─── StreamEvent 联合 ─────────────────────────────────────
interface BaseEvent {
  conversationId: string
  timestamp: number
}

export type StreamEvent = BaseEvent &
  (
    | { type: 'run.start'; runId: string; agentId: string; triggerMessageId: string; parentRunId?: string }
    | { type: 'run.end'; runId: string; status: 'complete' | 'failed' | 'aborted'; error?: string }
    | { type: 'run.usage'; runId: string; usage: RunUsageEvent }
    | { type: 'message.start'; messageId: string; agentId: string; runId: string }
    | { type: 'message.end'; messageId: string }
    | { type: 'message.usage'; messageId: string; usage: MessageUsageEvent }
    | { type: 'part.start'; messageId: string; partIndex: number; part: MessagePart }
    | { type: 'part.delta'; messageId: string; partIndex: number; delta: PartDelta }
    | { type: 'part.end'; messageId: string; partIndex: number }
    | { type: 'tool.call'; messageId: string; callId: string; toolName: string; args: unknown }
    | { type: 'tool.result'; messageId: string; callId: string; result: unknown; isError: boolean }
    | { type: 'artifact.create'; artifact: ArtifactRecord }
    | { type: 'artifact.update'; artifactId: string; patch: Partial<ArtifactContent> }
    | { type: 'deploy.status'; messageId: string; deployment: DeployStatusRecord }
    | { type: 'dispatch.plan'; runId: string; plan: DispatchPlanItem[] }
    | { type: 'dispatch.start'; parentRunId: string; childRunId: string; taskId: string; agentId: string }
    | {
        type: 'dispatch.end'
        parentRunId: string
        childRunId?: string
        taskId: string
        status: DispatchTaskEndStatus
        error?: string
      }
    | { type: 'fs_write.pending'; pendingWrite: PendingWrite }
    | { type: 'fs_write.resolved'; pendingId: string; applied: boolean }
    | { type: 'ask_user.pending'; pendingQuestion: PendingQuestion }
    | { type: 'ask_user.resolved'; pendingId: string; answered: boolean }
    | { type: 'heartbeat' }
  )

/** RunUsage 事件 payload。与 db/schema.ts 的 RunUsage 同形，重复定义避开 client/server 边界 import。 */
export interface RunUsageEvent {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  lastInputTokens?: number
  model?: string
}

/** Per-message usage 事件 payload。与 db/schema.ts 的 MessageUsage 同形。 */
export interface MessageUsageEvent {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

// 简化版 Artifact，用于事件 payload（与 DB 行结构一致）
export interface ArtifactRecord {
  id: string
  conversationId: string
  type: ArtifactType
  title: string
  content: ArtifactContent
  version: number
  parentArtifactId?: string
  createdByAgentId: string
  createdAt: number
}
