# Tools

## Purpose

Defines AgentHub-managed tools, approval boundaries, and adapter-specific tool ownership. Detailed tool specs live in `specs/07-tools.md`.

## Requirements

### Requirement: Tool definitions SHALL be registered centrally

AgentHub-managed tools MUST be registered through `toolRegistry` with name, description, JSON schema, and handler.

#### Scenario: Custom agent enables a tool
- **WHEN** an agent's `toolNames` includes `fs_read`
- **THEN** CustomAgentAdapter resolves the tool definition from `toolRegistry`.

### Requirement: File tools SHALL enforce workspace boundaries

`fs_read`, `fs_write`, and `bash` MUST resolve paths under the conversation effective cwd and reject access outside that tree.

#### Scenario: Agent attempts path traversal
- **WHEN** a tool receives `../../.ssh/id_rsa`
- **THEN** the path check rejects the operation.

### Requirement: Bash SHALL enforce platform blacklist

The bash tool MUST reject commands that match the platform-specific banned pattern list before execution.

#### Scenario: POSIX destructive command is requested
- **WHEN** the command matches `rm -rf /`
- **THEN** the tool refuses to run it.

### Requirement: Review mode SHALL require write approval

In review mode, file write effects managed by AgentHub MUST create pending approvals instead of directly mutating workspace files.

#### Scenario: Agent proposes a file write
- **WHEN** `fs_write` is called in review mode
- **THEN** AgentHub records a pending write
- **AND** waits for explicit user approval.

### Requirement: SDK tool sets SHALL be documented separately

Claude Code and Codex SDK adapters MUST document their built-in tool ownership and any approval bridge limitations instead of pretending those tools are AgentHub `toolRegistry` tools.

#### Scenario: Codex agent runs in review mode
- **WHEN** a Codex agent is selected
- **THEN** Codex uses read-only sandbox mode
- **AND** AgentHub exposes only the allowlisted artifact MCP tools to Codex.

### Requirement: Web app artifacts SHALL be deployable to preview URLs

AgentHub MUST provide a `deploy_artifact` tool that accepts a web app artifact id and returns a deployment status record with a preview path.

#### Scenario: Agent deploys a web app artifact
- **WHEN** `deploy_artifact` receives a valid `web_app` artifact id
- **THEN** it returns a ready deployment record
- **AND** the record points at the artifact preview route.

#### Scenario: Agent deploys a non-web artifact
- **WHEN** `deploy_artifact` receives a document, image, or missing artifact id
- **THEN** it returns a failed deployment record with a user-visible reason.
