import { describe, expect, it } from 'vitest'

import { getToolDisplayName, isBashToolName, isCreateTaskToolName } from './tool-display'

describe('tool display helpers', () => {
  it('formats AgentHub tool names', () => {
    expect(getToolDisplayName('read_artifact')).toBe('读取产物')
    expect(getToolDisplayName('read_attachment')).toBe('读取附件')
    expect(getToolDisplayName('create_task')).toBe('建任务')
    expect(getToolDisplayName('fs_list')).toBe('浏览目录')
  })

  it('formats MCP-prefixed AgentHub tool names', () => {
    expect(getToolDisplayName('mcp__agenthub__read_attachment')).toBe('读取附件')
    expect(getToolDisplayName('codex_mcp_agenthub_write_artifact')).toBe('创建产物')
  })

  it('formats common external tool names', () => {
    expect(getToolDisplayName('Bash')).toBe('执行命令')
    expect(getToolDisplayName('Grep')).toBe('搜索文本')
  })

  it('detects direct and prefixed bash tools', () => {
    expect(isBashToolName('bash')).toBe(true)
    expect(isBashToolName('mcp__agenthub__bash')).toBe(true)
    expect(isBashToolName('read_attachment')).toBe(false)
    expect(isCreateTaskToolName('create_task')).toBe(true)
    expect(isCreateTaskToolName('mcp__agenthub__create_task')).toBe(true)
    expect(isCreateTaskToolName('read_attachment')).toBe(false)
  })
})
