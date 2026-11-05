# Run Recovery

> Load when handling pause, failure, browser reload, server restart, or run-record retention.

## Failure policy

Pause or fail the run on any of:

- Failed supervised outcome, non-zero exit, or abort.
- Missing completion signal within the configured timeout.
- Ambiguous state, such as `idle` without `working` or a lost PTY.
- A spawn failure or a session plan the adapter does not support.

Retry, Skip, and Abort are explicit user actions. Nothing auto-continues through failure and nothing auto-retries.

## Snapshot

A run freezes the full chain definition and resolved inputs at creation. Editing the saved chain later must not change the run. Retry uses the snapshot, not the live chain. Persist the snapshot inside the run document; do not store a pointer that can drift.

## Browser reload

1. Fetch `GET /api/runs/:runId`.
2. If the PTY is alive, subscribe to the terminal and run-event sockets, then render the existing step state.
3. If the PTY is gone, show the `interrupted` state and the three recovery actions.
4. Never start a step as a side effect of loading the page.

## Server restart

On startup:

1. Mark stale `starting`, `running`, `paused`, and `awaiting-user` records `interrupted`.
2. Clear the active-run pointer only when it references a now-interrupted run.
3. Do not replay a step, re-send a prompt, or reattach to a dead PTY.

The UI offers:

| Action | Behavior |
|--------|----------|
| Retry interrupted step | Restart only the step that was running, from the snapshot |
| Continue from next pending step | Leave the interrupted step as interrupted and start the next pending step |
| Restart chain | Create a new run from the snapshot; keep the old record |

Each action states what will and will not replay.

## Retention

Keep only the bounded tail per step. Do not add a transcript field, log full output, or copy credential-bearing output into evidence. `runs/` stays in the project `.loom/.gitignore`.
