## ADDED Requirements

### Requirement: Claude Code agents SHALL allow enabling installed skills

The agent builder SHALL let a Claude Code agent enable skills selected from installed skill packages, showing each skill's name and description, and SHALL persist the selection through the existing agent create/update path.

#### Scenario: User enables skills for a Claude Code agent
- **WHEN** the user configures a Claude Code agent
- **THEN** the builder shows a skill selector listing skills from installed packages
- **AND** the selected skills are saved with the agent.

#### Scenario: Enabled skills are visible before save
- **WHEN** the user reviews a Claude Code agent before saving
- **THEN** the enabled skills are shown alongside the agent's other configuration.

### Requirement: The skill selector SHALL be unavailable for non-Claude adapters

The agent builder SHALL disable skill selection when the agent's adapter is not Claude Code and SHALL explain why.

#### Scenario: User configures a Custom or Codex agent
- **WHEN** the adapter is Custom or Codex
- **THEN** the skill selector is disabled
- **AND** the UI explains that skills are available only for Claude Code agents.

### Requirement: Users SHALL browse and import skill packages

The agent builder area SHALL provide a panel to browse installed skill packages (builtin and imported) with their included skills, and to import a new package from a GitHub repository or a local path.

#### Scenario: User browses installed packages
- **WHEN** the user opens the skill browse panel
- **THEN** installed packages are listed with their source and included skills.

#### Scenario: User imports a package
- **WHEN** the user imports a package from a GitHub repository or local path
- **THEN** the package is installed into the managed location and registered
- **AND** its skills become selectable for Claude Code agents
- **AND** the import surfaces the source for the user to confirm.
