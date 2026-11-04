# Feature: Run Preflight

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| US-05 | [Vision](../PRD.md#US-05) | participates |
| US-03 | [Vision](../PRD.md#US-03) | participates |
| PRE-FR-01 | This feature | owns |
| PRE-FR-02 | This feature | owns |
| PRE-FR-03 | This feature | owns |
| PRE-FR-04 | This feature | owns |
| PRE-FR-05 | This feature | owns |
| PRE-FR-06 | This feature | owns |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Run Preflight
**ID Prefix:** PRE
**Summary:** Resolve every skill and input, confirm the harness CLI and local authentication, resolve Copilot folder trust, surface permission scope and dirty-tree warnings, and present a structured report before the first step starts.
**Dependencies:** App Foundation, Project Workspace, Skill Catalog, Chain Authoring
**Priority:** Must

Preflight exists because discovering a missing skill or an unauthenticated CLI at step 3 destroys the context the chain was built to preserve. Hard blocks stop the run; warnings require acknowledgement.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| PRE-US-01 | solo builder | see every missing skill before the run | I can fix the chain instead of losing context mid-run | Must |
| PRE-US-02 | solo builder | resolve Copilot folder trust from the run-start flow | the first prompt is not swallowed by a dialog | Must |
| PRE-US-03 | solo builder | see the exact automatic-mode permission scope | I opt in knowingly, not by default | Must |
| PRE-US-04 | solo builder | know which fork mechanism will be used | I understand when a fork is a handoff, not a true copy | Must |

---

## 3. Functional Requirements

```forge-requirement
{"id":"PRE-FR-01","kind":"requirement","text":"Define a harness adapter contract that reports display name, executable, discovery strategy, supported session modes, native fork support, trust behavior, permission requirements, automatic advancement signal, and prompt/session argument builders for OpenCode and Copilot."}
```

```forge-requirement
{"id":"PRE-FR-02","kind":"requirement","text":"Preflight resolves every step skill against the selected harness catalog, checks CLI presence and local authentication evidence, checks Copilot folder trust, reports dirty git state as a warning, validates inputs and session/fork support, and returns a structured report with hard-block and warning findings."}
```

```forge-requirement
{"id":"PRE-FR-03","kind":"requirement","text":"Expose preflight over POST /api/projects/:projectId/preflight and a Copilot trust action that starts an unseeded interactive trust session, verifies the trusted-folder entry, and offers the exact manual fallback when trust is not established."}
```

```forge-requirement
{"id":"PRE-FR-04","kind":"requirement","text":"Provide a run-start screen that renders chain inputs, runs preflight, shows findings with severity and remediation, offers the trust action and automatic-permission opt-in, and disables Start until hard blocks are cleared."}
```

```forge-requirement
{"id":"PRE-FR-05","kind":"requirement","text":"Never make a paid model call during preflight; authentication checks use only local CLI output, environment-token presence, and config files."}
```

```forge-requirement
{"id":"PRE-FR-06","kind":"requirement","text":"When automation cannot verify authentication or trust, require an explicit user acknowledgement recorded in the preflight report instead of assuming success."}
```

| ID | Priority |
|----|----------|
| PRE-FR-01 | Must |
| PRE-FR-02 | Must |
| PRE-FR-03 | Must |
| PRE-FR-04 | Must |
| PRE-FR-05 | Must |
| PRE-FR-06 | Must |

---

## 4. UI / Interaction Design

The run-start screen shows the chain name, harness badge, session mode, and step count, followed by an inputs form. Inputs are rendered in declaration order; required inputs show an asterisk and inline validation. Values are remembered per chain after a successful start.

The primary action is Run preflight. While checks run, each row shows a pending indicator and a status label. Results are grouped into Blocking and Warnings, with a one-line explanation and a remediation action. A blocked report disables Start. A warnings-only report requires a "I reviewed the warnings" checkbox before Start enables.

Copilot trust appears as a dedicated panel when the folder is untrusted: "Open trust terminal" starts an unseeded Copilot session in the project, the user accepts the dialog in the embedded terminal, then "Verify trust" re-checks. The panel always shows the manual fallback command. Automatic mode shows the exact broad flags and requires the per-chain permission opt-in checkbox; enabling it persists on the chain after confirmation.

The preflight report includes the fork mechanism: native OpenCode fork or handoff note. An unsupported session mode is a hard block. A missing CLI or unreadable auth evidence explains the exact command to run.

---

## 5. Implementation Tasks

### Phase 1: Adapters, Checks, and API

```forge-task
{
  "id": "PRE-01",
  "title": "Implement the harness adapter registry",
  "description": "Implement the harness adapter contract and the OpenCode and Copilot descriptors. Each adapter reports id, display name, executable resolution, discovery strategy, supported session modes, native fork support, trust behavior, automatic permission requirements, automatic advancement signal, and builders for interactive and headless arguments. Resolve command paths from Slan config and then PATH without shell execution. OpenCode reports shared, fresh, and fork where its run subcommand supports it; Copilot reports shared and fresh and a handoff fallback for fork. Add tests/unit/harness-registry.test.ts covering both adapters, command resolution, unsupported mode detection, argument arrays, and non-loopback-irrelevant behavior. Do not perform preflight checks or spawn a harness here.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["FOUND-03", "CHAIN-01"],
  "expectedOutputs": [
    "src/server/harness/types.ts",
    "src/server/harness/registry.ts",
    "src/server/harness/opencode.ts",
    "src/server/harness/copilot.ts",
    "tests/unit/harness-registry.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/harness-registry.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-preflight.md#PRE-FR-01"],
    "acceptanceCriteria": [
      "Both adapters expose the full capability descriptor",
      "Command resolution honors config overrides and PATH scanning without a shell",
      "OpenCode native fork is reported only where the CLI supports it; Copilot reports handoff",
      "Interactive and headless argument builders return executable-plus-array values",
      "An unsupported session mode is detectable before a run starts"
    ],
    "constraints": ["Do not add a third harness in v1", "Do not hard-code harness behavior in route or UI code"],
    "constraintRefs": ["docs/PRD.md#NFR-COMPAT-01", "docs/PRD.md#ARCH-03", "docs/PRD.md#EXEC-04"],
    "references": ["docs/PRD.md#6.4 Execution Model", "docs/PRD.md#5. Research Findings"]
  }
}
```

```forge-task
{
  "id": "PRE-02",
  "title": "Implement the preflight engine and checks",
  "description": "Implement the structured preflight engine. Validate the chain and input values, resolve every step skill against the selected harness catalog, check CLI presence, inspect local authentication evidence without exposing secrets, inspect Copilot trusted folders from the Copilot config, run git status --porcelain for a warning, verify session mode and fork mechanism, and require the per-chain opt-in for automatic Copilot broad permissions. Produce a report with status pass|warn|blocked, ordered checks with severity, message, remediation, and details, resolved inputs, catalog warnings, and the planned session/fork mechanism. Auth ambiguity must produce an acknowledgement-required finding rather than a pass. Add tests/unit/preflight-engine.test.ts with injected command and config readers covering every block and warning path, redaction, and the no-paid-call rule. Do not add HTTP routes or UI.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["PRE-01", "CAT-03", "CHAIN-02"],
  "expectedOutputs": [
    "src/server/preflight/auth.ts",
    "src/server/preflight/trust.ts",
    "src/server/preflight/engine.ts",
    "tests/unit/preflight-engine.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/preflight-engine.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-preflight.md#PRE-FR-02", "docs/features/run-preflight.md#PRE-FR-05", "docs/features/run-preflight.md#PRE-FR-06"],
    "acceptanceCriteria": [
      "Every step skill is resolved; an unresolved skill is a hard block naming the step",
      "Missing CLI, untrusted Copilot folder, unresolved input, and unsupported session mode are hard blocks",
      "Dirty git state is a warning and never blocks",
      "Automatic Copilot without per-chain permission opt-in is a hard block",
      "Ambiguous auth requires acknowledgement and never silently passes",
      "No check spawns a prompt or makes a paid model call",
      "The report is deterministic for the same inputs and redacts secrets"
    ],
    "constraints": ["Do not run the harness in prompt mode", "Do not read credential values", "Do not block on a warning"],
    "constraintRefs": ["docs/PRD.md#EXEC-05", "docs/PRD.md#EXEC-06", "docs/PRD.md#SEC-02", "docs/PRD.md#NFR-PERF-02"],
    "references": ["docs/PRD.md#6.4 Execution Model", "docs/PRD.md#10.4 Preflight"]
  }
}
```

```forge-task
{
  "id": "PRE-03",
  "title": "Expose preflight and Copilot trust endpoints",
  "description": "Implement the preflight HTTP route and the Copilot trust flow. POST /api/projects/:projectId/preflight accepts chain id, harness, mode, input values, and acknowledgement flags, then returns the structured report. POST /api/projects/:projectId/trust supports start and verify: start launches an unseeded interactive Copilot PTY in the project through the foundation terminal transport and returns a session id; verify re-reads trusted folders, closes the trust session on success, and returns the manual fallback command on failure. Register routes through src/server/routes/index.ts. Add tests/integration/preflight-routes.test.ts with injected command/config readers and a fake trust session covering pass, block, acknowledgement, trust start, trust verify, and error envelopes through src/server/app.ts. Do not implement the run-start UI or start a run.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["PRE-02", "FOUND-05", "PROJ-02"],
  "expectedOutputs": [
    "src/server/routes/preflight.ts",
    "src/server/preflight/trust-session.ts",
    "src/server/routes/index.ts",
    "tests/integration/preflight-routes.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/integration/preflight-routes.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-preflight.md#PRE-FR-03"],
    "acceptanceCriteria": [
      "Preflight is reachable through src/server/app.ts and returns the structured report",
      "Trust start launches an unseeded interactive Copilot session with no prompt argument",
      "Trust verify detects a newly trusted folder and closes the trust session",
      "Trust failure returns the exact manual command and does not mark the folder trusted",
      "Invalid project, chain, harness, or mode returns the shared error envelope",
      "No endpoint makes a paid model call"
    ],
    "constraints": ["Do not write the Copilot config file directly", "Do not seed a prompt into the trust session"],
    "constraintRefs": ["docs/PRD.md#EXEC-05", "docs/PRD.md#SEC-01", "docs/PRD.md#NFR-REL-02"],
    "references": ["docs/PRD.md#6.3 Key APIs and Interfaces", "docs/PRD.md#10.4 Preflight"]
  }
}
```

### Phase 2: Run-Start Screen

```forge-task
{
  "id": "PRE-04",
  "title": "Build the run-start and preflight report screen",
  "description": "Replace the run-start placeholder with the real screen. Render chain summary, inputs, mode selector, preflight action, grouped blocking and warning findings with remediation, a warnings acknowledgement, the Copilot trust panel with embedded terminal and verify action, the fork mechanism label, and the automatic permission opt-in that persists on the chain. Disable Start until hard blocks are cleared and warnings acknowledged. Add tests/e2e/preflight.spec.ts with an isolated project, a fake harness executable that reports local auth, and catalog fixtures covering pass, block, warning acknowledgement, trust flow, permission opt-in persistence, and keyboard operation. Do not start or render a run here.",
  "ownerAgent": "frontend-engineer",
  "dependencies": ["PRE-03", "CHAIN-06"],
  "expectedOutputs": [
    "src/web/routes/RunStartPage.tsx",
    "src/web/components/PreflightReport.tsx",
    "src/web/components/InputsForm.tsx",
    "src/web/components/TrustPanel.tsx",
    "src/web/hooks/usePreflight.ts",
    "src/web/api/preflight.ts",
    "tests/e2e/preflight.spec.ts"
  ],
  "validationCommands": [
    "npx playwright test tests/e2e/preflight.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/run-preflight.md#PRE-FR-04"],
    "acceptanceCriteria": [
      "Inputs are validated and required values block Start",
      "Blocking findings show remediation and keep Start disabled",
      "Warnings require explicit acknowledgement before Start enables",
      "The trust panel starts the terminal, verifies trust, and shows the manual fallback",
      "The permission opt-in shows the exact flags and persists on the chain after confirmation",
      "The fork mechanism is visible before Start",
      "The Playwright test drives the screen through src/web/App.tsx"
    ],
    "constraints": ["Do not start a run as a side effect of preflight", "Do not hide blocking findings behind a summary count"],
    "constraintRefs": ["docs/PRD.md#A11Y-01", "docs/PRD.md#A11Y-02", "docs/PRD.md#NFR-UX-01"],
    "references": ["docs/features/run-preflight.md#4. UI / Interaction Design", "docs/PRD.md#10.4 Preflight"]
  }
}
```

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Adapter capabilities, auth evidence, trust parsing, every preflight branch | Vitest with injected command and config readers |
| Integration | Preflight and trust endpoints | Fastify `inject` with a fake trust session and temporary config |
| Browser | Inputs, report, acknowledgement, trust panel, permission opt-in | Playwright with a fake harness executable and catalog fixture |
| Live | Real CLI presence and trust behavior | Exercised by the Run Execution live probe and the primary-journey human review |

Key test scenarios:

1. A missing skill blocks and names the step.
2. A dirty tree warns but Start remains available after acknowledgement.
3. Ambiguous Copilot auth requires acknowledgement.
4. Automatic Copilot without opt-in blocks with the exact flags.
5. Trust start sends no prompt; verify succeeds only after the config changes.
6. OpenCode fork versus Copilot handoff is reported before Start.

---

## 7. Acceptance Criteria

1. Preflight resolves all skills, inputs, CLI presence, auth evidence, trust, permissions, and session mode before a run.
2. Hard blocks disable Start; warnings require acknowledgement.
3. Copilot trust can be started, verified, or completed manually from the screen.
4. Automatic broad permissions are explicit, per-chain, and off by default.
5. No preflight path makes a paid model call or exposes a credential.
6. The report states whether fork is native or a handoff.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Does Copilot persist trust under `trustedFolders` for a directory after the interactive dialog? | Detect that key; if it does not change, verify fails and the manual fallback remains. |
| 2 | Should a dirty tree offer to stash or commit? | No; only warn and let the user proceed. |
| 3 | Should preflight run automatically on page load? | No; run on explicit action so trust prompts and expensive checks are user-initiated. |
| 4 | Should an untrusted folder block automatic Copilot if prompt-mode `--trust-folder` would work? | Yes; require persistent trust so the first interactive path and later steps are consistent. |
