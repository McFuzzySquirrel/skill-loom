---
id: ADR-0023
applies_to:
  - "src/server/index.ts"
  - "src/server/profile-owner.ts"
status: Accepted
---

# ADR-0023: Acquire profile ownership before server recovery

- **Decider:** McFuzzySquirrel
- **Date:** 2026-11-08

## Context

Config and run-store write queues are process-local. Two server processes using
the same profile could otherwise race configuration updates or mark each
other's live runs interrupted during startup recovery. The planned CLI service
will also need a single owner for managed processes and mutable profile state.

## Decision

The production server acquires an exclusive SQLite transaction on
`profile-owner.sqlite` in the canonical config directory before building the
application or performing recovery. A second owner fails with
`PROFILE_IN_USE`. The owner retains the transaction until the application has
closed; SQLite and the operating system release the lock if its process exits.
The database contains no application state.

The lock file is persistent and must not be deleted or replaced while a server
is running. A profile filesystem must support SQLite locking. SQLite locking
does not protect a process that bypasses this ownership protocol, including an
older Skill Loom version or the independent portable in-session runner.
Authenticated local CLI control is described in ADR-0024. Coordination with
portable runs remains separate implementation work.

## Consequences

- Startup does not use a stale PID or remove a potentially live lock.
- Starting the production server creates the profile directory and lock file
  even when no configuration has been saved yet.
- This requires Node's built-in `node:sqlite` and suitable filesystem locking.
- A graceful shutdown releases ownership only after application cleanup.

## Verify

- **Check:** `npx vitest run tests/unit/profile-owner.test.ts tests/integration/server-routes.test.ts`
- **Expected:** Concurrent owners conflict, a killed process releases ownership,
  unsafe lock paths are rejected, and an existing server remains responsive.
