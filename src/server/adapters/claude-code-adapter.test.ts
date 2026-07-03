import { describe, expect, it } from 'vitest'

import { buildSdkEnv } from './claude-code-adapter'

describe('buildSdkEnv', () => {
  it('routes OAuth subscription tokens to CLAUDE_CODE_OAUTH_TOKEN and clears ANTHROPIC_API_KEY', () => {
    const env = buildSdkEnv('sk-ant-oat01-abc123', null)
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-abc123')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  it('prefers OAuth token routing even when a base URL is also configured', () => {
    const env = buildSdkEnv('sk-ant-oat01-abc123', 'https://gateway.example.com')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-abc123')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  it('passes a standard API key via ANTHROPIC_API_KEY', () => {
    const env = buildSdkEnv('sk-ant-api03-xyz789', null)
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-api03-xyz789')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  it('routes a third-party gateway key to ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL', () => {
    const env = buildSdkEnv('relay-key', 'https://anyrouter.example.com')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://anyrouter.example.com')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('relay-key')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })
})
