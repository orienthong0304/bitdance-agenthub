## ADDED Requirements

### Requirement: ClaudeCodeAdapter SHALL support Agent Skills

`ClaudeCodeAdapter` SHALL enable an agent's selected skills by loading the installed skill packages as SDK local plugins and turning on the selected skills through the SDK `skills` option. Skills SHALL be enabled only for execution runs, not the orchestrator planning stage.

#### Scenario: Claude Code agent runs with enabled skills
- **WHEN** a Claude Code agent with non-empty enabled skills starts a run
- **THEN** the adapter passes the installed package paths as local plugins
- **AND** sets the SDK `skills` option to the agent's enabled skill names
- **AND** does not need to add `Skill` to the tool allowlist for those skills to work.

#### Scenario: Claude Code agent has no enabled skills
- **WHEN** a Claude Code agent has an empty enabled-skill set
- **THEN** the adapter omits skill plugins and the `skills` option
- **AND** behaves exactly as before this change.

#### Scenario: Orchestrator planning stage ignores skills
- **WHEN** the run is the orchestrator planning stage
- **THEN** no skills are enabled regardless of the agent's configuration.

### Requirement: Codex and Custom adapters SHALL NOT expose Agent Skills

Codex and Custom adapters SHALL ignore skill configuration because they have no native skill mechanism.

#### Scenario: Non-Claude adapter receives skill fields
- **WHEN** an adapter input for a Codex or Custom agent carries skill fields
- **THEN** the adapter ignores them
- **AND** the run proceeds without any skill behavior.

### Requirement: Skill execution SHALL reuse existing tool safety

Skills SHALL NOT introduce a new execution path. Any tool use a skill triggers MUST pass the adapter's existing approval and safety bridge.

#### Scenario: Skill triggers a tool call
- **WHEN** an enabled skill leads the agent to call a write, edit, or Bash tool
- **THEN** the call is routed through the same path checks, write approval, and command blacklist used for non-skill tool calls.
