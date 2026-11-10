---
id: ADR-0024
applies_to:
  - "src/server/control.ts"
  - "src/server/index.ts"
  - "src/server/runs/owner.ts"
  - "src/server/windows-control.ts"
  - "src/server/windows-control.ps1"
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

The Windows security helper prefers stable PowerShell 7 in the standard
Program Files location and falls back to the OS-provided 5.1 host only when
that installation is absent. `LOOM_WINDOWS_POWERSHELL=7|5.1|auto` supports
explicit selection. Do not resolve a helper host through `PATH` or retry
another host after helper execution or security checks fail. Modern .NET ACL
extensions and legacy Framework ACL APIs must enforce the same private
creation, requested/canonical ancestor and open-handle checks. This does not
add a PowerShell dependency to Unix systems or make Windows APIs portable.

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
- **Host selection:** `npx vitest run tests/unit/windows-powershell.test.ts`.
- **Native Windows:** `npx vitest run tests/integration/windows-control.test.ts`
  targets PowerShell 7 and 5.1, including unsafe ACLs and SUBST aliases. Both
  must pass on Windows; non-Windows skipped cases are not verification.
