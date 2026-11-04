---
id: ADR-0009
applies_to:
  - "src/server/preflight/trust.ts"
  - "src/server/preflight/trust-session.ts"
  - "src/server/harness/copilot.ts"
  - "src/server/chains/model.ts"
status: Accepted
---

# ADR-0009: Read Copilot trust and require explicit automatic permissions

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** SEC-03 and PRE-02/PRE-03 required Copilot folder-trust handling and a per-chain opt-in for broad automatic permissions.

## Agent Rules

- **MUST:** Treat Copilot's `trustedFolders` entry in `~/.copilot/config.json` as read-only evidence; never write or repair that file.
- **MUST:** Hard-block a Copilot run for an untrusted folder and require explicit acknowledgement for unreadable or invalid trust evidence.
- **MUST:** Require `automaticPermissionOptIn: true` on the chain before passing `--allow-all-paths` or `--allow-all-tools`, and show the exact flags at preflight and during the run.
- **MUST NOT:** Pass broad automatic permission flags in supervised mode or imply them from a saved chain without the opt-in.

## Verify

- **Check:** `npx vitest run tests/unit/harness-registry.test.ts tests/unit/preflight-engine.test.ts tests/integration/run-routes.test.ts`
- **Expected:** All suites pass, including trusted/untrusted/unknown trust evidence, missing opt-in, and supervised-mode flag suppression. Inspect `COPILOT_AUTOMATIC_PERMISSIONS` in `src/server/harness/copilot.ts`; it must contain exactly `--allow-all-paths` and `--allow-all-tools`.

## Context and Problem Statement

Copilot gates work behind a per-folder trust dialog and can be granted broad filesystem and tool access in headless mode. Skill Loom needs to use the harness without silently accepting trust or broadening permissions on the user's behalf.

## Decision Drivers

- A prompt queued behind a trust dialog can be swallowed, so trust must be resolved before step 1.
- Trust is Copilot's state, not Skill Loom's state; writing it would create a second source of truth.
- Automatic headless runs need broad flags, but those flags materially expand what the harness can do.
- Ambiguous trust evidence must not silently pass.

## Considered Options

- Read trust evidence only and require a per-chain opt-in for broad flags.
- Write `trustedFolders` directly when the user accepts.
- Pass broad automatic flags whenever automatic mode is selected.

## Decision Outcome

Chosen option: "Read trust evidence only and require a per-chain opt-in for broad flags", because it keeps Copilot as the owner of trust and makes permission expansion an explicit chain decision.

### Positive Consequences

- Copilot's configuration remains authoritative and is never corrupted by Skill Loom.
- Broad permissions are visible in preflight and on the run.
- Unknown trust evidence produces a deliberate acknowledgement instead of a guess.

### Negative Consequences

- Users may need to run an interactive trust session before a run.
- The opt-in is another chain field to understand and can block automatic mode.
- Reading another tool's config creates a dependency on its format.

## Pros and Cons of the Options

### Read-only trust plus explicit opt-in

- Good, because it respects the harness's security model and makes risk visible.
- Bad, because setup takes an extra step and depends on an external file format.

### Write trust directly

- Good, because Skill Loom could automate the whole flow.
- Bad, because it bypasses the harness dialog and risks corrupting Copilot's own configuration.

### Broad flags whenever automatic

- Good, because automatic runs would never be blocked by the opt-in.
- Bad, because it grants filesystem and tool access without a specific user decision.

## Links

- Implemented by `src/server/preflight/trust.ts`, `src/server/preflight/trust-session.ts`, and `src/server/harness/copilot.ts`.
- User-facing statement: [OPERATIONS.md](../OPERATIONS.md#copilot-trust-and-automatic-permissions).
- Related: [ADR-0002](0002-harness-capability-descriptors.md) and [ADR-0011](0011-shell-free-process-and-pty-transport.md).
