---
id: ADR-0027
applies_to:
  - "src/server/cli.ts"
  - "src/server/control-cli.ts"
  - ".github/skills/loom-chain-workflow/SKILL.md"
  - ".github/skills/scenario-discovery/SKILL.md"
status: Accepted
---

# ADR-0027: Drive Skill Loom from the CLI and companion skills

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-10

**Technical Story:** Most web screens duplicated what the CLI (ADR-0023 to ADR-0026) and companion skills already do, and made the product a second interface to maintain.

## Decision Rules

- **MUST:** Offer every project, catalog, discovery, library, workspace, import, and run capability through the CLI, with versioned JSON envelopes and reviewed confirmations.
- **MUST:** Have the `loom-chain-workflow` and `scenario-discovery` skills check `skill-loom --version` first and, when it is missing, ask for approval before installing it.
- **MUST NOT:** Add general-purpose web screens. The only web surface is the chain editor in [ADR-0028](0028-single-purpose-chain-editor.md).
- **MUST NOT:** Weaken a reviewed-approval guard because a screen no longer presents it.

## Considered Options

- Keep the full web application beside the CLI.
- Remove the web application entirely.
- Keep only a visual chain editor and drive everything else from the CLI and skills.

## Decision Outcome

Chosen option: "Keep only a visual chain editor." The server API and control transport remain and are used by the CLI and the editor; the screens that called them are removed. Skills install the CLI from a repository clone with `npm pack` because the package is private.

### Consequences

- One interface to document, test, and secure; agents can drive the whole workflow.
- Users lose point-and-click library, catalog, and run screens, and there is no browser terminal. Managed runs use `run attach`.
- Chain creation, harness choice, and adding skill steps now happen through the CLI or skills.

## Links

- Supersedes the web-screen decisions in [ADR-0010](0010-global-chain-library-snapshots.md), [ADR-0017](0017-managed-disposable-test-workspaces.md), [ADR-0019](0019-project-independent-chain-drafts.md), [ADR-0020](0020-local-shared-bundle-library.md), [ADR-0021](0021-validated-project-independent-discovery-handoff.md), and [ADR-0022](0022-managed-interactive-scenario-discovery.md). Their server, storage, and safety decisions remain in force.
- Related: [ADR-0014](0014-portable-agent-skill-execution.md), [ADR-0025](0025-reviewed-cli-approval-contract.md).
