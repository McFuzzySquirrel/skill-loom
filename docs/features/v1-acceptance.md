# Feature: V1 Acceptance

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| US-01 | [Vision](../PRD.md#US-01) | participates |
| US-03 | [Vision](../PRD.md#US-03) | participates |
| US-06 | [Vision](../PRD.md#US-06) | participates |
| US-07 | [Vision](../PRD.md#US-07) | participates |
| US-08 | [Vision](../PRD.md#US-08) | participates |
| ACC-FR-01 | This feature | owns |
| ACC-FR-02 | This feature | owns |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** V1 Acceptance
**ID Prefix:** ACC
**Summary:** Document the operator contract and put the finished product through the two judgments automation cannot make: a real end-to-end chain journey against the running system, and a keyboard/screen-reader/contrast review.
**Dependencies:** App Foundation, Project Workspace, Skill Catalog, Chain Authoring, Run Preflight, Run Execution
**Priority:** Must

The acceptance feature contains one implementation task for operator documentation and two human-review tasks. Passing component tests does not satisfy these gates.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| ACC-US-01 | solo builder | read how to install, configure, run, and troubleshoot Slan | I can use it without reconstructing decisions from code | Must |
| ACC-US-02 | solo builder | prove a real 3+ step chain works twice | I know the core value is real, not just tested in pieces | Must |
| ACC-US-03 | keyboard or screen-reader user | complete the main journey without a mouse | the accessibility claim is verified, not assumed | Must |

---

## 3. Functional Requirements

```forge-requirement
{"id":"ACC-FR-01","kind":"requirement","text":"Document installation, harness prerequisites, configuration, data locations, the security model, automatic-mode permissions, and known limitations in README.md and docs/OPERATIONS.md, with a check script that verifies required sections and commands."}
```

```forge-requirement
{"id":"ACC-FR-02","kind":"requirement","text":"The primary journey is human-reviewed against the running system with at least one real 3+ step chain executed twice, and keyboard and accessibility behavior is human-reviewed against the practical WCAG 2.1 AA checklist."}
```

| ID | Priority |
|----|----------|
| ACC-FR-01 | Must |
| ACC-FR-02 | Must |

---

## 4. UI / Interaction Design

There is no new product UI in this feature. The documentation task creates the operator-facing README and operations guide. The human-review tasks exercise the existing screens and record findings in `docs/reviews/`.

The primary-journey review must use the real OpenCode and Copilot CLIs on this machine, not only fake fixtures. The accessibility review must use keyboard-only navigation and, where available, a screen reader or the browser accessibility tree.

---

## 5. Implementation Tasks

### Phase 1: Operator Documentation

```forge-task
{
  "id": "ACC-01",
  "title": "Write the operator documentation and docs check",
  "description": "Write README.md and docs/OPERATIONS.md for the finished v1. README covers the product purpose, install and run commands, required Node and harness versions, first-run flow, and links to the operations guide. OPERATIONS covers configuration and SLAN_CONFIG_DIR, data locations (.slan/chains, .slan/runs, ~/.config/slan), harness authentication prerequisites, Copilot trust and automatic permissions, the loopback-only security model, backup and cleanup, the skill-firing limitation, fork handoff behavior, and troubleshooting for missing CLI, auth, trust, node-pty build, dirty tree, and interrupted run. Add scripts/check-docs.mjs that asserts required headings and npm commands, and tests/unit/docs.test.ts that runs the same checks. Do not invent passing test results or claim features that are not implemented.",
  "ownerAgent": "platform-engineer",
  "dependencies": ["RUN-08", "PRE-04", "CHAIN-06", "PROJ-03", "CAT-04"],
  "expectedOutputs": [
    "README.md",
    "docs/OPERATIONS.md",
    "scripts/check-docs.mjs",
    "tests/unit/docs.test.ts"
  ],
  "validationCommands": [
    "node scripts/check-docs.mjs",
    "npx vitest run tests/unit/docs.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/v1-acceptance.md#ACC-FR-01"],
    "acceptanceCriteria": [
      "README documents install, dev, build, start, typecheck, unit, e2e, and live-probe commands",
      "OPERATIONS documents config, data locations, harness prerequisites, trust, automatic permissions, security, cleanup, and troubleshooting",
      "The docs state that skills are model-invoked and order is prompt order, not guaranteed firing",
      "The docs state that the server is loopback-only with no authentication",
      "The docs state that run records keep only a bounded tail and that runs/ is git-ignored",
      "The check script fails when a required heading or command is missing"
    ],
    "constraints": ["Do not document unimplemented features", "Do not include real credentials or tokens in examples"],
    "constraintRefs": ["docs/PRD.md#ARCH-01", "docs/PRD.md#EXEC-01", "docs/PRD.md#PRIV-01", "docs/PRD.md#NFR-MAINT-01"],
    "references": ["docs/PRD.md#1. Overview", "docs/PRD.md#12.2 Risks"]
  }
}
```

### Phase 2: Human Acceptance Reviews

```forge-task
{
  "id": "ACC-02",
  "title": "Review the primary chain journey with both harnesses",
  "description": "Perform this review in order against the running application:\n1. From a clean checkout, run npm install and npm run dev, then open http://127.0.0.1:7373 and confirm the local-only notice and empty project state.\n2. Open or create a real project directory, confirm it appears in recent projects, restart the server, and confirm it persists.\n3. Select OpenCode, confirm project-local skills appear with source badges, search for one by description, expand its full SKILL.md, and add one extra skill directory.\n4. Create a chain with at least three steps, give every step an instruction, declare one named input used in a step, reorder one step with the keyboard, and save.\n5. Run preflight, resolve or acknowledge every finding, start a supervised run, let the first step reach an interactive prompt, mark it Done, advance with Next, and complete the chain. Confirm the terminal is live and the step statuses are truthful.\n6. Reload the run page and confirm the recorded status. Edit the chain to use a different input value, re-run it, and confirm no prompt is retyped.\n7. Run the same chain in automatic OpenCode mode and confirm each step advances only after the working-to-idle signal; use Pause and Run next at least once.\n8. Exercise Copilot: confirm discovery, complete the trust flow or the documented fallback, and run at least one Copilot step with automatic permission opt-in or in supervised mode.\n9. Force a failing or interrupted step, confirm the chain pauses, then exercise Retry and Abort; confirm no step replays silently after reload.\n10. Record the harness versions, chain path, observed session ids, run ids, what was exercised, and every deviation in docs/reviews/v1-primary-journey.json. Approve only if the primary journey and the two-run reuse criterion pass.",
  "dependencies": ["ACC-01", "RUN-08", "RUN-07", "PRE-04", "CHAIN-06", "CAT-04", "PROJ-03"],
  "expectedOutputs": [],
  "validationCommands": [],
  "contract": {
    "version": 2,
    "kind": "human-review",
    "requirements": [],
    "requirementRefs": ["docs/features/v1-acceptance.md#ACC-FR-02"],
    "acceptanceCriteria": [
      "The reviewer completes the primary user journey through the running application, not only component or mocked tests",
      "A real 3+ step chain runs end-to-end twice with OpenCode, and the second run reuses inputs without retyping prompts",
      "Automatic OpenCode advances only after working-to-idle, and Pause/Run next are exercised",
      "Copilot discovery, trust handling, and at least one run are exercised with a real CLI",
      "A failure or interruption pauses the chain and Retry/Abort behave without silent replay",
      "The review notes record harness versions, chain path, run ids, and every deviation",
      "The review is rejected if the owner still prefers typing the prompts by hand"
    ],
    "constraints": ["Use the real local harness CLIs; do not substitute mocks for the primary journey", "Do not record credentials or full transcripts"],
    "constraintRefs": ["docs/PRD.md#EXEC-01", "docs/PRD.md#EXEC-02", "docs/PRD.md#SEC-02", "docs/PRD.md#PRIV-01"],
    "references": ["docs/PRD.md#11. Analytics and Success Metrics", "docs/PRD.md#10.5 Run"],
    "reviewFile": "docs/reviews/v1-primary-journey.json"
  }
}
```

```forge-task
{
  "id": "ACC-03",
  "title": "Review keyboard access, announcements, and contrast",
  "description": "Perform this review in order against the running application:\n1. Without using a pointer, open the project screen, browse to a project, create a chain, add three steps, edit instructions, reorder using Move up and Move down, declare an input, and save.\n2. Run preflight, acknowledge a warning, and start a run using only the keyboard; complete a supervised step and use Next, Retry, Skip, and Abort where valid.\n3. Tab through every screen and confirm the focus indicator is always visible, the order is logical, the skip link works, and focus is never trapped except inside the terminal until Escape is pressed.\n4. Confirm every control has an accessible name, every status is text or icon plus text, and step transitions and preflight results appear in an aria-live region.\n5. Enable xterm screen-reader mode, enter and leave the terminal with the documented controls, and confirm the terminal region is labeled.\n6. Check text and control contrast against WCAG 2.1 AA using browser devtools or an accessibility checker; record each failure with the screen and element.\n7. Record the scenarios exercised, browser and assistive technology used, contrast results, and every deviation in docs/reviews/v1-accessibility.json. Approve only if the keyboard-only journey and all acceptance criteria pass.",
  "dependencies": ["ACC-01", "RUN-07", "PRE-04", "CHAIN-06", "CAT-04", "PROJ-03"],
  "expectedOutputs": [],
  "validationCommands": [],
  "contract": {
    "version": 2,
    "kind": "human-review",
    "requirements": [],
    "requirementRefs": ["docs/features/v1-acceptance.md#ACC-FR-02"],
    "acceptanceCriteria": [
      "The reviewer completes the primary authoring and run journey using only the keyboard",
      "Focus is always visible, focus order is logical, and the terminal can be entered and left without trapping focus",
      "Every control has an accessible name and every status is conveyed by text or icon plus text",
      "Step transitions, preflight results, and run state changes are announced through aria-live",
      "xterm screen-reader mode is available and the terminal region is labeled",
      "Text and control contrast meets WCAG 2.1 AA, or every failure is recorded with the screen and element",
      "The review notes record the browser, assistive technology, scenarios, and deviations"
    ],
    "constraints": ["Perform the keyboard journey without pointer assistance", "Do not approve on visual polish alone"],
    "constraintRefs": ["docs/PRD.md#A11Y-01", "docs/PRD.md#A11Y-02", "docs/PRD.md#A11Y-03", "docs/PRD.md#A11Y-04"],
    "references": ["docs/PRD.md#9. Accessibility", "docs/PRD.md#4. Personas"],
    "reviewFile": "docs/reviews/v1-accessibility.json"
  }
}
```

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Documentation | Required operator content and commands | `node scripts/check-docs.mjs` plus a Vitest wrapper |
| Human | Real primary journey with both harnesses | Ordered checklist against the running app and real CLIs |
| Human | Keyboard, announcements, contrast, screen-reader terminal | Ordered checklist with keyboard-only navigation and a contrast check |
| Evidence | Review records | JSON files under `docs/reviews/` completed by the reviewer |

Key test scenarios:

1. The docs check fails when the automatic-permission warning or the skill-firing limitation is removed.
2. The primary journey runs a real 3+ step chain twice and reuses inputs.
3. The keyboard journey covers authoring, reordering, preflight, and run controls.
4. Contrast failures and accessibility deviations are recorded rather than hand-waved.

---

## 7. Acceptance Criteria

1. Operator documentation is complete, accurate, and gated by a check script.
2. The primary journey is exercised against the running system with real OpenCode and Copilot CLIs.
3. A real 3+ step chain runs twice, and the second run reuses inputs without retyping prompts.
4. Automatic OpenCode advancement is observed only after working-to-idle.
5. Failure, retry, abort, reload, and interrupted recovery are exercised.
6. The keyboard-only authoring and run journey passes, with contrast and screen-reader evidence recorded.
7. Every deviation is recorded in the review files; no review claims unexercised behavior.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Is a separate accessibility tool such as axe required? | No; browser devtools and the accessibility tree are sufficient, with every failure recorded. |
| 2 | Should the primary journey be repeated on a second machine? | No; one local machine with both harnesses is sufficient for v1. |
| 3 | What if Copilot is unavailable at review time? | Record the blocker and do not approve the Copilot criterion; do not substitute a mock. |
