# Advancement and State

> Load when implementing the OSC parser, step transitions, timeouts, or supervised and automatic runners.

## OpenCode OSC 7501

The sequence is `OSC 7501;state=working|idle|clear` with an optional `id=ses_...`. It may be split across chunks and mixed with unrelated ANSI.

```ts
type Phase = "unknown" | "working" | "idle" | "clear";

class OscState {
  private buffer = "";
  private sawWorking = false;
  private phase: Phase = "unknown";

  push(chunk: string): Phase {
    this.buffer += chunk;
    const re = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null;
    let changed: Phase = this.phase;
    while ((match = re.exec(this.buffer))) {
      const state = /state=([a-z]+)/.exec(match[1])?.[1];
      if (state === "working") { this.sawWorking = true; changed = "working"; }
      else if (state === "idle" && this.sawWorking) { changed = "idle"; }
      else if (state === "clear") { this.sawWorking = false; changed = "clear"; }
    }
    this.buffer = this.buffer.slice(Math.max(0, this.buffer.lastIndexOf("\x1b]7501;")));
    this.phase = changed;
    return changed;
  }

  get advanced(): boolean { return this.phase === "idle"; }
}
```

Advance only when `advanced` becomes true after a `working` in the same step.

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
