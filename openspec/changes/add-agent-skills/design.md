## Context

`ClaudeCodeAdapter` runs `query()` from `@anthropic-ai/claude-agent-sdk`. The SDK already exposes everything needed for Agent Skills:

- `Options.plugins?: SdkPluginConfig[]` — load a local plugin directory (`{ type: 'local', path }`), which can provide skills.
- `Options.skills?: string[] | 'all'` — the single place to turn skills on; with this set, the `Skill` tool is enabled without adding `'Skill'` to `allowedTools`. `string[]` enables only the listed skills, matched by `SKILL.md` name / directory name or `plugin:skill`.
- `Options.settingSources` — currently `['project']`, which discovers `.claude/skills/` inside the bound workspace.

The SDK documents a critical property: `skills` is **a context filter, not a sandbox**. Unlisted skills are hidden from the model's listing and rejected by the `Skill` tool, but their files remain on disk and are reachable via `Read`/`Bash`. Secrets must never be stored in skill files.

Skills are an Anthropic format. Codex (`@openai/codex-sdk`) and Custom (OpenAI-compatible Chat Completions) adapters have no equivalent runtime mechanism, so the first implementation is Claude-Code-only by design rather than by omission.

## Goals / Non-Goals

**Goals:**

- Let users attach skills to Claude Code agents and see which skills are enabled before saving.
- Ship a small set of bundled official skill packages out of the box.
- Let users import additional skill packages from a GitHub repository or a local path.
- Keep package files in an AgentHub-managed location, not in per-conversation workspaces.
- Reuse the existing security boundaries (Bash blacklist, write approval, workspace path checks) for anything a skill makes the agent run.
- Keep skill configuration off the orchestrator planning stage.

**Non-Goals:**

- Skills for Codex or Custom adapters (no native mechanism; a "prompt-injected SKILL.md" degradation is explicitly out of scope for this change).
- A hosted skill marketplace, ratings, or remote update notifications.
- Editing skill package contents inside AgentHub.
- Per-conversation (as opposed to per-agent) skill toggles.
- Versioned/upgradable packages beyond recording the imported source reference.

## Decisions

### A skill package is the unit of install; a skill is the unit of enablement

A **skill package** is a directory containing one or more skills (each skill is a `SKILL.md` with frontmatter `name` + `description`). This matches the screenshot's "文档技能" package bundling `pdf` / `docx` / `xlsx` / `pptx`. Packages are installed/registered as a whole; agents enable individual skills by name.

`agents.skillNames` stores the enabled skill names (or `plugin:skill` qualified names), mirroring how `toolNames` already works. Empty/NULL means no skills — equivalent to today's behavior.

Alternative considered: enable whole packages per agent. Rejected because users want fine-grained control (e.g. enable only `pdf` from a document package) and the SDK already filters at the skill level.

### Packages load as local SDK plugins, enabled via `options.skills`

