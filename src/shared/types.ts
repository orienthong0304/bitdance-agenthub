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
export type ArtifactType = 'web_app' | 'code_file' | 'diff' | 'document' | 'image'

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

// ─── StreamEvent 联合 ─────────────────────────────────────
interface BaseEvent {
  conversationId: string
  timestamp: number
}

export type StreamEvent = BaseEvent &
  (
    | { type: 'run.start'; runId: string; agentId: string; triggerMessageId: string; parentRunId?: string }
    | { type: 'run.end'; runId: string; status: 'complete' | 'failed' | 'aborted'; error?: string }
    | { type: 'message.start'; messageId: string; agentId: string; runId: string }
    | { type: 'message.end'; messageId: string }
    | { type: 'part.start'; messageId: string; partIndex: number; part: MessagePart }
    | { type: 'part.delta'; messageId: string; partIndex: number; delta: PartDelta }
    | { type: 'part.end'; messageId: string; partIndex: number }
    | { type: 'tool.call'; messageId: string; callId: string; toolName: string; args: unknown }
    | { type: 'tool.result'; messageId: string; callId: string; result: unknown; isError: boolean }
    | { type: 'artifact.create'; artifact: ArtifactRecord }
    | { type: 'artifact.update'; artifactId: string; patch: Partial<ArtifactContent> }
    | { type: 'dispatch.plan'; runId: string; plan: DispatchPlanItem[] }
    | { type: 'dispatch.start'; parentRunId: string; childRunId: string; taskId: string; agentId: string }
    | { type: 'dispatch.end'; childRunId: string; taskId: string; status: 'complete' | 'failed' }
    | { type: 'heartbeat' }
  )

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
