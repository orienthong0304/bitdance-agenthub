/**
 * Drizzle schema — 与 specs/01-core-entities.md 对应。
 *
 * 修改本文件后必须运行 `pnpm db:push` 同步到 SQLite。
 */

import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ArtifactContent, ArtifactType, AdapterName, MessagePart, ModelProvider } from '@/shared/types'

// ─── Agents ──────────────────────────────────────────────────
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  description: text('description').notNull(),
  capabilities: text('capabilities', { mode: 'json' }).$type<string[]>().notNull(),

  systemPrompt: text('system_prompt').notNull(),
  adapterName: text('adapter_name').$type<AdapterName>().notNull(),

  modelProvider: text('model_provider').$type<ModelProvider>(),
  modelId: text('model_id'),
  /**
   * 该 agent 单独的 API key。优先级高于 env var。
   * NULL 表示走 env（DEEPSEEK_API_KEY / OPENAI_API_KEY / ARK_API_KEY / ANTHROPIC_API_KEY）。
   */
  apiKey: text('api_key'),

  toolNames: text('tool_names', { mode: 'json' }).$type<string[]>().notNull(),

  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  isOrchestrator: integer('is_orchestrator', { mode: 'boolean' }).notNull().default(false),
  supportsVision: integer('supports_vision', { mode: 'boolean' }).notNull().default(false),

  createdAt: integer('created_at').notNull(),
})

// ─── Conversations ───────────────────────────────────────────
export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    mode: text('mode', { enum: ['single', 'group'] }).notNull(),
    agentIds: text('agent_ids', { mode: 'json' }).$type<string[]>().notNull(),
    pinnedMessageIds: text('pinned_message_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),

    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_conv_updated').on(t.updatedAt)],
)

// ─── Messages ────────────────────────────────────────────────
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    role: text('role', { enum: ['user', 'agent', 'system'] }).notNull(),
    agentId: text('agent_id').references(() => agents.id),

    parts: text('parts', { mode: 'json' }).$type<MessagePart[]>().notNull(),

    status: text('status', { enum: ['streaming', 'complete', 'error', 'aborted'] }).notNull(),
    parentMessageId: text('parent_message_id'),
    mentionedAgentIds: text('mentioned_agent_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),

    runId: text('run_id'),

    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_messages_conv_created').on(t.conversationId, t.createdAt)],
)

// ─── Artifacts ───────────────────────────────────────────────
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    type: text('type').$type<ArtifactType>().notNull(),
    title: text('title').notNull(),
    content: text('content', { mode: 'json' }).$type<ArtifactContent>().notNull(),

    version: integer('version').notNull().default(1),
    parentArtifactId: text('parent_artifact_id'),

    createdByAgentId: text('created_by_agent_id')
      .notNull()
      .references(() => agents.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_artifacts_conv').on(t.conversationId)],
)

// ─── Workspaces ──────────────────────────────────────────────
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .unique()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  rootPath: text('root_path').notNull(),
  createdAt: integer('created_at').notNull(),
})

// ─── Attachments (会话文件库) ─────────────────────────────────
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    kind: text('kind', { enum: ['image', 'file'] }).notNull(),
    fileName: text('file_name').notNull(),
    filePath: text('file_path').notNull(),    // 相对 workspace.rootPath
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),

    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_attachments_conv').on(t.conversationId)],
)

// ─── AgentRuns ───────────────────────────────────────────────
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    triggerMessageId: text('trigger_message_id'),

    status: text('status', { enum: ['queued', 'running', 'complete', 'failed', 'aborted'] }).notNull(),
    error: text('error'),

    parentRunId: text('parent_run_id'),

    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('idx_runs_parent').on(t.parentRunId)],
)

// ─── 类型导出（推断行类型）─────────────────────────────────
export type AgentRow = typeof agents.$inferSelect
export type AgentInsert = typeof agents.$inferInsert

export type ConversationRow = typeof conversations.$inferSelect
export type ConversationInsert = typeof conversations.$inferInsert

export type MessageRow = typeof messages.$inferSelect
export type MessageInsert = typeof messages.$inferInsert

export type ArtifactRow = typeof artifacts.$inferSelect
export type ArtifactInsert = typeof artifacts.$inferInsert

export type WorkspaceRow = typeof workspaces.$inferSelect
export type WorkspaceInsert = typeof workspaces.$inferInsert

export type AttachmentRow = typeof attachments.$inferSelect
export type AttachmentInsert = typeof attachments.$inferInsert

export type AgentRunRow = typeof agentRuns.$inferSelect
export type AgentRunInsert = typeof agentRuns.$inferInsert
