import type { AgentRow } from '@/db/schema'
import type { AdapterName } from '@/shared/types'

import { MockAdapter } from './mock-adapter'
import type { AgentPlatformAdapter } from './types'

/**
 * AgentRegistry — 根据 Agent.adapterName 路由到对应实现。
 *
 * 真实 adapter（ClaudeCode/Codex/CustomAgent）在后续 milestone 注册。
 */
class AgentRegistry {
  private adapters = new Map<AdapterName, AgentPlatformAdapter>()

  register(adapter: AgentPlatformAdapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  getAdapter(agent: AgentRow): AgentPlatformAdapter {
    const adapter = this.adapters.get(agent.adapterName)
    if (!adapter) {
      throw new Error(
        `No adapter registered for "${agent.adapterName}" (agent: ${agent.name} / ${agent.id})`,
      )
    }
    return adapter
  }
}

const globalForRegistry = globalThis as unknown as {
  __agenthubRegistry?: AgentRegistry
}

function buildRegistry(): AgentRegistry {
  const reg = new AgentRegistry()
  reg.register(new MockAdapter())
  // TODO 后续 milestone 在此注册 ClaudeCodeAdapter / CodexAdapter / CustomAgentAdapter
  return reg
}

export const agentRegistry = globalForRegistry.__agenthubRegistry ?? buildRegistry()

if (!globalForRegistry.__agenthubRegistry) {
  globalForRegistry.__agenthubRegistry = agentRegistry
}
