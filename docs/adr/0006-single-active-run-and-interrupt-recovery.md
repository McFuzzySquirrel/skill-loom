---
id: ADR-0006
applies_to:
  - "src/server/runs/store.ts"
  - "src/server/runs/orchestrator.ts"
  - "src/server/routes/runs.ts"
status: Accepted
---

# ADR-0006: Allow one active run and recover stale records as interrupted

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** EXEC-03 and NFR-REL-01 required one global run slot and honest recovery after a server restart.

## Agent Rules

- **MUST:** Enforce one active run across all projects through `active-run.json` and reject a second start while a run is starting, running, paused, or awaiting user input.
- **MUST:** On startup, mark the active record named by this profile's pointer as `interrupted`, clear the stale pointer, and require the user to choose retry, continue, or restart, unless project coordination requires explicit review. Leave claimed records and other active records unchanged and report their ambiguous ownership.
- **MUST NOT:** Resume, advance, or replay a step automatically because the server restarted or the run page loaded.
- **MUST NOT:** Treat `failed`, `completed`, `aborted`, or `interrupted` as blocking a new run.

## Verify

- **Check:** `npx vitest run tests/unit/run-store.test.ts tests/integration/run-routes.test.ts`
- **Expected:** Both suites pass, including active-conflict, startup recovery, and recovery-action cases. Check `ACTIVE_RUN_STATUSES` in `src/server/runs/model.ts`; it must contain only `starting`, `running`, `paused`, and `awaiting-user`.

## Context and Problem Statement

Each run owns a PTY, a child process, and a persisted status. If two runs overlapped, they could compete for the same project files, and a crash could leave a record claiming to be running forever. How should concurrent starts and restart recovery behave?

## Decision Drivers

- Harness processes act on the same project working tree and expect user attention.
- A single-user UI cannot meaningfully supervise two interactive terminals at once.
- A stale "running" record must not block every future start.
- Recovery must not guess that an interrupted step finished.

## Considered Options

- One global active run plus explicit interrupted recovery.
- Allow one active run per project.
- Allow unlimited concurrent runs and reconcile only on read.

## Decision Outcome

Chosen option: "One global active run plus explicit interrupted recovery", because it matches the single-user, terminal-dominant workflow and makes crash outcomes explicit.

### Positive Consequences

- Two harnesses cannot race over one project by accident.
- A restart produces a clear recovery choice instead of a silent replay.
- The health endpoint and UI can report one unambiguous active run.

### Negative Consequences

- A user cannot run two independent chains at once, even in different projects.
- A stale pointer or interrupted record needs user action before work continues.
- Recovery actions add state-machine complexity to the orchestrator.

## Pros and Cons of the Options

### One global active run

- Good, because it matches the human attention model and protects project files.
- Bad, because it limits throughput for users who want parallel work.

### One active run per project

- Good, because independent projects could run together.
- Bad, because the UI, pointer, and health model would still need per-project coordination and the terminal view remains single-focus.

### Unlimited concurrent runs

- Good, because it maximizes throughput.
- Bad, because competing processes, PTYs, and recovery records are hard to reason about and unsafe for a shared working tree.

## Links

- Implemented by `active-run.json` handling and `recoverInterruptedRuns` in `src/server/runs/store.ts`, plus `recoverOnStartup` in `src/server/runs/orchestrator.ts`.
- User-facing recovery guidance: [OPERATIONS.md](../OPERATIONS.md#troubleshooting) and [../user-guide.md](../user-guide.md#recover-an-interrupted-run).
