---
id: ADR-0002
applies_to:
  - "src/server/harness/**"
  - "src/server/runs/**"
  - "src/server/preflight/**"
  - "src/server/catalog/**"
status: Accepted
---

# ADR-0002: Put harness differences behind capability descriptors

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** NFR-COMPAT-01 and the PRE/RUN task series required two harnesses without scattering conditional branches through routes, preflight, and orchestration.

## Agent Rules

- **MUST:** Keep executable resolution, command arguments, discovery strategy, trust behavior, session/fork support, advancement signal, and permission flags in `src/server/harness/`.
- **MUST:** Consume adapters as data in routes, preflight, catalog, and run code; never compare a harness id to decide behavior.
- **MUST NOT:** Add a new harness by editing run orchestration, preflight rules, or route handlers with a harness-specific branch.
- **SHOULD:** Extend the descriptor contract when a new capability differs, rather than adding a parallel harness interface.

## Verify

- **Check:** `npx vitest run tests/unit/harness-registry.test.ts tests/unit/preflight-engine.test.ts tests/unit/automatic-runner.test.ts`
- **Expected:** All suites pass. Also run `grep -RInE "=== ['\"](opencode|copilot)['\"]|!== ['\"](opencode|copilot)['\"]" src/server/routes src/server/runs src/server/preflight` and expect no output.

## Context and Problem Statement

OpenCode and GitHub Copilot differ in executable names, skill discovery, authentication evidence, folder trust, fork support, permission flags, and the signal that marks a step complete. Where should those differences live so that adding or changing a harness does not fork the application?

## Decision Drivers

- Two harnesses already differ on nearly every capability boundary.
- Routes should validate and map errors, not encode CLI knowledge.
- Preflight and run orchestration need deterministic, testable behavior with injected command and process seams.
- A harness update should be reviewable in one module.

## Considered Options

- A capability descriptor plus adapter object per harness, consumed as data.
- Central `if (harness === 'opencode')` branches in each feature.
- A generic plugin runtime loaded from third-party code.

## Decision Outcome

Chosen option: "A capability descriptor plus adapter object per harness", because it makes harness behavior explicit, testable, and replaceable while keeping the rest of the server harness-agnostic.

### Positive Consequences

- Command construction, discovery, trust, advancement, and permission flags have one owner per harness.
- Preflight and runner tests can substitute deterministic adapters.
- Adding a harness is a bounded change behind a typed contract.

### Negative Consequences

- The descriptor must grow when harnesses expose genuinely new capabilities.
- Adapter changes can affect several features at once, so integration tests remain necessary.
- The contract does not by itself prove a live CLI behaves as described; live probes are still required.

## Pros and Cons of the Options

### Capability descriptors and adapters

- Good, because behavior is data-driven and every harness-specific fact is visible in one place.
- Bad, because the descriptor is an abstraction that must stay honest as CLIs change.

### Inline harness branches

- Good, because it is quick to add the first special case.
- Bad, because every feature accumulates the same branch and tests multiply across features.

### Third-party plugin runtime

- Good, because it could support arbitrary harnesses without core changes.
- Bad, because it expands the trust and supply-chain surface far beyond the two verified CLIs.

## Links

- Implemented by `src/server/harness/types.ts`, `src/server/harness/opencode.ts`, `src/server/harness/copilot.ts`, and `src/server/harness/registry.ts`.
- Used by `src/server/preflight/engine.ts`, `src/server/runs/prompts.ts`, `src/server/runs/supervised.ts`, and `src/server/runs/automatic.ts`.
- Related: [ADR-0007](0007-explicit-advancement-signals.md), [ADR-0008](0008-session-modes-with-deterministic-handoff.md), and [ADR-0009](0009-read-only-copilot-trust-and-explicit-permissions.md).
