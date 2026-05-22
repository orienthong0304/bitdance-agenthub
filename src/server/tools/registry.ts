import { planTasksTool } from './plan-tasks'
import { readArtifactTool } from './read-artifact'
import type { ToolContext, ToolDef, ToolResult } from './types'
import { writeArtifactTool } from './write-artifact'

/**
 * ToolRegistry —— 工具全局注册中心。
 *
 * Agent 通过 `agent.toolNames` 引用工具名，AgentRunner 在组装 Adapter 输入
 * 时从这里查出 ToolDef。
 */

class ToolRegistry {
  private tools = new Map<string, ToolDef>()

  register(tool: ToolDef): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  resolve(names: string[]): ToolDef[] {
    const resolved: ToolDef[] = []
    for (const name of names) {
      const t = this.tools.get(name)
      if (!t) throw new Error(`Unknown tool: ${name}`)
      resolved.push(t)
    }
    return resolved
  }

  async execute(toolName: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(toolName)
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${toolName}` }
    }
    try {
      return await tool.handler(args, ctx)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

const globalForTools = globalThis as unknown as {
  __agenthubToolRegistry?: ToolRegistry
}

function buildRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  reg.register(writeArtifactTool)
  reg.register(readArtifactTool)
  reg.register(planTasksTool)
  return reg
}

export const toolRegistry = globalForTools.__agenthubToolRegistry ?? buildRegistry()

if (!globalForTools.__agenthubToolRegistry) {
  globalForTools.__agenthubToolRegistry = toolRegistry
}

export type { ToolContext, ToolDef, ToolResult } from './types'
