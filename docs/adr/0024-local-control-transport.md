---
id: ADR-0024
applies_to:
  - "src/server/control.ts"
  - "src/server/index.ts"
  - "src/server/runs/owner.ts"
status: Accepted
---

# ADR-0024: Authenticate local control of the profile owner

## Context

Short-lived CLI processes cannot safely own managed runs or use process-local
write queues independently. A control transport must share the production
server's profile lock, configuration store, and run owner without exposing a
new unauthenticated network listener.

## Decision

On Unix-like systems the production owner publishes a Unix socket in an
owner-only temporary directory and a mode-0600 `control.json` in the protected
profile. Each instance has a random bearer capability; requests are bounded
JSON, authenticate before dispatch, and negotiate protocol and application
versions. Mutations call the same application services as HTTP routes. The endpoint
is started only after profile ownership is acquired. A stale endpoint is
removed only after ownership, permissions, and inability to connect are checked.

Normal control shutdown blocks new run mutations, refuses an active run or an
in-flight run mutation, replies before shutdown, drains accepted control
operations, and releases the profile lock only after application cleanup.
Signal and existing UI shutdown retain their established behavior.
If cleanup fails, the process retains ownership rather than allowing a second
owner to start while resources may still be live; restart the process after
investigating the reported error.

## Consequences

- The bearer capability must not be shared or included in backups. It provides
  no boundary between processes running under the same operating-system user.
- The browser's loopback HTTP interface remains unauthenticated.
- Windows uses mutually authenticated loopback TLS on a protected private
  profile on local NTFS/ReFS storage; unsafe existing profiles are rejected
  rather than reconfigured (see the administrator guide).
- Control covers service and catalog settings, project registration, draft
  creation and editing, bundle export and reviewed import, preflight,
  test-workspace lifecycle and evaluation, run status, event streams, terminal
  attachment, and restricted reviewed starts and actions
  ([ADR-0025](0025-reviewed-cli-approval-contract.md)).
  Skill-bearing CLI starts and OSC-based automatic execution remain blocked.
- The profile ownership lock and this transport alone do not coordinate the
  portable runner. A separate opt-in project claim protocol now coordinates
  participating managed and portable runners; older clients remain outside it.

## Verify

- **Check:** `npx vitest run tests/integration/control.test.ts tests/unit/run-owner.test.ts`
- **Expected:** Authentication, stale-endpoint recovery, CLI/UI interoperability,
  active-run stop refusal, and run mutation barriers are verified.
