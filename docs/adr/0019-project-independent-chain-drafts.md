---
id: ADR-0019
applies_to:
  - "src/server/chains/drafts.ts"
  - "src/server/routes/drafts.ts"
  - "src/server/runs/test-workspaces.ts"
  - "tests/integration/drafts-routes.test.ts"
status: Accepted; web UI superseded in part by ADR-0027 and ADR-0028
---

# ADR-0019: Store project-independent chain drafts separately

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-07

**Technical Story:** Let users author, test, and export chains from pinned remote skills and agents without first opening or modifying an existing project.

## Draft Rules

- **MUST:** Persist drafts independently from project chains. The global template library was later removed by ADR-0027 and ADR-0028.
- **MUST:** Reuse the versioned chain model and service behavior rather than introducing a separate chain format.
- **MUST:** Pin selected remote skills and agents to their verified source snapshots; never execute repository files during registration, refresh, or cataloging.
- **MUST:** Create test workspaces from a draft without modifying another project.
- **MUST NOT:** Install selected remote packages into a project merely because they were selected in a draft.
- **MUST NOT:** Describe goal entry as automatic scenario recommendation or discovery; it seeds the draft instruction. Agent-assisted discovery is a separate, explicit handoff flow and does not create or mutate a draft.

## Decision Drivers

- Avoid requiring a real project as a prerequisite for chain authoring.
- Preserve the existing chain schema, validation, bundle review, and run lifecycle.
- Keep project packages untouched until the user explicitly imports or copies them.
- Make remote identity stable across refreshes and downstream bundle export.

## Considered Options

- Store drafts in the global template library. (Retired: the library was removed by ADR-0027 and ADR-0028.)
- Store drafts inside a placeholder project.
- Store drafts in a separate config-owned directory while reusing the chain service.

## Decision Outcome

Chosen option: "Store drafts in a separate config-owned directory while reusing the chain service." Draft files live under the Loom config directory and use the existing versioned chain model. The remote catalog is available to the draft builder without installing package files into a project. A goal-based start creates a standalone instruction containing the requested outcome; users review the catalog and compose the remaining steps. It does not recommend or assemble a scenario. Agent-assisted discovery uses the separate transient handoff contract in [ADR-0021](0021-validated-project-independent-discovery-handoff.md); it does not launch an agent or create a chain.

Testing uses a retained managed workspace and the regular harness preflight and run controls. Export and shared-library publication continue to require explicit review.

### Positive Consequences

- Users can build and test without polluting or even registering an existing project.
- Drafts, templates, and project chains have distinct lifecycle and persistence boundaries.
- Existing chain validation and portable bundle code remain shared.

### Negative Consequences

- Drafts and selected source snapshots are still local data that must be included in config backups.
- Goal entry does not automatically recommend or assemble a scenario; agent-assisted discovery uses a separate transient handoff contract.
- Copying a draft into a project remains an explicit reviewed bundle import.

## Links

- Related: [ADR-0010](0010-global-chain-library-snapshots.md), [ADR-0015](0015-pinned-remote-skill-snapshots.md), [ADR-0017](0017-managed-disposable-test-workspaces.md), and [ADR-0021](0021-validated-project-independent-discovery-handoff.md).
- Regression coverage: `tests/integration/drafts-routes.test.ts` and `tests/e2e/chain-builder.spec.ts`.
