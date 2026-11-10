---
id: ADR-0007
applies_to:
  - "src/server/runs/automatic.ts"
  - "src/server/runs/osc.ts"
  - "src/server/runs/supervised.ts"
  - "src/server/harness/types.ts"
status: Accepted
---

# ADR-0007: Advance automatic steps only on explicit harness signals

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** EXEC-02 required automatic advancement without output-idle heuristics, animation quiescence, or fixed sleeps.

## Agent Rules

- **MUST:** Advance an automatic step only on the signal declared by its adapter: OpenCode's `OSC 7501` `working` then `idle` edge, or Copilot's process exit.
- **MUST:** Pause the run when the signal is missing, the process exits non-zero, or the per-step timeout expires.
- **MUST NOT:** Advance on quiet output, a timer, a page load, SSE/WebSocket reconnection, or an idle event that was not preceded by `working` in the same step.
- **MUST NOT:** Reset the per-step observation state from a previous step.

## Verify

- **Check:** `npx vitest run tests/unit/osc.test.ts tests/unit/automatic-runner.test.ts`
- **Expected:** Both suites pass, including idle-only, clear-before-idle, split-chunk, timeout, and non-zero-exit cases. Review `Osc7501StateMachine.push`; `advanced` may be true only after a `working` event in the same instance.

## Context and Problem Statement

An interactive agent CLI produces terminal animation, partial redraws, and long pauses. How can Skill Loom know a step is actually complete without racing ahead or waiting forever?

## Decision Drivers

- Output quiescence is not a completion signal; a model can pause mid-task or stream slowly.
- Both verified harnesses expose a stronger signal: OpenCode emits OSC state, Copilot exits in headless mode.
- A wrong early advance can send the next prompt while the harness is still working.
- A missing signal must pause, not silently skip or retry.

## Considered Options

- Adapter-declared explicit advancement signals with a bounded timeout and pause on failure.
- Advance after N seconds of terminal silence.
- Advance on a fixed timer or terminal animation state.

## Decision Outcome

Chosen option: "Adapter-declared explicit advancement signals with a bounded timeout and pause on failure", because it is the only option that distinguishes completion from quiet output.

OpenCode status records are scoped by `id`: the root summary has no `id`;
child records have an `id`. Prefer root `working` and require root `idle` to
complete it. Clearing a child must not erase the root observation. A root
clear still resets observation; when only an identified record is observed,
its idle and clear must match its ID. Reset all observation before each step.

The [OpenCode 2.2.6 implementation](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/tui/src/context/program-status.ts)
clears removed child records before publishing the root summary. This explains
the user-supplied [Linux x64 evidence](../evidence/live-execution-2026-11-10-opencode-2.2.6.json),
which passed the prompt, loose signal, recall and cleanup checks but failed
product advancement. The record-aware fix has regression coverage; a new live
probe of the changed parser is still required. Automatic CLI starts remain blocked.

### Positive Consequences

- Automatic runs cannot race ahead because output paused.
- Each harness can expose its own reliable signal without changing the runner.
- A stuck step becomes a visible pause with a reason, not a silent failure.

### Negative Consequences

- The runner depends on the harness signal remaining stable; a CLI format change pauses runs.
- A 30-minute step can occupy the only run slot until the timeout fires.
- Live verification found a current OpenCode format mismatch (see below), so automatic OpenCode advancement is not yet proven end-to-end.

## Pros and Cons of the Options

### Explicit signals

- Good, because it has a real completion edge and fails closed.
- Bad, because it is sensitive to harness output-format drift.

### Output-idle heuristic

- Good, because it needs no harness cooperation.
- Bad, because a slow model, a long tool call, or a redraw pause can be mistaken for completion.

### Fixed timer

- Good, because it is simple.
- Bad, because it either races ahead or wastes time and cannot adapt to the task.

## Links

- Implemented by `src/server/runs/osc.ts`, `src/server/runs/automatic.ts`, and the adapter descriptors.
- **Known live gap:** Historical OpenCode 2.2.5 evidence recorded colon-separated parameters and `clear` between `working` and `idle`. The parser accepts both parameter formats and now distinguishes child clear from root clear. The supplied 2.2.6 evidence predates the record-aware fix; automatic OpenCode advancement must not be claimed as working until the changed parser passes a new live probe.
- Related: [ADR-0002](0002-harness-capability-descriptors.md) and [release notes](../releases/0.1.0.md#known-limitations).
