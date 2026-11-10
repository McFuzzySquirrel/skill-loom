# Advancement and State

> Load when implementing the OSC parser, step transitions, timeouts, or supervised and automatic runners.

## OpenCode OSC 7501

The sequence is `OSC 7501;state=working|idle|clear` with an optional `id=ses_...`. It may be split across chunks and mixed with unrelated ANSI.

Use `Osc7501StateMachine` from `src/server/runs/osc.ts`, not a separate regex
implementation. Prefer the root summary (no `id`) over child records. Child
clear removes that record, not the root's working observation. Root clear
resets observation; an identified-only record requires a matching idle and
clear. Advance only on a returned change with `advanced: true`, after working
for the same record in the same step. Reset before each step. A later root
clear can reset `completed` even though an earlier change already advanced.

## Transition matrix

| State | Event | Next |
|-------|-------|------|
| `pending` | Step started | `running` |
| `running` | Supervised Done or Skipped + Next | next step `pending` or run `completed` |
| `running` | Supervised Failed | step `failed`, run `failed` |
| `running` | OpenCode working then idle | step `done`, start next or complete |
| `running` | Copilot exit 0 | step `done`, start next or complete |
| `running` | Copilot exit non-zero | step `failed`, run `failed` |
| `running` | Timeout or ambiguous | step `failed` or `paused`, run `paused` |
| `running` | Abort | run `aborted`, process killed; completed steps keep their status |
| any active | Server restart | `interrupted` |

A paused automatic run resumes only on Pause/Resume or Run next. It never starts the next step on its own.

## Timeouts

Default 30 minutes per automatic step, configurable per chain. On timeout, pause the run with a failure reason; do not mark the step skipped and do not auto-retry. Supervised steps wait for the user and do not use the automatic timeout.

## Observation

- Copilot `skill(name)` line: `observed` with the name.
- OpenCode interactive: `not-observable`.
- No matching evidence: `unknown`.
- The indicator never blocks, fails, or advances a step.
