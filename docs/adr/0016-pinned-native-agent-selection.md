---
id: ADR-0016
applies_to:
  - "src/server/catalog/remote.ts"
  - "src/server/catalog/agent-copy.ts"
  - "src/server/harness/"
  - "src/server/preflight/engine.ts"
  - "src/server/runs/"
  - "src/shared/chain.ts"
  - "tests/unit/agent-copy.test.ts"
  - "tests/unit/harness-registry.test.ts"
status: Accepted
---

# ADR-0016: Select source-pinned native agents through harness capabilities

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-07

**Technical Story:** Let a chain optionally use one agent definition from a reviewed remote snapshot without translating it between harnesses or silently changing the selected agent.

## Agent Rules

- **MUST:** Bind a selected agent to its harness, remote source id, resolved revision, repository-relative path, native agent path, and content fingerprint.
- **MUST:** Keep agent selection separate from ordered skill and instruction steps.
- **MUST:** Install remote agent definitions only into their documented native project locations and never overwrite an existing file.
- **MUST:** Verify the installed file's safety and fingerprint during preflight before running a chain that selects it.
- **MUST:** Build agent-selection arguments only in the harness adapter and block command surfaces without the capability.
- **MUST NOT:** Translate an agent to another harness, modify global harness configuration, or silently omit a selected agent.
- **MUST NOT:** Claim a copied agent definition or a disposable working directory is a security sandbox.

## Verify

- **Check:** `npx vitest run tests/unit/agent-copy.test.ts tests/unit/harness-registry.test.ts tests/unit/preflight-engine.test.ts`
- **Expected:** Agent installation is no-overwrite and path-safe, fingerprints are enforced, supported command surfaces pass the exact selected name, and unsupported or unavailable choices block before spawn.
- **Check:** `npm run typecheck`
- **Expected:** Agent identity flows through chain persistence and run snapshots without weakening strict chain validation.

## Context and Problem Statement

Remote repositories may contain OpenCode or Copilot agent definitions as well as skills. An agent is a harness-native configuration and prompt, not a skill package or a standalone chain instruction. Selecting it by display name alone would make duplicates and later refreshes silently change behavior; copying a definition into global harness settings would also widen its scope beyond the selected project.

## Decision Drivers

- Preserve exact provenance and artifact identity across chain saves and runs.
- Keep harness-specific agent behavior behind the existing adapter contract.
- Make installation explicit, project-scoped, conflict-safe, and preflight-verifiable.
- Preserve agent-free legacy chains and the existing shared `.agents/skills/` install root.

## Considered Options

- Convert agent files into chain instruction steps.
- Configure a global default agent in each user's harness settings.
- Store one optional pinned selection on a chain and pass it through a supported adapter surface.

## Decision Outcome

Chosen option: "Store one optional pinned selection on a chain and pass it through a supported adapter surface." This preserves the source artifact and harness semantics while keeping instruction steps and skill resolution unchanged.

Remote definitions are copied into `.opencode/agents/` or `.github/agents/` as appropriate. The adapter decides whether the current run surface supports explicit agent selection; preflight verifies the copied bytes against the saved fingerprint. OpenCode's interactive surface does not expose a supported selector, so such a chain is blocked for supervised OpenCode runs. Agent-free chains continue using their existing argument arrays.

### Positive Consequences

- A refresh cannot silently replace the definition referenced by a saved chain.
- Project-specific agent copies do not modify user-level harness settings.
- A selected definition that is absent, modified, or incompatible is an actionable preflight block.

### Negative Consequences

- Users must resolve project file conflicts manually rather than overwrite existing native agents.
- A selected agent may be usable only in some run modes, depending on harness support.
- Agent definitions can refer to tools, models, or files outside the retained snapshot; those external requirements remain the user's responsibility.

## Links

- Related: [ADR-0002](0002-harness-capability-descriptors.md), [ADR-0013](0013-deterministic-chain-bundle-skill-resolution.md), and [ADR-0015](0015-pinned-remote-skill-snapshots.md).
- Implemented by `src/server/catalog/remote.ts`, `src/server/catalog/agent-copy.ts`, the harness adapters, and chain model.
- Regression coverage: `tests/unit/agent-copy.test.ts`, `tests/unit/harness-registry.test.ts`, and `tests/unit/preflight-engine.test.ts`.
