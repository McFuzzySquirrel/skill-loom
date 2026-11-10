---
id: ADR-0018
applies_to:
  - "src/shared/bundles.ts"
  - "src/portable/bundle.ts"
  - "src/portable/runtime.ts"
  - "src/server/chains/bundle.ts"
  - ".github/skills/loom-run-bundle/"
  - "tests/unit/portable-runtime.test.ts"
status: Accepted
---

# ADR-0018: Version portable bundles for native-agent assets

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-07

**Technical Story:** Share an exact selected native agent with a chain without silently losing its identity or definition in existing portable bundle readers.

## Bundle Rules

- **MUST:** Keep version 1 bundles readable and keep version 1 export for chains that do not select a native agent.
- **MUST:** Use version 2 when a chain selects a native agent and include its exact definition, native harness/path, pinned identity, and content fingerprint.
- **MUST:** Validate the selected agent against bundled bytes and enforce the existing combined file and content budgets.
- **MUST:** Show native agent content and installation conflicts during review; never overwrite an existing agent definition.
- **MUST:** Roll back newly installed agent files if chain persistence fails.
- **MUST NOT:** Include repository URLs or local filesystem paths in portable bundles.
- **MUST NOT:** Claim that a portable current-conversation runner can switch to a selected native agent; direct such runs to Skill Loom.

## Verify

- **Check:** `npx vitest run tests/integration/chain-bundles.test.ts tests/unit/portable-runtime.test.ts`
- **Expected:** Version 1 remains compatible; version 2 round-trips the exact agent; mismatched fingerprints, unsafe paths, conflicts, and unsupported portable execution fail visibly.
- **Check:** `npm run build:portable-skill`
- **Expected:** The standalone helper supports v2 inspection without introducing a Loom server, PTY, or second harness dependency.

## Context and Problem Statement

Version 1 bundles contain chain instructions and skill package files but have no place to carry a native agent selection. Dropping that selection would make a shared chain run under different semantics; rejecting all selected-agent exports would prevent safe offline review and Loom-to-Loom transfer.

## Decision Drivers

- Preserve strict backward compatibility for agent-free v1 bundles.
- Preserve the exact harness-native definition selected by a v2 chain.
- Keep review, path validation, fingerprints, no-overwrite behavior, and budgets active across export/import.
- Respect the standalone runner's inability to replace the current conversation's active agent.

## Considered Options

- Silently remove the selected agent during export.
- Continue blocking all selected-agent exports.
- Introduce v2 for selected agents while retaining v1 for eligible chains.

## Decision Outcome

Chosen option: "Introduce v2 for selected agents while retaining v1 for eligible chains." The v2 portable document adds a native agent asset matched to the chain's pinned selection. Import requires review and copies the definition only to its harness-specific project location, refusing conflicts and cleaning up only files created by the import if chain persistence fails.

The portable helper can inspect v2 packages and show the agent definition, but it blocks preparation when the chain selects an agent. The helper is an ordinary current-host workflow and cannot change the active harness agent. Skill Loom remains the supported execution path for those chains.

### Positive Consequences

- Agent-free chains keep their existing v1 representation and consumers.
- Selected-agent exports are reviewable and preserve exact bytes and identity.
- Unsupported portable execution is an explicit error rather than a silent agent drop.

### Negative Consequences

- Older readers reject v2 bundles and need an upgrade to import them.
- Standalone helper users must import selected-agent bundles into Skill Loom for execution.
- Native agent files can refer to external tools or models not included in the bundle.

## Links

- Related: [ADR-0014](0014-portable-agent-skill-execution.md), [ADR-0016](0016-pinned-native-agent-selection.md), and [ADR-0017](0017-managed-disposable-test-workspaces.md).
- Implemented by the portable bundle schema, server bundle import/export, and standalone helper.
- Regression coverage: `tests/integration/chain-bundles.test.ts` and `tests/unit/portable-runtime.test.ts`.
