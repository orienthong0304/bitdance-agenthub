## ADDED Requirements

### Requirement: Skill packages SHALL be the unit of installation

A skill package is a directory of one or more skills, where each skill is defined by a `SKILL.md` with frontmatter `name` and `description`. AgentHub SHALL register each installed package with a stable id, a source (`builtin` or `imported`), a source reference, an install path, and the list of skills it includes.

#### Scenario: Bundled package is available on startup
- **WHEN** AgentHub starts and a bundled skill package exists in the managed read-only resource directory
- **THEN** the package is registered with source `builtin`
- **AND** its included skills are listed by name and description.

#### Scenario: Package includes multiple skills
- **WHEN** a package directory contains several `SKILL.md` definitions
- **THEN** each skill is listed individually under that package
- **AND** can be enabled independently per agent.

### Requirement: Users SHALL import skill packages from a GitHub repository or a local path

AgentHub SHALL allow importing a skill package from a user-specified GitHub repository or a local filesystem path into an AgentHub-managed data directory. GitHub import SHALL be performed by cloning the repository. Importing SHALL copy files only and MUST NOT execute package contents.

#### Scenario: User imports a package
- **WHEN** the user provides a GitHub repository or local path to import
- **THEN** the package files are copied into the managed data directory (GitHub sources are cloned first)
- **AND** the package is registered with source `imported` and its source reference recorded
- **AND** no package code or command is executed during import.

#### Scenario: Clone fails
- **WHEN** a GitHub import cannot clone the repository (offline, missing `git`, bad repo, or auth failure)
- **THEN** the import reports a clear error
- **AND** no partial package is registered.

#### Scenario: Imported package is invalid
- **WHEN** an imported source has no valid `SKILL.md` frontmatter
- **THEN** the package is rejected and reported to the user
- **AND** no partial package is registered as usable.

#### Scenario: Managed location is separate from developer recipes
- **WHEN** packages are installed
- **THEN** they live in the managed resource/data directories
- **AND** never reuse the repository's developer-recipe `skills/` directory.

### Requirement: Agents SHALL enable individual skills by name

An agent SHALL store the set of enabled skills in `skillNames`. An empty set means no skills are enabled, matching prior behavior.

#### Scenario: Agent enables a subset of a package
- **WHEN** an agent enables only some skills from an installed package
- **THEN** only the listed skills are turned on for that agent's runs
- **AND** unlisted skills from the same package are not advertised to the model.

#### Scenario: Skill names are package-qualified on collision
- **WHEN** two installed packages define a skill with the same name
- **THEN** enablement uses a package-qualified `plugin:skill` name
- **AND** the browse UI surfaces the collision.

### Requirement: Agent Skills SHALL be Claude Code only

Agent Skills SHALL apply only to agents using the Claude Code adapter. Codex and Custom adapters SHALL ignore skill configuration.

#### Scenario: Non-Claude agent has no skills
- **WHEN** an agent uses the Codex or Custom adapter
- **THEN** skill enablement is unavailable for that agent
- **AND** any skill fields are ignored at run time.

### Requirement: Skill enablement SHALL NOT bypass execution safety

Enabling a skill SHALL NOT grant any capability beyond AgentHub's existing tool safety. Anything a skill makes the agent execute MUST still pass the established command blacklist, command/write approval, and workspace path checks.

#### Scenario: Skill instructs a blocked command
- **WHEN** a skill leads the agent to run a command matching the safety blacklist
- **THEN** the command is blocked exactly as it would be without the skill.

#### Scenario: Skill files are readable content, not a vault
- **WHEN** a skill is not enabled for an agent
- **THEN** it is hidden from the model's skill listing and rejected by the Skill tool
- **AND** its files remain on disk and are not treated as a secret store.
