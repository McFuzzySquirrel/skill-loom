---
name: pty-run-lifecycle
description: "Slan PTY and run lifecycle procedure covering shell-free spawning, one-subscriber terminals, bounded tails, OpenCode OSC working-to-idle advancement, Copilot exit advancement, explicit pause and retry, and orphan-free cleanup."
---

# Skill: PTY Run Lifecycle

Use when implementing or changing the terminal transport, supervised runner, automatic runner, run orchestrator, or interruption recovery. The failure mode this skill prevents is a chain that advances on guessed idle time, hangs on a lost signal, or leaves an orphan harness process attached to a finished run.

Load `references/pty-transport.md` when implementing spawn, input, resize, subscriber, or cleanup behavior.
Load `references/advancement-and-state.md` when implementing OpenCode OSC parsing, Copilot exit handling, step transitions, or timeouts.
Load `references/run-recovery.md` when handling pause, failure, reload, server restart, or snapshot retention.

---

## Process

### Step 1: Open exactly one terminal session

Create a session with `node-pty` using an executable plus argument array, the canonical project `cwd`, a minimal environment, and explicit `cols`/`rows`:

```ts
const pty = spawn(spec.executable, spec.args, {
  name: "xterm-256color",
  cwd: spec.cwd,
  cols: 120,
  rows: 32,
  env: { ...process.env, TERM: "xterm-256color" },
});
```

If a session already has a subscriber, then reject the second with a typed conflict and do not disturb the first. Supervised steps restart the CLI in the same PTY transport but never reuse a running TUI across steps.

**Output:** a `TerminalSession` with `write`, `resize`, `onData`, `onExit`, and `kill`.

### Step 2: Stream output and keep only a bounded tail

Forward raw bytes to the single WebSocket subscriber and append them to a per-step tail buffer. Enforce both limits at write time: at most 200 lines and 32 KiB. Trim from the oldest end and never persist a full transcript.

```ts
tail = trimTail(tail + chunk, { maxLines: 200, maxBytes: 32 * 1024 });
```

If the client disconnects, then keep the run alive only while the runner owns it; reattach on reconnect from the run snapshot plus new deltas. If the subscriber is gone and the run is aborted, then terminate the child instead of buffering indefinitely.

**Output:** live bytes to the subscriber plus a capped tail persisted with the step record.

### Step 3: Start a step from its planned spawn spec

Assemble the prompt from the frozen chain snapshot and resolved inputs before spawning. Name the skill explicitly and include the instruction text. Fail before process start when a required input is missing or a `{{placeholder}}` is unresolved.

For every step, reset the advancement state machine, record the session id and fork mechanism, set `status: "running"`, and record `startedAt`. If the session plan is `shared`, then pass the existing session id; if `fresh`, create one; if `fork`, use native fork only when the descriptor reports it, otherwise seed the deterministic handoff note.

**Output:** a running process plus a step record with session id and start time.

### Step 4: Advance only on the descriptor's signal

Use the descriptor's `automaticAdvancement` value; never branch on the harness name in the runner.

| Mode | Advance when | Do not advance when |
|------|--------------|---------------------|
| Supervised | User marks Done or Skipped and presses Next | The process exits, the terminal is quiet, or output stops |
| OpenCode automatic | `OSC 7501;state=idle` after `state=working` in the same step | `idle` arrives without `working`, or output merely goes quiet |
| Copilot automatic | Process exits with code 0 | The TUI animation pauses or output quiesces |

If the expected signal does not arrive within the configured timeout (default 30 minutes per automatic step), then pause with a failure instead of skipping. If a retry is requested, then restart the same step with the same snapshot plan; never auto-retry.

Load `references/advancement-and-state.md` for the OSC state machine and the full transition matrix.

**Output:** `done`, `failed`, `skipped`, or `paused` with a recorded reason.

### Step 5: Pause, fail, and resume explicitly

On a non-zero exit, missing signal, ambiguous state, or user pause, set the run to `paused` or `failed` and stop advancement. Offer Retry, Skip, and Abort. A pause after a completed signal does not start the next step until Run next is invoked.

