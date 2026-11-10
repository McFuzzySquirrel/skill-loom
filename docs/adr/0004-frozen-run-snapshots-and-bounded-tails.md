---
id: ADR-0004
applies_to:
  - "src/server/runs/model.ts"
  - "src/server/runs/store.ts"
  - "src/server/runs/orchestrator.ts"
  - "src/server/terminal/pty.ts"
status: Accepted
---

# ADR-0004: Freeze run snapshots and store only a bounded terminal tail

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** EXEC-08 and PRIV-01 required runs to remain reproducible after chain edits without turning stored run files into terminal transcripts.

## Agent Rules

- **MUST:** Deep-clone the saved chain and resolve inputs into the run document when the run is created; later chain edits must not alter an existing run.
- **MUST:** Cap every persisted step tail at 200 lines and 32 KiB, trimming from the oldest end.
- **MUST:** Keep the full live terminal stream in memory only; the run document stores at most the bounded tail.
- **MUST NOT:** Add a transcript field, store unbounded status text, or replay a step because a run page was opened.

## Verify

- **Check:** `npx vitest run tests/unit/run-model.test.ts tests/unit/run-store.test.ts tests/unit/pty.test.ts`
- **Expected:** All suites pass, including snapshot immutability, tail trimming at both limits, and reconnect behavior. Inspect `MAX_TAIL_LINES` and `MAX_TAIL_BYTES` in `src/server/runs/model.ts`; they must remain `200` and `32 * 1024`.

## Context and Problem Statement

A run must be explainable after the fact, but terminal output can contain source code, prompts, credentials printed by a tool, or tool output from an unrelated session. How much run history should be frozen and persisted?

## Decision Drivers

- Editing a chain after starting a run must not change what the run executes.
- Run records should be small, reviewable, and safe to back up or delete.
- Reconnect and recovery need recent output, not a complete transcript.
- Stored terminal output is sensitive local data.

## Considered Options

- Freeze the chain and persist a bounded tail.
- Store a live reference to the chain and the full terminal transcript.
- Store no output at all and rely on the live terminal.

## Decision Outcome

Chosen option: "Freeze the chain and persist a bounded tail", because it preserves reproducibility and useful recovery context while bounding data retention.

### Positive Consequences

- Retry and restart use the exact chain definition and resolved inputs from creation time.
- Run files stay small and have a predictable privacy profile.
- Reconnect and recovery can show the most recent output without a transcript archive.

### Negative Consequences

- Users cannot retrieve complete historical terminal output from Skill Loom.
- The 200-line/32 KiB cap can omit the evidence needed to diagnose a long failure.
- Snapshotting duplicates chain data in every run.

## Pros and Cons of the Options

### Frozen snapshot plus bounded tail

- Good, because it balances reproducibility, recovery, and data minimization.
- Bad, because it deliberately discards most historical output.

### Live chain reference plus full transcript

- Good, because a run record could reproduce everything.
- Bad, because edits change history and stored transcripts create a large sensitive archive.

### No stored output

- Good, because it minimizes stored data.
- Bad, because a reconnect or restart loses all diagnostic context.

## Links

- Implemented by `createRunRecord`, `trimTail`, and `markRunInterrupted` in `src/server/runs/model.ts`.
- Transport cap: `TerminalOutputBuffer` in `src/server/terminal/pty.ts`.
- User-facing statement: [OPERATIONS.md](../OPERATIONS.md#data-locations).
