# Artifacts

## Purpose

Defines generated artifacts, versioning, previews, and export behavior. Detailed artifact content notes live in `specs/04-artifacts.md`.

## Requirements

### Requirement: Artifacts SHALL have independent lifecycle

Artifacts MUST be stored independently from messages and linked to conversations, creators, type, version, and optional parent artifact id.

#### Scenario: UI opens an artifact card
- **WHEN** a user selects an artifact reference
- **THEN** the preview panel loads the artifact by id
- **AND** message content is not used as the source of truth.

### Requirement: Artifact content SHALL be typed

Artifact content MUST be a discriminated union keyed by artifact type so renderers can validate and branch without markdown parsing.

#### Scenario: HTML artifact renders
- **WHEN** an artifact has web app content
- **THEN** the preview renders it in a sandboxed iframe.

### Requirement: Web app preview SHALL be addressable

Each `web_app` artifact MUST have an HTTP preview route that renders the same HTML package used by the preview panel under sandboxing headers.

#### Scenario: User opens preview URL
- **WHEN** the user opens `/api/artifacts/{id}/preview`
- **THEN** a `web_app` artifact is returned as sandboxed HTML
- **AND** non-web artifacts are rejected.

### Requirement: Artifact writes SHALL record ownership

Every artifact created by an agent MUST record the originating conversation and agent id.

#### Scenario: Tool creates an artifact
- **WHEN** `write_artifact` succeeds
- **THEN** the inserted artifact row includes `conversationId` and `createdByAgentId`.

### Requirement: Artifact edits SHALL be append-only

Editing an artifact SHALL create a new artifact version linked to the previous version instead of mutating historical content when edit flows are implemented.

#### Scenario: Future edit creates a version
- **WHEN** an artifact edit flow is implemented
- **THEN** it creates a new row with `parentArtifactId`
- **AND** increments `version`.