Marking a supervised step Failed does not enable Next; Done or Skipped does. Record the skip reason and do not run the skipped step. Abort terminates the current process and leaves completed steps intact.

**Output:** a paused or failed run with explicit recovery actions and no auto-continue path.

### Step 6: Clean up on every exit path

Kill the child and dispose the PTY on socket close, stream error, step completion, run completion, abort, and server `SIGINT`/`SIGTERM`. Guard against double-kill and tolerate an already-exited process. Close WebSocket subscriptions and clear timers before marking the run final.

```ts
try { pty.kill(); } catch {}
```

If the process ignores the normal kill, then escalate after a bounded wait; do not leave the handle open. Load `references/pty-transport.md` for the full cleanup matrix and the one-subscriber test.

**Output:** no orphan harness process and no open terminal handle after the run ends.

### Step 7: Recover without replaying

On server startup, mark stale `starting`, `running`, `paused`, and `awaiting-user` records `interrupted` and clear the active pointer. On browser reload, send a full run snapshot first, then deltas; reattach to a live PTY only if it is still alive. When it is not, show Retry interrupted step, Continue from next pending step, and Restart chain with a statement of what will not replay. Never start a step automatically after reload.

**Output:** a reconnected live view or an `interrupted` record with explicit recovery actions.

### Step 8: Verify the lifecycle

```bash
npx vitest run tests/unit/pty.test.ts tests/integration/terminal-ws.test.ts tests/unit/osc.test.ts tests/unit/supervised-runner.test.ts tests/unit/automatic-runner.test.ts tests/integration/run-routes.test.ts
```

Use a fake PTY that emits `OSC 7501;state=working` then `state=idle`, one that emits `idle` only, one that holds for supervised confirmation, and one that exits non-zero. Treat this suite as the self-check for the lifecycle before starting a real harness.

---

## Gotchas

- **`node-pty` children survive a dropped socket.** Closing the WebSocket does not kill the child. Kill on close, error, completion, abort, and process signals, and test that no process remains.
- **OSC sequences split across chunks.** `OSC 7501;state=idle` can arrive in two writes or be surrounded by unrelated ANSI. Buffer across chunks and parse complete sequences; do not regex a single chunk.
- **Idle without working.** An `idle` state with no prior `working` in the same step must not advance. A `clear` state resets the observation and requires a fresh `working`.
- **Quiet terminal is not completion.** Copilot's TUI animation and OpenCode's approval prompt both look idle. Use the documented signal or process exit, with a bounded timeout that pauses.
- **Second subscriber.** A reconnect must not attach a second consumer to the same PTY. Reject it and keep the first active, or explicitly hand off ownership.
- **Unbounded tail.** A run record is not a transcript. Cap at 200 lines or 32 KiB before storing; stripping ANSI later does not undo the privacy exposure.
- **Kill races.** A process can exit between the abort request and the kill call. Guard with an `exited` flag and tolerate `ESRCH` instead of throwing out of cleanup.
- **Reload auto-start.** Fetching a run record must never start a step. Every post-reload transition requires an explicit user action.

---

## Validation

After completing the process, verify:

- [ ] A second terminal subscriber is rejected without disturbing the active one.
- [ ] Closing the socket, aborting the run, and sending `SIGTERM` each leave no live child process.
- [ ] A split `OSC 7501` sequence advances OpenCode only after `working` then `idle`; an `idle`-only stream does not advance.
- [ ] A supervised step ignores process exit and advances only after Done or Skipped plus Next.
- [ ] A Copilot non-zero exit pauses with Retry, Skip, and Abort and does not auto-retry.
- [ ] The persisted tail is at most 200 lines and 32 KiB per step, and no field holds a full transcript.
- [ ] Reloading an `interrupted` run offers retry, continue, and restart without replaying a step.
- [ ] `npx vitest run tests/unit/pty.test.ts tests/integration/terminal-ws.test.ts tests/unit/osc.test.ts tests/unit/supervised-runner.test.ts tests/unit/automatic-runner.test.ts tests/integration/run-routes.test.ts` passes.

If the OSC test fails on a split chunk, fix the incremental parser, not the test. If cleanup leaves a process, check every early-return path for a missing `finally`.
