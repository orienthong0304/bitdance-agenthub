## MODIFIED Requirements

### Requirement: Database schema SHALL map domain entities

The SQLite schema MUST persist agents, conversations, messages, artifacts, workspaces, attachments, agent runs, context summaries, app settings, and installed skill packages.

#### Scenario: New conversation is created
- **WHEN** a conversation is inserted
- **THEN** a workspace row is created or associated
- **AND** messages and runs can reference the conversation id.

#### Scenario: Skill package is installed
- **WHEN** a skill package is registered as `builtin` or `imported`
- **THEN** a `skill_packages` row stores its id, name, description, source, source reference, install path, and included skills
- **AND** agents can reference its skills by name.

## ADDED Requirements

### Requirement: Agents SHALL persist enabled skills

The `agents` table SHALL include a `skillNames` JSON column storing the agent's enabled skill names (string array). It SHALL default to empty so existing agents are unaffected.

#### Scenario: Existing agent loads after migration
- **WHEN** an agent created before this change is loaded
- **THEN** its `skillNames` is an empty array
- **AND** the agent runs with no skills enabled.

#### Scenario: Claude Code agent saves enabled skills
- **WHEN** a Claude Code agent is saved with selected skills
- **THEN** the selected skill names are persisted in `skillNames`.
