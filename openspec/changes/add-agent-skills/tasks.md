## 1. Persistence And Shared Types

- [x] 1.1 Add a `skill_packages` table (id, name, description, source `builtin`/`imported`, source ref, install path, included skills JSON, createdAt).
- [x] 1.2 Add `agents.skillNames` JSON column (string[]), defaulting to empty.
- [x] 1.3 Add shared `SkillPackage`, `SkillSummary`, and skill source types; extend the `Agent` type with `skillNames`.
- [x] 1.4 Run `pnpm db:push` and confirm existing agents load with empty `skillNames`.

## 2. Skills Service

- [x] 2.1 Vendor the `docx` skill from `anthropics/skills` (`skills/docx`, including its `scripts/`) into `resources/agent-skills/`, shaped as a local SDK plugin the adapter can load.
- [x] 2.2 Discover bundled skill packages from the managed read-only resource directory.
- [x] 2.3 Implement import of a package from a GitHub repository (`git clone`) or a local path into the managed data-dir location (install-only, no execution).
- [x] 2.4 Register/list installed packages and the skills each includes.
- [x] 2.5 Resolve an agent's `skillNames` into the set of plugin paths and enabled skill names for the adapter.
- [x] 2.6 Add zod validation for import inputs and `SKILL.md` frontmatter (`name` + `description`); report invalid sources without installing them.

## 3. Adapter Wiring

- [x] 3.1 Extend `AdapterInput` with resolved `skills: string[]` and installed-package plugin paths.
- [x] 3.2 In `AgentRunner.buildAdapterInput`, populate skill fields only for Claude Code agents.
- [x] 3.3 In `ClaudeCodeAdapter`, set `options.plugins` for installed packages and `options.skills` for the agent's enabled skills.
- [x] 3.4 Keep skills disabled in the orchestrator planning stage (`isPlanStage`).
- [x] 3.5 Confirm Codex and Custom adapters ignore skill fields.

## 4. API

- [x] 4.1 Add `/api/skills` routes: list installed packages, import a package, list skills available to a Claude Code agent.
- [x] 4.2 Extend agent create/update bodies and validation with `skillNames`; reject non-empty `skillNames` for non-Claude adapters.

## 5. Agent Builder UI

- [x] 5.1 Add a skill selector to the detailed form for Claude Code agents, listing skills from installed packages with descriptions.
- [x] 5.2 Disable the selector with an explanation when the adapter is not Claude Code.
- [x] 5.3 Add a browse/import panel showing installed packages (builtin + imported) and their included skills, with a `git clone`/local-path import action, and note any external runtime requirements a skill declares (e.g. `docx` needs `pandoc`/`python`/LibreOffice).
- [x] 5.4 Show enabled skills on the agent profile/review surfaces before save.

## 6. Documentation And Verification

- [x] 6.1 Remove "Skills" (Claude Code scope) from the `specs/05-adapter-interface.md` deferred list and document the supported boundary.
- [x] 6.2 Update `specs/01-core-entities.md` (Agent `skillNames`), `specs/08-db-schema.md` (new table + column), and `specs/10-agent-builder.md` (skill selection + import).
- [ ] 6.3 Add tests for skill resolution, import validation, adapter skill wiring, and non-Claude rejection.
- [ ] 6.4 Run OpenSpec validation for `add-agent-skills`.
- [x] 6.5 Run targeted unit tests, `pnpm typecheck`, and `pnpm lint` without running `pnpm build`.
