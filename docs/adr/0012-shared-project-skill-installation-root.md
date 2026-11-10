---
id: ADR-0012
applies_to:
  - "src/server/catalog/**"
  - "src/server/chains/bundle.ts"
  - "tests/unit/catalog-*.test.ts"
status: Accepted
---

# ADR-0012: Use a shared project skill installation root

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-05

**Technical Story:** Make project skill copies and portable bundle imports usable by both supported harnesses without moving existing skill packages.

## Agent Rules

- **MUST:** Install new Skill Loom-managed project skill packages under `<project>/.agents/skills/` for either harness.
- **MUST NOT:** Move or automatically migrate existing project skill packages when installing or importing skills.
- **MUST:** Preserve OpenCode discovery of legacy `<project>/.opencode/skills/` packages.
- **MUST NOT:** Treat OpenCode-only directories as Copilot sources; Copilot discovery remains authoritative through its CLI.

## Verify

- **Check:** `npm test -- tests/unit/catalog-copy.test.ts tests/unit/catalog-opencode.test.ts tests/integration/chain-bundles.test.ts`
- **Expected:** New copies and imports target `.agents/skills/` for both harnesses, OpenCode still discovers its legacy root, and existing package directories remain untouched.

## Context and Problem Statement

Project packages used harness-specific paths, which made a copied skill's visibility depend on the selected harness and meant a package installed for one harness was not necessarily available to the other. How can Skill Loom provide one shared location for new project packages while preserving existing projects and the distinct discovery contracts of OpenCode and Copilot?

## Decision Drivers

- Make newly copied and imported skills available through a common project location.
- Preserve existing project packages without implicit filesystem changes.
- Keep harness discovery behavior behind the existing adapter contracts.
- Avoid bypassing Copilot's authoritative CLI catalog.

## Considered Options

- Keep separate harness-specific destinations and document their differences.
- Use `.agents/skills/` for new writes, retain OpenCode's legacy root, and leave existing packages in place.
- Use `.agents/skills/` exclusively and migrate or ignore existing harness-specific roots.

## Decision Outcome

Chosen option: "Use `.agents/skills/` for new writes, retain supported legacy discovery, and do not migrate existing packages", because it gives new packages a shared destination without silently changing existing project files or weakening harness-specific catalog authority.

### Positive Consequences

- New copies and bundle imports use the same project-local location for OpenCode and Copilot.
- Existing OpenCode `.opencode/skills/` packages remain discoverable without migration.
- Copilot availability continues to reflect the CLI's enabled/disabled catalog state.

### Negative Consequences

- Existing packages in legacy directories are not automatically moved and may remain harness-specific.
- A package in an OpenCode-only legacy location is not thereby available to Copilot.
- Project owners may need to explicitly copy or import packages into the shared location.

## Pros and Cons of the Options

### Separate harness-specific destinations

- Good, because each path aligns with an existing harness convention.
- Bad, because new packages are not naturally shared between harnesses.

### Shared destination with legacy support

- Good, because new installs are consistent while existing packages remain untouched.
- Bad, because OpenCode retains an additional project discovery root.

### Shared destination with migration

- Good, because it could eventually leave one project root.
- Bad, because automatic moves risk overwriting or changing user-owned packages and exceed an install action's scope.

## Links

- Related: [ADR-0002](0002-harness-capability-descriptors.md), which keeps harness discovery behind adapter descriptors.
- Implemented by `src/server/catalog/project-paths.ts`, `src/server/catalog/copy.ts`, and `src/server/catalog/opencode.ts`.
- Bundle installation behavior is covered by `tests/integration/chain-bundles.test.ts`.
