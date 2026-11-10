---
id: ADR-0025
applies_to:
  - "src/server/cli.ts"
  - "src/server/control.ts"
  - "src/server/runs/reviewed-start.ts"
  - "src/server/bundles/reviewed-import.ts"
status: Accepted
---

# ADR-0025: Require reviewed digests and explicit confirmations for CLI mutations

## Context

CLI callers, including agents, can reach the same application services as the
UI without a human looking at a dialog. Bundle import, run start, run actions,
workspace removal, and coordination changes have consequences that a caller
must approve against specific evidence, not in general.

## Decision

Consequential CLI mutations use a two-step contract. A `review` command
returns the evidence (chain, destination identity, preflight report, conflicts,
or run state) and a `reviewDigest`. The mutating command repeats the same
request with that digest and `confirmed: true`. The owner rechecks the digest
against fresh state and rejects a changed bundle, destination, preflight, or
run. Distinct risks need distinct confirmations: `executionConfirmed`,
`replayConfirmed`, `liveTestConfirmed`, `automaticConfirmed`, and
`broadPermissionsConfirmed`, plus `differingReuseConfirmed` for changed
installed packages. Structured input is read from stdin; arbitrary values are
kept out of arguments. Failures are JSON on stderr with a nonzero exit.
Unsupported combinations (skill-bearing starts, native-agent starts, OpenCode
automatic starts) fail closed instead of being approximated.

## Consequences

- A digest and confirmation record the caller's intent; they do not prove a
  human reviewed the evidence, provide a sandbox, or lock external edits.
- Callers must re-review after any rejection; they must not reuse a stale
  digest or add confirmations to bypass a guard.
- Each new mutating command must define its review evidence and confirmations
  before it is exposed.

## Verify

- **Check:** `npx vitest run tests/unit/cli.test.ts tests/integration/control.test.ts`
- **Expected:** Missing confirmations, stale digests, and blocked capabilities are rejected.
