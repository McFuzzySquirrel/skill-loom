# Feature: Run Execution

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| US-03 | [Vision](../PRD.md#US-03) | participates |
| US-04 | [Vision](../PRD.md#US-04) | participates |
| US-06 | [Vision](../PRD.md#US-06) | participates |
| RUN-FR-01 | This feature | owns |
| RUN-FR-02 | This feature | owns |
| RUN-FR-03 | This feature | owns |
| RUN-FR-04 | This feature | owns |
| RUN-FR-05 | This feature | owns |
| RUN-FR-06 | This feature | owns |
| RUN-FR-07 | This feature | owns |
| RUN-FR-08 | This feature | owns |
| RUN-FR-09 | This feature | owns |
| RUN-FR-10 | This feature | owns |
| RUN-FR-11 | This feature | owns |
| RUN-FR-12 | This feature | owns |
| RUN-FR-13 | This feature | owns |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Run Execution
**ID Prefix:** RUN
**Summary:** Snapshot a chain, drive its steps through a supervised or automatic harness adapter, stream the live terminal, pause on failure, and persist enough state to reopen, retry, continue, or restart without replaying work.
**Dependencies:** App Foundation, Project Workspace, Chain Authoring, Run Preflight
**Priority:** Must

This feature is where Slan earns its keep. The run view must be terminal-dominant, the step state must be honest, and automatic advancement must be tied to a real harness signal rather than animation quiescence.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| RUN-US-01 | solo builder | watch the real harness TUI in the run view | I can see what the agent is doing | Must |
| RUN-US-02 | solo builder | press Next only when I am satisfied | supervised steps are not guessed complete | Must |
| RUN-US-03 | solo builder | let automatic mode advance on a real signal | long chains need less attention | Must |
| RUN-US-04 | solo builder | pause on failure and choose retry, skip, or abort | a bad step does not destroy the chain | Must |
| RUN-US-05 | solo builder | reopen a run after a reload or crash | I can recover without silently replaying a step | Must |
| RUN-US-06 | solo builder | choose shared, fresh, or fork sessions | I control how much context carries forward | Must |

---

## 3. Functional Requirements

```forge-requirement
{"id":"RUN-FR-01","kind":"requirement","text":"Create a run by snapshotting the full chain definition and resolving inputs; persist run metadata at <project>/.slan/runs/<runId>.json and never mutate the saved chain because of a run."}
```

```forge-requirement
{"id":"RUN-FR-02","kind":"requirement","text":"Enforce one active run globally; reject a second start with 409 while a run is starting, running, paused, or awaiting user input."}
```

```forge-requirement
{"id":"RUN-FR-03","kind":"requirement","text":"Record per-step status, timestamps, exit code, session id, skill-observation state, and a bounded terminal tail of at most 200 lines or 32 KiB; never persist full transcripts."}
```

```forge-requirement
{"id":"RUN-FR-04","kind":"requirement","text":"Assemble step prompts from the instruction and named inputs, naming the skill explicitly and including the instruction text; unresolved placeholders or missing inputs abort before any process start."}
```

```forge-requirement
{"id":"RUN-FR-05","kind":"requirement","text":"Implement shared, fresh-per-step, and fork-from-previous sessions: shared reuses one session id, fresh creates a new id per step, fork uses OpenCode run --fork where available and otherwise starts a new session seeded with a deterministic handoff note built from the previous step metadata and bounded tail."}
```

```forge-requirement
{"id":"RUN-FR-06","kind":"requirement","text":"Run supervised steps by restarting the harness CLI in the same PTY with the session id and seeded prompt; the user marks Done, Failed, or Skipped and controls Next, Retry, Skip, and Abort."}
```

```forge-requirement
{"id":"RUN-FR-07","kind":"requirement","text":"Run automatic OpenCode steps in a PTY and advance only on OSC 7501 state=idle after observing state=working; run automatic Copilot as one headless process per step sharing the session id and advance only on process exit."}
```

```forge-requirement
{"id":"RUN-FR-08","kind":"requirement","text":"Pause the chain on any failed step, non-zero exit, missing completion signal within the configured timeout, or ambiguous state; offer Retry, Skip, or Abort and never auto-continue through failure."}
```

```forge-requirement
{"id":"RUN-FR-09","kind":"requirement","text":"Expose Pause and Run-next controls in automatic mode so the user can take over without switching modes."}
```

```forge-requirement
{"id":"RUN-FR-10","kind":"requirement","text":"Detect skill firing best-effort from Copilot skill(...) log lines, mark OpenCode interactive as not observable, and never use the indicator to block or fail a step."}
```

```forge-requirement
{"id":"RUN-FR-11","kind":"requirement","text":"Stream run and step state over WebSocket, reconnect the UI after reload, and offer retry-interrupted-step, continue-from-next-pending-step, or restart after a server restart; never auto-replay a step."}
```

```forge-requirement
{"id":"RUN-FR-12","kind":"requirement","text":"Provide a terminal-dominant run view with xterm.js, a step rail, status text not conveyed by color alone, keyboard-operable controls, and aria-live announcements for step transitions."}
```

```forge-requirement
{"id":"RUN-FR-13","kind":"requirement","text":"Verify live execution against OpenCode 2.2.5 and Copilot CLI 1.0.105: seeded prompt, skill token recall, cross-process session continuation, OpenCode idle signal, and Copilot headless session behavior; record evidence and fail on missing prerequisites."}
```

| ID | Priority |
|----|----------|
| RUN-FR-01 | Must |
| RUN-FR-02 | Must |
| RUN-FR-03 | Must |
| RUN-FR-04 | Must |
| RUN-FR-05 | Must |
| RUN-FR-06 | Must |
| RUN-FR-07 | Must |
| RUN-FR-08 | Must |
| RUN-FR-09 | Must |
| RUN-FR-10 | Must |
| RUN-FR-11 | Must |
| RUN-FR-12 | Must |
| RUN-FR-13 | Must |

---

## 4. UI / Interaction Design

The run view fills the viewport. A compact header shows chain name, harness, mode, session mode, elapsed time, and a status badge. Below it, a horizontal step rail shows each step's index, label or skill name, and status text. The selected step expands to show its instruction and any failure reason. The terminal occupies the remaining space and is the primary focus.

Supervised controls are Next, Retry, Skip, and Abort. Done, Failed, and Skipped are explicit outcomes; Next is enabled only after the user marks Done or Skipped, and Retry is enabled for Failed. Automatic controls are Pause, Resume, Run next, and Abort. A paused or failed run shows the same retry/skip/abort choices.

The terminal uses xterm.js with fit, web-links, unicode11, and screen-reader mode enabled. A "Focus terminal" button moves focus into the terminal; Escape moves focus back to the control bar. Output is never injected as HTML. On reconnect, the view fetches the run record and reattaches to the live terminal if the session is still alive; otherwise it shows the interrupted state and recovery actions.

An interrupted run presents three explicit actions: Retry interrupted step, Continue from next pending step, and Restart chain. Each explains what will and will not be replayed. The view never starts a step automatically after a reload.

---

## 5. Implementation Tasks

### Phase 1: Run Model, Prompts, and Signal Parsing

```forge-task
{
  "id": "RUN-01",
  "title": "Implement the run record, snapshot, lock, and bounded tail",
  "description": "Implement the run domain and storage. Define run and step records with id, project id, chain id, harness, mode, session mode, chain snapshot, resolved inputs, status, current step index, timestamps, session id, fork mechanism, per-step status/timestamps/exit code/skill observation, and a bounded terminal tail. Create a run by deep-cloning the chain. Persist under <project>/.slan/runs/<runId>.json with atomic writes. Enforce one active run globally through an active-run pointer in the config directory, reject a second active run, and mark records that were starting/running/paused/awaiting-user at startup as interrupted. Cap each step tail at 200 lines or 32 KiB, remove full transcripts, and expose typed read/list/update helpers. Add tests/unit/run-model.test.ts and tests/unit/run-store.test.ts covering snapshot immutability, tail capping, active lock, interrupted startup, atomic write, and traversal rejection. Do not orchestrate a harness here.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["CHAIN-02", "PROJ-02"],
  "expectedOutputs": [
    "src/server/runs/model.ts",
    "src/server/runs/store.ts",
    "tests/unit/run-model.test.ts",
    "tests/unit/run-store.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/run-model.test.ts tests/unit/run-store.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-execution.md#RUN-FR-01", "docs/features/run-execution.md#RUN-FR-02", "docs/features/run-execution.md#RUN-FR-03"],
    "acceptanceCriteria": [
      "Editing the source chain after run creation does not change the run snapshot",
      "A second active run is rejected while the first is starting, running, paused, or awaiting input",
      "Startup marks stale active records interrupted and clears the pointer",
      "The tail never exceeds 200 lines or 32 KiB per step",
      "No field can hold a full transcript",
      "A run id with traversal characters is rejected before filesystem access"
    ],
    "constraints": ["Do not persist full terminal output", "Do not use a database"],
    "constraintRefs": ["docs/PRD.md#EXEC-03", "docs/PRD.md#EXEC-08", "docs/PRD.md#PRIV-01", "docs/PRD.md#ARCH-04"],
    "references": ["docs/PRD.md#6.4 Execution Model", "docs/PRD.md#10.5 Run"]
  }
}
```

```forge-task
{
  "id": "RUN-02",
  "title": "Implement prompt assembly, session planning, and handoff notes",
  "description": "Implement step prompt assembly and session planning. Resolve {{name}} placeholders from validated inputs, name the skill explicitly, and include the instruction text; fail before process start when an input is missing or a placeholder is unresolved. Plan shared, fresh, and fork sessions from the chain and adapter capabilities: shared reuses one session id, fresh creates a new id per step, native fork is used only where the adapter supports it, and otherwise build a deterministic handoff note from the previous step label, skill, instruction, status, and bounded tail. Sanitize and cap the handoff note. Add tests/unit/prompts.test.ts covering substitution, missing inputs, exact prompt text, shared/fresh/fork plans, native versus handoff selection, and handoff capping. Do not spawn a process.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["RUN-01", "PRE-01"],
  "expectedOutputs": [
    "src/server/runs/prompts.ts",
    "src/server/runs/handoff.ts",
    "tests/unit/prompts.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/prompts.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-execution.md#RUN-FR-04", "docs/features/run-execution.md#RUN-FR-05"],
    "acceptanceCriteria": [
      "A prompt contains the explicit skill name and the resolved instruction",
      "A missing required input fails before process start",
      "An unresolved placeholder fails with step and placeholder named",
      "Shared, fresh, and fork plans produce the documented session id behavior",
      "Native fork is selected only where supported; otherwise a handoff note is produced",
      "The handoff note is deterministic and capped with the bounded tail"
    ],
    "constraints": ["Do not append full terminal transcripts to a prompt", "Do not invent a fork where the adapter reports none"],
    "constraintRefs": ["docs/PRD.md#EXEC-01", "docs/PRD.md#EXEC-04", "docs/PRD.md#EXEC-07", "docs/PRD.md#PRIV-01"],
    "references": ["docs/PRD.md#6.4 Execution Model", "docs/PRD.md#15. Glossary"]
  }
}
```

```forge-task
{
  "id": "RUN-03",
  "title": "Parse OpenCode terminal state and skill observations",
  "description": "Implement streaming parsers for harness signals. Parse OSC 7501 sequences with state=working|idle|clear and optional id=ses_..., including sequences split across chunks and mixed with unrelated ANSI output. Expose a state machine that reports idle completion only after working has been observed, ignores idle without working, and resets on clear. Implement skill observation parsing: Copilot skill(name) log lines map to observed with the name, OpenCode interactive output maps to not-observable, and unknown output maps to unknown. Add tests/unit/osc.test.ts covering split chunks, unrelated sequences, working-to-idle, idle-only, clear, and observation parsing. Do not use output-idle timing or animation quiescence.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["RUN-01"],
  "expectedOutputs": [
    "src/server/runs/osc.ts",
    "src/server/runs/observations.ts",
    "tests/unit/osc.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/osc.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-execution.md#RUN-FR-07", "docs/features/run-execution.md#RUN-FR-10"],
    "acceptanceCriteria": [
      "OSC 7501 sequences split across chunks are parsed correctly",
      "idle advances only after working was observed in the same step",
      "A clear state resets the completion state",
      "Unrelated ANSI and OSC sequences are ignored",
      "Copilot skill(name) is observed, OpenCode interactive is not observable, and neither blocks a step",
      "No idle heuristic is used"
    ],
    "constraints": ["Do not parse terminal output as HTML", "Do not treat a quiet terminal as complete"],
    "constraintRefs": ["docs/PRD.md#EXEC-02", "docs/PRD.md#SEC-03", "docs/PRD.md#NFR-COMPAT-01"],
    "references": ["docs/PRD.md#5. Research Findings", "docs/PRD.md#6.4 Execution Model"]
  }
}
```

### Phase 2: Supervised and Automatic Runners

```forge-task
{
  "id": "RUN-04",
  "title": "Implement the supervised runner",
  "description": "Implement the supervised run state machine. For each step, restart the harness CLI in the same PTY with the planned session id and seeded prompt, stream output, capture a bounded tail, and transition to awaiting-user. The user marks Done, Failed, or Skipped; Next advances only after Done or Skipped, Retry restarts the current step with the same plan, Skip records the reason, and Abort kills the process. Process exit is shown as a signal but never auto-advances. Record session id, exit code, timestamps, and observation. Add tests/unit/supervised-runner.test.ts with a fake PTY covering the full transition matrix, same-PTY reuse, restart arguments, no keystroke injection, retry, skip, abort, and cleanup. Do not implement automatic mode or the UI.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["RUN-02", "RUN-03", "FOUND-05"],
  "expectedOutputs": [
    "src/server/runs/supervised.ts",
    "tests/unit/supervised-runner.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/supervised-runner.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-execution.md#RUN-FR-06", "docs/features/run-execution.md#RUN-FR-08"],
    "acceptanceCriteria": [
      "Each step starts a fresh CLI process in the same PTY with the session id and prompt",
      "No keystrokes are written into a live TUI to advance a step",
      "Process exit alone does not mark a supervised step done",
      "Done and Skipped enable Next; Failed does not",
      "Retry restarts the same step; Skip records a reason; Abort kills the process",
      "The runner records the bounded tail and observation state"
    ],
    "constraints": ["Do not reuse a running TUI across steps", "Do not auto-advance supervised steps"],
    "constraintRefs": ["docs/PRD.md#EXEC-07", "docs/PRD.md#EXEC-02", "docs/PRD.md#NFR-REL-02"],
    "references": ["docs/PRD.md#6.4 Execution Model", "docs/PRD.md#10.5 Run"]
  }
}
```

```forge-task
{
  "id": "RUN-05",
  "title": "Implement the automatic OpenCode and Copilot runners",
  "description": "Implement the automatic run state machine with adapter-specific advancement. OpenCode: run the step in a PTY, watch for OSC working then idle, advance only on idle, stop the process gracefully, and restart the next step with the planned session. Copilot: run one headless process per step with the shared session id and broad flags only when the chain opted in, and advance only on exit. Pause stops advancement after the current signal; Run next starts the next pending step; timeout or ambiguous state pauses with a failure. Non-zero exit fails. Implement shared, fresh, and fork plans including native fork versus handoff. Add tests/unit/automatic-runner.test.ts with fake sessions covering working-idle, idle-only, timeout, non-zero exit, Copilot exit 0 and non-zero, permission flags, pause/run-next, fresh/shared/fork, and cleanup. Do not implement the run UI or HTTP routes.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["RUN-02", "RUN-03", "FOUND-05"],
  "expectedOutputs": [
    "src/server/runs/automatic.ts",
    "tests/unit/automatic-runner.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/automatic-runner.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-execution.md#RUN-FR-07", "docs/features/run-execution.md#RUN-FR-08", "docs/features/run-execution.md#RUN-FR-09"],
    "acceptanceCriteria": [
      "OpenCode advances only after working then idle in the same step",
      "An idle-only or quiet terminal does not advance",
      "A missing completion signal within the timeout pauses the run",
      "Copilot advances only on process exit and fails on non-zero exit",
      "Broad Copilot flags appear only with the per-chain opt-in",
      "Pause and Run next behave without changing mode",
      "Shared, fresh, and fork plans select the documented session behavior"
    ],
    "constraints": ["Do not use output-idle heuristics", "Do not pass broad Copilot flags without the opt-in"],
    "constraintRefs": ["docs/PRD.md#EXEC-02", "docs/PRD.md#EXEC-06", "docs/PRD.md#EXEC-05"],
    "references": ["docs/PRD.md#6.4 Execution Model", "docs/PRD.md#10.5 Run"]
  }
}
```

### Phase 3: Run Orchestration and API

```forge-task
{
  "id": "RUN-06",
  "title": "Implement run orchestration, actions, and event streaming",
  "description": "Implement the orchestrator and HTTP/WebSocket surface. POST /api/projects/:projectId/runs re-runs the blocking preflight, snapshots the chain, resolves inputs, creates the run, and starts the selected runner. GET /api/runs/:runId returns the record, GET /api/runs/active returns the current run summary, and POST /api/runs/:runId/actions handles next, retry, skip, abort, pause, resume, run-next, continue, and restart with mode-appropriate validation. Stream state events over WS /api/runs/:runId/events. On reconnect, send a full snapshot then deltas. Enforce one active run, clean up PTYs on completion/abort, and expose interrupted recovery. Register routes through src/server/routes/index.ts. Add tests/integration/run-routes.test.ts covering creation, preflight block, conflict, actions, event order, reconnect snapshot, recovery actions, and error envelopes through src/server/app.ts. Do not implement the run view.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["RUN-04", "RUN-05", "PRE-03"],
  "expectedOutputs": [
    "src/server/runs/orchestrator.ts",
    "src/server/routes/runs.ts",
    "src/server/routes/index.ts",
    "tests/integration/run-routes.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/integration/run-routes.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-execution.md#RUN-FR-11"],
    "acceptanceCriteria": [
      "Creating a run re-runs preflight and rejects a blocked report",
      "A second active run returns 409",
      "Mode-inappropriate actions return a typed error",
      "Events include run and step transitions in order and a full snapshot on reconnect",
      "Interrupted recovery offers retry, continue, and restart without auto-replay",
      "PTYs are cleaned up on completion and abort",
      "All routes are reachable through src/server/app.ts"
    ],
    "constraints": ["Do not start a step without an explicit run or action", "Do not expose a second active run"],
    "constraintRefs": ["docs/PRD.md#EXEC-03", "docs/PRD.md#NFR-REL-02", "docs/PRD.md#ARCH-05"],
    "references": ["docs/PRD.md#6.3 Key APIs and Interfaces", "docs/PRD.md#10.5 Run"]
  }
}
```

### Phase 4: Run View

```forge-task
{
  "id": "RUN-07",
  "title": "Build the terminal-dominant run view",
  "description": "Replace the run placeholder with the real run view. Implement xterm.js with fit, web-links, unicode11, and screen-reader mode, a step rail with text status, a header with run metadata, and mode-specific controls: Next/Retry/Skip/Abort for supervised; Pause/Resume/Run next/Abort for automatic. Handle terminal resize, focus-in/out, reconnect after reload, full-snapshot plus delta events, and interrupted recovery actions. Announce step transitions through aria-live. Add tests/e2e/run.spec.ts using a fake harness executable that emits OSC working/idle for automatic mode and waits for supervised Done; cover terminal output, step transitions, controls, failure pause, reconnect snapshot, recovery actions, and keyboard focus. Do not implement run creation or preflight.",
  "ownerAgent": "frontend-engineer",
  "dependencies": ["RUN-06", "PRE-04"],
  "expectedOutputs": [
    "src/web/routes/RunPage.tsx",
    "src/web/components/TerminalPane.tsx",
    "src/web/components/StepRail.tsx",
    "src/web/components/RunControls.tsx",
    "src/web/hooks/useRunStream.ts",
    "src/web/api/runs.ts",
    "tests/e2e/run.spec.ts"
  ],
  "validationCommands": [
    "npx playwright test tests/e2e/run.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-execution.md#RUN-FR-12"],
    "acceptanceCriteria": [
      "Terminal output is rendered through xterm.js and never as HTML",
      "The step rail shows text status not conveyed by color alone",
      "Supervised and automatic controls appear only where valid",
      "A failure pauses the chain and offers Retry, Skip, and Abort",
      "Reloading reconnects to a live session or shows interrupted recovery",
      "Screen-reader mode is enabled and focus can enter and leave the terminal",
      "The Playwright test drives the view through src/web/App.tsx"
    ],
    "constraints": ["Do not auto-start a step after reload", "Do not hide the terminal behind a modal"],
    "constraintRefs": ["docs/PRD.md#A11Y-01", "docs/PRD.md#A11Y-03", "docs/PRD.md#A11Y-04", "docs/PRD.md#SEC-03"],
    "references": ["docs/features/run-execution.md#4. UI / Interaction Design", "docs/PRD.md#10.5 Run"]
  }
}
```

### Phase 5: Live Harness Verification

```forge-task
{
  "id": "RUN-08",
  "title": "Verify live execution against OpenCode and Copilot",
  "description": "Create scripts/live-execution.ts. Build a temporary project under the user's cache directory with a probe skill under .opencode/skills/slan-live-probe and .agents/skills/slan-live-probe; the skill returns the token PINEAPPLE. For OpenCode, spawn interactive OpenCode 2.2.5 in a PTY with a generated ses_ session and a seeded prompt, assert the token, assert OSC 7501 working and idle, then spawn a second process with the same session and assert the token is recalled. For Copilot CLI 1.0.105, run a headless prompt with a generated UUID session id and broad flags in the temporary project, assert the token, then run a second process with the same session id and assert recall. Record versions, session ids, timings, state-signal evidence, observation results, and cleanup status in docs/evidence/live-execution.json. Fail with a non-zero exit when a CLI is missing, unauthenticated, untrusted, or a probe fails. Remove the temporary project and never persist a transcript.",
  "ownerAgent": "integration-engineer",
  "dependencies": ["RUN-06"],
  "expectedOutputs": [
    "scripts/live-execution.ts",
    "docs/evidence/live-execution.json"
  ],
  "validationCommands": [
    "npm run test:live:execution"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-execution.md#RUN-FR-13"],
    "acceptanceCriteria": [
      "OpenCode returns PINEAPPLE from the probe skill and emits working then idle",
      "A second OpenCode process recalls PINEAPPLE using the same session",
      "Copilot returns PINEAPPLE from the probe skill in headless mode",
      "A second Copilot process recalls PINEAPPLE using the same session id",
      "Missing CLI, auth, or trust prerequisites fail the script with actionable output",
      "The evidence file records versions, session ids, timings, and pass/fail per check",
      "The temporary project is removed and no transcript is written"
    ],
    "constraints": ["Do not copy or log credentials", "Do not leave temporary skills behind", "Do not use output-idle to advance"],
    "constraintRefs": ["docs/PRD.md#SEC-02", "docs/PRD.md#PRIV-01", "docs/PRD.md#EXEC-02", "docs/PRD.md#NFR-COMPAT-01"],
    "references": ["docs/PRD.md#5. Research Findings", "docs/PRD.md#12.2 Risks"]
  }
}
```

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Run records, snapshot, lock, tail cap, prompts, handoff, OSC parser, observations | Vitest with temporary directories and injected clocks/PTYs |
| Unit | Supervised and automatic state machines | Fake PTY and process adapters with deterministic signals |
| Integration | Run creation, actions, events, recovery | Fastify `inject` and a real WebSocket client |
| Browser | Terminal, step rail, controls, reconnect, recovery | Playwright with a fake harness executable |
| Live | Real OpenCode and Copilot execution | `npm run test:live:execution`, evidence in `docs/evidence/live-execution.json` |
| Human | Primary journey, real 3+ step chain twice | V1 Acceptance review |

Key test scenarios:

1. Editing a chain after run creation does not change the run snapshot.
2. A second active run is rejected with 409.
3. An OpenCode step with `state=idle` but no prior `state=working` does not advance.
4. A Copilot headless non-zero exit pauses with Retry/Skip/Abort.
5. A reload reconnects to a live PTY or shows interrupted recovery without replaying.
6. The live probe recalls a token across two harness processes.

---

## 7. Acceptance Criteria

1. A chain run freezes a snapshot, resolves inputs, and records only bounded tails.
2. One run is active at a time and every run action is explicit.
3. Supervised steps wait for user-confirmed outcomes; automatic steps advance only on the documented signals.
4. Failure, timeout, and ambiguity pause the chain with retry, skip, and abort.
5. Reload and server restart recover without silently replaying a step.
6. The run view is terminal-dominant, keyboard-operable, screen-reader aware, and not color-only.
7. Real execution is proven against both installed harnesses with recorded evidence.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Does OpenCode keep a turn at `state=working` while an approval prompt is open? | Assume yes until the bounded timeout; supervised mode remains the safe path. |
| 2 | Does Copilot `skill(...)` output survive in headless mode? | Capture it when present; otherwise record not-observable. |
| 3 | Should a failed step auto-retry once? | No; never auto-retry a failure. |
| 4 | Should `fork` be selectable for Copilot? | Yes, but it is implemented as a handoff note and labeled as such at preflight. |
| 5 | What is the default automatic step timeout? | 30 minutes; configurable per chain, with a hard pause rather than an auto-skip. |
| 6 | Should the terminal tail be cleared on successful step completion? | No; keep the bounded tail for the run record and handoff, subject to `runs/` being git-ignored. |