Installed packages are shaped as local plugin directories and passed to the SDK as `plugins: [{ type: 'local', path: pkgDir }, ...]`. The adapter then sets `options.skills = input.skills` (the agent's resolved enabled list). This keeps package files in a managed location and does not require copying skills into every workspace.

`settingSources` stays `['project']`, so a power user can still drop `.claude/skills/` into a bound local project and have those discovered too; the managed packages are additive via `plugins`.

Alternative considered: copy enabled skills into each workspace's `.claude/skills/` and rely solely on `settingSources`. Rejected because it duplicates files per conversation, complicates cleanup, and mixes managed packages with project content.

### Bundled set is the `docx` skill from anthropics/skills

The first bundled package vendors a single skill, `docx`, from `https://github.com/anthropics/skills/tree/main/skills/docx`, registered as a builtin package (named e.g. `anthropics-document-skills`) that currently includes one skill. `pdf` / `xlsx` / `pptx` can be added to the same package later.

Important: `docx` is **not** a prompt-only skill. Its directory ships a `scripts/` folder (Python helpers) and a `SKILL.md` that calls external runtimes — `pandoc`, `python`, the Node `docx-js` library, and LibreOffice (`soffice`) for `.doc` conversion. Two consequences:

- **Runtime dependency, not bundled by us.** AgentHub does not install `pandoc`/`python`/LibreOffice (the project rule is "no new deps, local-first"). When the agent runs a skill command and the host lacks the tool, the command fails through the normal Bash error path. The skill is "installed" regardless; full functionality depends on the host environment. The browse panel should note the skill's external requirements.
- **License.** The `docx` skill carries a `LICENSE.txt` marked Proprietary. Decision: vendor it into the repo (option A) with its `LICENSE.txt` kept intact. Confirming that the Anthropic proprietary terms permit redistribution is a release-checklist item before shipping, not a code task.

### Managed install location, separate from the developer `skills/` directory

The repo already has a top-level `skills/` directory holding **AI-collaboration recipes** (`add-adapter.md`, etc.) — a completely different concept. To avoid confusion:

- Bundled packages ship read-only under an app resource directory `resources/agent-skills/`, resolved relative to the app in dev and relative to the packaged resources on desktop (Electron), following the same per-runtime path resolution Spec 12 already uses for `dataDir`.
- Imported packages install under the AgentHub data dir at `<dataDir>/agent-skills/<packageId>/` — the same data-dir convention used for workspaces and the SQLite DB (`.agenthub-data` in dev, `app.getPath('userData')` on desktop).

These directories MUST NOT reuse the developer-recipe `skills/` path.

### Only ClaudeCodeAdapter consumes skills

`AdapterInput` gains a resolved `skills: string[]` and the plugin paths for installed packages. `AgentRunner.buildAdapterInput` populates them only for Claude Code agents. Codex / Custom adapters ignore the fields. The builder UI disables the skill selector when the adapter is not `claude-code` and explains why.

### Planning stage stays skill-free

When `isPlanStage` is true (orchestrator dispatch planning), the adapter already restricts tools to a minimal set. Skills are not enabled in that stage to keep planning deterministic and cheap; skills apply to execution runs only.

### Importing is install-only; execution stays behind existing gates

GitHub import is a `git clone` of the user-specified repository into a temp area, then a copy of the relevant skill directory(ies) into the managed location. It never executes anything at import time. When an agent later runs and a skill instructs it to use `Bash`/`Write`/`Read`, those calls still pass through the adapter's existing `canUseTool` bridge: the Bash blacklist, command approval, write approval, and workspace path checks all apply unchanged, because that bridge is source-agnostic.

On import, `SKILL.md` frontmatter is validated: each skill must have a `name` and `description`. A source with no valid `SKILL.md` is rejected and reported; nothing partial is registered as usable. Clone requires network and a `git` binary; failures (offline, bad repo, auth) surface as a clear import error rather than a partial install.

## Risks / Trade-offs

- **Imported skills are executable content.** A malicious `SKILL.md` can instruct the agent toward harmful commands. Mitigation: import is install-only; all execution stays behind the existing Bash blacklist + approval + workspace sandbox; the import UI surfaces the source (repo/path) and requires explicit user action. GitHub import should target a user-specified repo, not arbitrary auto-discovery.
- **Skills are a context filter, not a sandbox** (SDK property). Disabled-skill files remain readable via `Read`/`Bash`. Mitigation: document this; never store secrets in skill files; treat the managed directory as readable content, not a vault.
- **Adapter asymmetry confuses users** (works for Claude, not Codex/Custom). Mitigation: the builder clearly disables and explains the selector for non-Claude adapters.
- **Bundled-vs-imported precedence / name collisions.** Two packages can define a skill with the same name. Mitigation: prefer `plugin:skill` qualified names in `skillNames`; surface collisions in the browse panel.
- **Bundled `docx` needs host runtimes.** It depends on `pandoc` / `python` / LibreOffice / `docx-js`. AgentHub does not install them; on a bare host the skill loads but its commands fail. Mitigation: surface the skill's external requirements in the browse panel; treat the failure as a normal Bash error, not a crash.
- **`docx` license is Proprietary.** Redistributing it inside the app needs clearance. Mitigation: either clear the license before shipping, or fetch it on first use via the clone path instead of vendoring it into the repo.
- **Dirty working tree.** `src/db/schema.ts`, `claude-code-adapter.ts`, `create-agent-dialog.tsx`, and `agent-runner.ts` already have uncommitted changes; implementation must rebase on the current files and avoid unrelated refactors.

## Migration Plan

1. Add `skill_packages` table + `agents.skillNames` column; run `pnpm db:push`. `skillNames` defaults to empty, so existing agents are unaffected.
2. Add the skills service: discover bundled packages, import packages, register/list installed packages, resolve enabled names to plugin paths.
3. Extend `AdapterInput` and `buildAdapterInput`; wire `ClaudeCodeAdapter` to set `plugins` + `skills`.
4. Add `/api/skills` routes; extend agent create/update validation with `skillNames`.
5. Add the builder skill selector + browse/import panel.
6. Update specs (`05`, `01`, `08`, `10`) and the matching OpenSpec specs; add targeted tests.

Rollback: drop the skill selector and `/api/skills`; leave `skillNames` empty. With no skills resolved, `ClaudeCodeAdapter` omits `plugins`/`skills` and behaves exactly as today.

## Resolved Decisions

- **Bundled set:** the `docx` skill from `anthropics/skills` (`skills/docx`), as a builtin package that can grow to `pdf` / `xlsx` / `pptx` later.
- **docx license:** vendored into the repo (option A) with `LICENSE.txt` kept intact; confirming the Anthropic proprietary terms permit redistribution is a release-checklist item before shipping.
- **Managed directories:** bundled under `resources/agent-skills/`; imported under `<dataDir>/agent-skills/<packageId>/`. Never the developer-recipe `skills/`.
- **GitHub import:** `git clone` of the user-specified repo, then copy the skill directory into the managed location. Requires network + `git`; failures surface as clear import errors.
- **Frontmatter validation:** validate `name` + `description` on import; reject and report invalid sources without registering a partial package.
- **Host runtimes:** no proactive detection; missing `pandoc`/`python`/LibreOffice surface as normal runtime command failures, and the browse panel notes a skill's external requirements.
