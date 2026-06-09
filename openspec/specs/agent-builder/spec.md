# Agent Builder

## Purpose

Defines how users create and edit non-orchestrator agents from the UI. Detailed behavior lives in `specs/10-agent-builder.md`.

## Requirements

### Requirement: User-created agents SHALL default to Custom adapter

New agents MUST default to `adapterName='custom'` unless the user selects Claude Code or Codex SDK adapter.

#### Scenario: User opens create dialog
- **WHEN** no existing agent is being edited
- **THEN** adapter kind defaults to Custom
- **AND** provider defaults to DeepSeek.

### Requirement: Custom agents SHALL require provider and model

Custom agents MUST have `modelProvider` and a non-empty `modelId`; SDK agents SHALL ignore `modelProvider`.

#### Scenario: User clears custom model id
- **WHEN** adapter kind is Custom
- **THEN** form submission is rejected.

### Requirement: SDK agents SHALL use built-in tool sets

Claude Code and Codex agents MUST persist `toolNames=[]` because their tools come from the SDK runtime rather than AgentHub `toolRegistry`.

#### Scenario: User switches from Custom to Codex
- **WHEN** the form is submitted
- **THEN** the saved agent has no custom tool names.

### Requirement: Custom agents SHALL expose structured question tooling

The agent builder MUST allow custom agents to enable `ask_user`, and newly created custom agents SHOULD include it in the default tool set.

#### Scenario: User creates a custom agent
- **WHEN** the create dialog opens for a Custom adapter agent
- **THEN** `ask_user` is available in the tool checklist
- **AND** it is selected by default.

### Requirement: Codex agent configuration SHALL reject unsupported base URLs

The agent builder MUST validate known unsupported Codex base URLs before saving or running the agent.

#### Scenario: DeepSeek URL is entered for Codex
- **WHEN** the Base URL host is `api.deepseek.com`
- **THEN** the UI shows a Codex/Responses compatibility error.

### Requirement: API key hints SHALL match adapter fallback

The UI MUST display key fallback hints that match AgentRunner's key resolution for selected adapter/provider.

#### Scenario: Codex key field is empty
- **WHEN** a Codex agent is saved without per-agent key
- **THEN** runtime falls back to app OpenAI key, `CODEX_API_KEY`, or `OPENAI_API_KEY`.
