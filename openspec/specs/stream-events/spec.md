# Stream Events

## Purpose

Defines the event contract connecting adapters, AgentRunner persistence, SSE transport, and frontend reducers. Detailed event shape lives in `specs/02-stream-events.md`.

## Requirements

### Requirement: StreamEvent SHALL be the only live update protocol

All agent output, tool activity, artifact creation, pending approvals, dispatch state, and usage updates SHALL flow through `StreamEvent` before reaching the UI.

#### Scenario: Adapter emits text
- **WHEN** an adapter starts a text part
- **THEN** AgentRunner persists the part
- **AND** EventBus publishes the same event to SSE subscribers.

### Requirement: Message streaming SHALL be bracketed

Each agent message MUST begin with `message.start` and finish with `message.end`, with part and tool events associated to the message id between those boundaries.

#### Scenario: Run completes normally
- **WHEN** the final adapter event has been consumed
- **THEN** the message status is updated to `complete`
- **AND** the run ends with status `complete`.

### Requirement: Usage events SHALL update durable accounting

Adapters SHALL emit `message.usage` and `run.usage` when provider usage data is available, and AgentRunner MUST persist those payloads without coupling to provider-specific token fields.

#### Scenario: Codex reports turn usage
- **WHEN** Codex emits `turn.completed.usage`
- **THEN** the adapter emits `message.usage`
- **AND** the adapter emits `run.usage` with the effective model id.

### Requirement: Deployment events SHALL inject deploy status parts

Adapters SHALL emit `deploy.status` when an AgentHub deploy tool finishes, and AgentRunner MUST convert that event into a `deploy_status` message part.

#### Scenario: Deploy tool returns ready
- **WHEN** `deploy_artifact` returns a ready deployment record
- **THEN** the adapter emits `deploy.status`
- **AND** AgentRunner persists and publishes a `part.start` for `deploy_status`.

### Requirement: Errors SHALL be visible in conversation state

Failures MUST be represented in both AgentRun status and conversation-visible message content.

#### Scenario: Provider rejects a request
- **WHEN** the adapter throws a provider error
- **THEN** AgentRunner marks streaming messages as `error`
- **AND** appends or creates a visible `[失败]` message.
