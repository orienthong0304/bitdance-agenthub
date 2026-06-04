#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v4'

const server = new McpServer({
  name: 'agenthub',
  version: '1.0.0',
})

const baseUrl = requireEnv('AGENTHUB_INTERNAL_BASE_URL').replace(/\/+$/, '')
const token = requireEnv('AGENTHUB_INTERNAL_TOOL_TOKEN')
const conversationId = requireEnv('AGENTHUB_CONVERSATION_ID')
const agentId = requireEnv('AGENTHUB_AGENT_ID')
const runId = requireEnv('AGENTHUB_RUN_ID')

server.registerTool(
  'write_artifact',
  {
    description:
      'Create a previewable AgentHub artifact in the current conversation. Use web_app for HTML/CSS/JS bundles that should appear as preview cards.',
    inputSchema: {
      type: z.enum(['web_app', 'document', 'image']),
      title: z.string(),
      content: z
        .unknown()
        .describe(
          'Artifact body as a JSON OBJECT, NOT a JSON-stringified string. web_app: { files: { "index.html": "..." }, entry: "index.html" }. document: { format: "markdown", content: "..." }. image: { url, alt }.',
        ),
      parentArtifactId: z.string().optional(),
    },
  },
  async (args) => callAgentHubTool('write_artifact', args),
)

server.registerTool(
  'read_artifact',
  {
    description: 'Read the full content of an existing AgentHub artifact by id.',
    inputSchema: {
      artifactId: z.string(),
    },
  },
  async (args) => callAgentHubTool('read_artifact', args),
)

server.registerTool(
  'deploy_artifact',
  {
    description:
      'Create a ready local preview deployment for a web_app artifact and return previewPath plus package download paths. previewPath is a relative path for the current AgentHub instance; do not invent or print a public hostname.',
    inputSchema: {
      artifactId: z.string(),
    },
  },
  async (args) => callAgentHubTool('deploy_artifact', args),
)

async function callAgentHubTool(toolName, args) {
  const response = await fetch(`${baseUrl}/api/internal/agenthub-tools`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      toolName,
      args,
      conversationId,
      agentId,
      runId,
    }),
  })

  const result = await response.json().catch(() => ({
    ok: false,
    error: `AgentHub internal tool API returned ${response.status}`,
  }))

  if (!response.ok || !result.ok) {
    const error = typeof result.error === 'string' ? result.error : `HTTP ${response.status}`
    return {
      content: [{ type: 'text', text: `Error: ${error}` }],
      isError: true,
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result.value) }],
    structuredContent:
      result.value && typeof result.value === 'object' && !Array.isArray(result.value)
        ? result.value
        : undefined,
  }
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`[agenthub-codex-mcp] Missing ${name}`)
    process.exit(1)
  }
  return value
}

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[agenthub-codex-mcp] running on stdio')
