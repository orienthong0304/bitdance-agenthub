## Why

AgentHub has no concept of Agent Skills today. Claude Code agents run on `@anthropic-ai/claude-agent-sdk`, which natively supports skills and local plugins, but `specs/05-adapter-interface.md` explicitly defers "Skills / Plugins / Worktree SDK 高级特性". Users want to attach reusable skill packages (for example document processing for PDF / DOCX / XLSX / PPTX) to their agents, the same way competing products expose a "Skills" tab.

Skills are an Anthropic Claude ecosystem format. Only `ClaudeCodeAdapter` can consume them natively through the SDK. The first implementation is therefore scoped to Claude Code agents, with skill sources covering both bundled packages and user-imported packages.

## What Changes

- Add an `agent-skills` capability: a skill package is a local directory of one or more `SKILL.md`-defined skills, registered with a source (`builtin` or `imported`) and an install path.
- Bundle the `docx` skill from `anthropics/skills` as the first builtin package (extensible to `pdf` / `xlsx` / `pptx`), and let users import additional skill packages by `git clone` of a GitHub repository or from a local path.
- Install imported packages into an AgentHub-managed directory (not the per-conversation workspace), distinct from the existing developer-recipe `skills/` directory.
- Persist enabled skills per agent via a new `agents.skillNames` column, mirroring `toolNames`; register installed packages in a new `skill_packages` table.
- Pass the agent's enabled skills into `ClaudeCodeAdapter`, which loads packages via SDK `plugins` and turns skills on via the SDK `skills` option (the supported way to enable the `Skill` tool).
- Make Codex and Custom adapters explicitly skill-unaware: they ignore skill configuration and the builder UI disables the skill selector for them.
- Extend the agent builder: Claude Code agents get a skill selector listing skills from installed packages; add a browse/import panel for managing packages.
- Remove "Skills" (Claude Code scope) from the `specs/05-adapter-interface.md` deferred list and document the supported boundary.

## Capabilities

### New Capabilities

- `agent-skills`: Skill package model, sources (builtin / imported), install/discovery, per-agent enablement, and the Claude-Code-only boundary plus safety constraints.

### Modified Capabilities

- `persistence`: Add the `skill_packages` table and the `agents.skillNames` column.
- `adapters`: `ClaudeCodeAdapter` loads skill packages and enables selected skills; Codex / Custom adapters do not expose skills.
- `agent-builder`: Add a skill selector for Claude Code agents and a package browse/import panel.

## Impact

- `src/db/schema.ts`: new `skill_packages` table; `agents.skillNames` JSON column. Requires `pnpm db:push`.
- `src/shared/types.ts`: `SkillPackage`, `SkillSummary`, skill source enums; extend the `Agent` type with `skillNames`.
- `src/server/adapters/types.ts`: extend `AdapterInput` with resolved `skills` and skill package plugin paths.
- `src/server/adapters/claude-code-adapter.ts`: set `options.plugins` for installed packages and `options.skills` for the agent's enabled skills; keep the planning stage skill-free.
- New `src/server/skills-service.ts` (or similar): discover bundled packages, import packages, register/list installed packages, resolve an agent's enabled skill names to plugin paths.
- New `/api/skills` route(s): list installed packages, import a package, list skills available to an agent.
- `src/server/agent-runner.ts` (`buildAdapterInput`): resolve `agent.skillNames` + installed packages into `AdapterInput.skills` / plugin paths.
- `src/components/create-agent-dialog.tsx`: skill selector for Claude Code agents; disabled state for non-Claude adapters.
- New UI for the skill browse/import panel (matching the existing library/dialog patterns).
- `src/app/api/agents/route.ts` and `[id]/route.ts`: accept and validate `skillNames`.
- Docs: `specs/05-adapter-interface.md` (deferred list + ClaudeCodeAdapter section), `specs/01-core-entities.md` (Agent fields), `specs/08-db-schema.md` (schema), `specs/10-agent-builder.md` (builder flow), and the matching OpenSpec specs.
