# PRD: Slan

## 1. Overview

**Product Name:** Slan
**Summary:** A single-user local web application for assembling, saving, and running ordered chains of installed agent skills. Slan inventories what the selected CLI harness can load, lets the user inspect skills and build a reusable recipe, preflights the run, and executes it in a real interactive terminal.
**Target Platform:** Local Linux/macOS desktop, Node.js server on `127.0.0.1`, browser UI. OpenCode CLI 2.2.5 and GitHub Copilot CLI 1.0.105 are the v1 harnesses.
**Key Constraints:** Personal tool for one local user; no authentication or hosted mode; the chain — not the catalog — is the product; skills are model-invoked context, so Slan guarantees prompt order, not skill execution.
**Historical Sources:** [docs/IDEA.md](IDEA.md) (sharpened idea and execution-spike evidence) and [docs/research/model-inventory.json](research/model-inventory.json). These are preserved inputs and are not execution sources.

---

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-11-04 | forge-build-prd with project owner | Initial PRD authored from `docs/IDEA.md` and the interactive decisions recorded below |

---

## 3. Goals and Non-Goals

### 3.1 Goals

- Make a known-good skill sequence a saved, inspectable artifact instead of prose re-derived by a model on every run.
- Let the user author a chain from the exact skills the selected harness can load, with source visibility and full `SKILL.md` detail.
- Run each chain in a real interactive terminal, with one continuous session by default and explicit control over advancement.
- Catch missing skills, missing CLIs, authentication gaps, trust gaps, and unsupported session modes before step 1.
- Reuse a chain for a different task through named inputs without rebuilding it.
- Persist enough run state to reopen, retry, continue, or restart after a reload or crash without replaying a step silently.
- Keep the implementation small enough for one person to maintain, while keeping the domain model clean enough to share later.

### 3.2 Non-Goals

- Multi-user support, authentication, hosted or remote use, onboarding, or team collaboration.
- Authoring or editing skills inside Slan.
- Model routing or model selection per step.
- Per-step harness switching inside one chain.
- Parallel chain execution or concurrent runs.
- Full transcript capture, replay, or a logging database.
- AI-generated skill summaries or semantic skill recommendations.
- A chain template marketplace or global chain library in v1.
- Idle-heuristic auto-advance, keystroke scripting, or automatic advancement without a harness state signal or process exit.
- Generating PRDs, agent teams, builds, or other Forge artifacts from inside Slan.
- Packaging as Electron or Tauri in v1.

---

## 4. Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| Solo builder | One developer on a local machine with OpenCode and Copilot CLI installed and authenticated | Save reliable skill sequences, see what each skill does, supervise or automate a run, and recover from failures without losing context |

### 4.1 Cross-Feature User Stories

```forge-requirement
{"id":"US-01","kind":"story","text":"As the solo builder, I want to see every skill the selected harness can load, grouped by source and searchable, so that I can choose the right skill and spot collisions."}
```

```forge-requirement
{"id":"US-02","kind":"story","text":"As the solo builder, I want to turn selected skills into an ordered recipe with a required instruction per step, so that I do not retype the sequence on every run."}
```

```forge-requirement
{"id":"US-03","kind":"story","text":"As the solo builder, I want to run a chain in a live terminal and decide when each supervised step is done, so that I stay in control of an interactive CLI."}
```

```forge-requirement
{"id":"US-04","kind":"story","text":"As the solo builder, I want automatic mode to advance only on a real harness completion signal or process exit, so that long chains are not driven by guessed idle time."}
```

```forge-requirement
{"id":"US-05","kind":"story","text":"As the solo builder, I want preflight to find missing skills, CLI, authentication, trust, and permission problems before step 1, so that a chain does not collapse at step 3."}
```

```forge-requirement
{"id":"US-06","kind":"story","text":"As the solo builder, I want to reopen an interrupted run and retry, continue, or restart explicitly, so that a reload or crash does not silently replay work."}
```

```forge-requirement
{"id":"US-07","kind":"story","text":"As the solo builder, I want named chain inputs remembered between runs, so that one saved recipe can serve a different task without editing its steps."}
```

```forge-requirement
{"id":"US-08","kind":"story","text":"As a keyboard or screen-reader user, I want to author, reorder, and run chains without a mouse, so that the tool remains usable without pointer precision."}
```

---

## 5. Research Findings

- The 2026-11-04 execution spike against OpenCode 2.2.5 and Copilot CLI 1.0.105 proved that seeded prompts submit in both interactive TUIs: `opencode --prompt "<text>" <dir>` and `copilot -i "<text>"`.
- A prompted named skill loaded in both harnesses during the spike; Copilot logged `● skill(spike-skill)`, while OpenCode exposed no equivalent visible log line.
- OpenCode emits machine-readable terminal state: `OSC 7501;state=working|idle|clear` with a `ses_...` session identifier. Copilot emits no comparable semantic state, and its TUI animation makes output-idle detection unreliable.
- Cross-process session continuation worked in both harnesses. OpenCode accepts `--session ses_...`; Copilot accepts `--session-id <uuid>`. A token remembered in the first process was recalled in the second.
- Copilot's first interactive run in a folder is gated by a trust dialog. The installed CLI records trusted folders in `~/.copilot/config.json`; `--trust-folder` applies to one prompt-mode session and conflicts with `--session-id`.
- Headless Copilot chaining required `--allow-all-paths --allow-all-tools`, which is a broad permission scope that must be opted into explicitly.
- OpenCode's `run` subcommand supports `--fork`; its interactive entry point does not expose a fork flag. Copilot exposes no fork flag. Fork semantics therefore need a documented fallback.
- The current machine has no globally installed skills, only project-local skills, so project-local discovery is required from day one.
- Package versions were verified against the npm registry on 2026-11-04 rather than guessed: React 19.3.1, Vite 8.3.5, Fastify 5.12.8, node-pty 1.1.0, `@xterm/xterm` 6.0.0, Zod 4.6.7, TypeScript 7.0.2, Vitest 5.1.0, and Playwright 1.64.1.

---

## 6. Technical Architecture

### 6.1 Technology Stack

| Layer | Choice | Verified Version | Notes |
|-------|--------|------------------|-------|
| Runtime | Node.js | 24.22.2 installed; minimum 24 | Native ESM, built-in test tooling available; server-only PTY and filesystem access |
| Language | TypeScript | 7.0.2 | Strict mode across server, shared contracts, and web |
| UI | React + React DOM | 19.3.1 | Function components, no state library required for v1 |
| Bundler/dev server | Vite + `@vitejs/plugin-react` | 8.3.5 / 6.2.1 | Production build served by Fastify |
| HTTP server | Fastify | 5.12.8 | Composition root, JSON API, static assets, WebSocket upgrade |
| Static files | `@fastify/static` | 10.1.9 | Serves `dist/web` |
| WebSocket | `@fastify/websocket` (ws 8.22.1) | 11.3.6 | Terminal and run-state channels |
| PTY | `node-pty` | 1.1.0 | Server-side child processes; native build prerequisite |
| Terminal UI | `@xterm/xterm` + fit, web-links, unicode11 addons | 6.0.0 / 0.11.0 / 0.12.0 / 0.9.0 | Interactive terminal rendering |
| Validation | Zod | 4.6.7 | Config, chain, run, and API input schemas |
| Frontmatter parsing | yaml | 2.9.1 | Parse `SKILL.md` YAML frontmatter |
| Unit/integration tests | Vitest | 5.1.0 | Node environment; temporary directories for filesystem tests |
| Browser tests | Playwright | 1.64.1 | Happy-path flows against the built app |
| Server dev runner | tsx | 4.23.15 | `tsx watch` in development |
| Task runner | concurrently | 10.0.6 | Server + Vite dev processes |

### 6.2 Project Structure

```
.
├── package.json                 # scripts, dependencies, Node >=24
├── tsconfig.json                # project references / shared compiler options
├── tsconfig.server.json         # server + shared build
├── tsconfig.web.json            # web typecheck
├── vite.config.ts               # React plugin, web root, dist/web output
├── vitest.config.ts             # unit and integration test configuration
├── playwright.config.ts         # e2e web server, isolated config dir
├── index.html                   # Vite entry
├── docs/
│   ├── PRD.md
│   ├── features/                # canonical executable feature documents
│   ├── evidence/                # live harness probe reports
│   └── reviews/                 # human review evidence
├── scripts/
│   ├── live-discovery.ts
│   ├── live-execution.ts
│   └── check-docs.mjs
├── src/
│   ├── shared/                  # API envelopes, DTOs, shared schemas
│   ├── server/
│   │   ├── index.ts             # process entry
│   │   ├── app.ts               # Fastify composition root
│   │   ├── config/              # global config store
│   │   ├── projects/            # path validation and project registry
│   │   ├── catalog/             # harness discovery and merge
│   │   ├── chains/              # chain model and storage
│   │   ├── harness/             # adapter registry and capability descriptors
│   │   ├── preflight/           # checks, auth, trust
│   │   ├── terminal/            # PTY transport
│   │   ├── runs/                # run model, runners, orchestration
│   │   └── routes/              # HTTP and WebSocket route registration
│   └── web/
│       ├── main.tsx
│       ├── App.tsx              # router and layout composition root
│       ├── api/                 # typed API client
│       ├── components/
│       ├── hooks/
│       ├── routes/
│       └── styles/
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

### 6.3 Key APIs and Interfaces

| Interface | Purpose |
|-----------|---------|
| `GET /api/health` | Server status, version, config directory, active run summary |
| `GET /api/fs?path=` | Directory listing for the server-side folder browser |
| `POST /api/projects` | Open an existing project or create a new folder with optional `git init` |
| `GET /api/projects/recent` | Recent projects from global config, newest first |
| `DELETE /api/projects/recent/:projectId` | Remove a recent entry without touching the filesystem |
| `GET /api/projects/:projectId/catalog?harness=&q=` | Merged, grouped skill catalog with source badges and warnings |
| `GET /api/projects/:projectId/chains` | List chains in the project |
| `POST/PUT/DELETE /api/projects/:projectId/chains...` | Chain create, read, update, duplicate, and delete |
| `POST /api/projects/:projectId/preflight` | Structured preflight report for a chain, harness, inputs, and mode |
| `POST /api/projects/:projectId/trust` | Start or verify the Copilot folder-trust flow |
| `POST /api/projects/:projectId/runs` | Snapshot a chain and create a run |
| `GET /api/runs/:runId` | Recorded run state and per-step status |
| `POST /api/runs/:runId/actions` | Next, retry, skip, abort, pause, resume, continue, or restart |
| `WS /api/runs/:runId/events` | Run and step state events |
| `WS /api/runs/:runId/terminal` | PTY input/output/resize stream |

All API failures use `{"error":{"code":"...","message":"...","details":{...}}}`. IDs are stable, repository-scoped strings; project ids are derived from registered canonical paths, not from arbitrary client-supplied paths.

### 6.4 Execution Model

- **Supervised mode (default):** each step starts a fresh harness CLI process in the same PTY with the run's session id and seeded prompt; the live TUI is visible; the user marks the step Done, Failed, or Skipped and presses Next, Retry, Skip, or Abort. Slan does not inject keystrokes into a running TUI.
- **Automatic OpenCode:** the step runs in a PTY, Slan observes the terminal stream for `OSC 7501;state=working` then `state=idle`, and only `state=idle` advances. The next step restarts the CLI with the same session id.
- **Automatic Copilot:** each step runs one headless process with a shared session id and explicit broad-permission opt-in, and advances on process exit. Preflight resolves trust before step 1 because a prompt queued during the trust dialog can be swallowed.
- **Sessions:** `shared` reuses one session id; `fresh` creates a new id per step; `fork` uses OpenCode `run --fork` where available and otherwise starts a new session with a deterministic handoff note built from the previous step's label, instruction, status, and bounded terminal tail. Preflight states which mechanism applies.
- **Failure policy:** any failed step, non-zero exit, timeout waiting for a completion signal, or ambiguous state pauses the run. Retry, Skip, and Abort are explicit; nothing auto-continues through failure.
- **Snapshot:** a run freezes the chain definition and resolved inputs at creation. Editing the saved chain never changes an in-flight or recorded run.

### 6.5 Architecture Constraints

```forge-requirement
{"id":"ARCH-01","kind":"constraint","text":"Slan is a single-user local application. The server binds only to 127.0.0.1, refuses non-loopback addresses, has no authentication in v1, and must never be exposed to a network or remote host."}
```

```forge-requirement
{"id":"ARCH-02","kind":"constraint","text":"Use the verified Node 24, TypeScript, React, Vite, Fastify, node-pty, xterm.js, Zod, Vitest, and Playwright versions recorded in section 6.1; do not silently substitute deprecated or unverified major versions."}
```

```forge-requirement
{"id":"ARCH-03","kind":"constraint","text":"The server owns all filesystem traversal, config/chain/run persistence, CLI process spawning, and PTY handling. The browser performs no shell execution and receives only typed API and WebSocket data."}
```

```forge-requirement
{"id":"ARCH-04","kind":"constraint","text":"Persist configuration, chains, and runs as versioned JSON files with atomic temp-file replacement. Do not introduce a database or a second persistence model in v1."}
```

```forge-requirement
{"id":"ARCH-05","kind":"constraint","text":"Every server route registers through src/server/app.ts, every web route mounts through src/web/App.tsx, and every new user-facing capability must be reachable through those composition roots with a test that exercises it there."}
```

```forge-requirement
{"id":"EXEC-01","kind":"constraint","text":"Skills are model-invoked context, not callable commands. Slan guarantees deterministic prompt order only; the UI must state that a harness may decline to load a named skill."}
```

```forge-requirement
{"id":"EXEC-02","kind":"constraint","text":"Automatic advancement is allowed only on OpenCode OSC 7501 state=idle after state=working, or on Copilot process exit. Output-idle heuristics, animation quiescence, and fixed sleeps must not advance a chain."}
```

```forge-requirement
{"id":"EXEC-03","kind":"constraint","text":"At most one run may be active across the whole Slan server. A second start request must fail with a conflict while a run is starting, running, paused, or awaiting user input."}
```

```forge-requirement
{"id":"EXEC-04","kind":"constraint","text":"A chain is bound to exactly one harness. Per-step harness switching, per-step model selection, and model routing are out of scope for v1."}
```

```forge-requirement
{"id":"EXEC-05","kind":"constraint","text":"Preflight hard-blocks unresolved skills, missing or unauthenticated harness CLIs, unresolved Copilot trust, unresolved inputs, and unsupported session modes. A dirty git tree is a warning, not a block."}
```

```forge-requirement
{"id":"EXEC-06","kind":"constraint","text":"Automatic Copilot runs may pass broad permission flags only after an explicit per-chain opt-in; the exact flags and scope must be shown at preflight and on every automatic run."}
```

```forge-requirement
{"id":"EXEC-07","kind":"constraint","text":"Supervised step transitions restart the harness CLI in the same PTY with a documented session flag and seeded prompt. Do not script keystrokes into a live TUI."}
```

```forge-requirement
{"id":"EXEC-08","kind":"constraint","text":"A run records an immutable snapshot of the chain and resolved inputs. Later edits to the saved chain must not alter the run, and retry must use the snapshot."}
```

---

## 7. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-PERF-01 | Catalog scan completes within 3 seconds for up to 500 skills on the local machine. | Should |
| NFR-PERF-02 | Preflight completes within 5 seconds excluding a user-driven trust dialog; UI actions acknowledge within 200 ms. | Should |
| NFR-REL-01 | Config, chain, and run writes are crash-safe; interrupted runs are marked rather than silently resumed. | Must |
| NFR-REL-02 | PTY processes, WebSocket subscribers, and child processes are cleaned up on close, error, and server shutdown. | Must |
| NFR-UX-01 | Every screen has explicit loading, empty, and error states; destructive actions require confirmation. | Must |
| NFR-COMPAT-01 | Harness-specific behavior is isolated behind adapters so a CLI flag change is a localized fix. | Must |
| NFR-MAINT-01 | Typecheck and the focused test suites pass from a clean install with documented commands. | Must |

### 7.1 Canonical NFR Constraints

```forge-requirement
{"id":"NFR-PERF-01","kind":"constraint","text":"Catalog discovery and merge must complete within 3 seconds for up to 500 skills on the local machine; exceeding the budget is reported as a warning rather than hiding entries."}
```

```forge-requirement
{"id":"NFR-PERF-02","kind":"constraint","text":"Preflight must return within 5 seconds when no user-driven trust dialog is open. UI actions must show an acknowledged state within 200 ms even when the server is still working."}
```

```forge-requirement
{"id":"NFR-REL-01","kind":"constraint","text":"Use atomic writes for config, chain, and run JSON. On server startup, mark records that were active as interrupted instead of assuming completion."}
```

```forge-requirement
{"id":"NFR-REL-02","kind":"constraint","text":"Close PTY processes, WebSocket subscriptions, and child processes on disconnect, error, run completion, and SIGINT/SIGTERM; never leave an orphan harness process attached to a finished run."}
```

```forge-requirement
{"id":"NFR-UX-01","kind":"constraint","text":"Each screen exposes loading, empty, and error states. Delete, abort, restart, and trust actions require explicit confirmation and state the consequence."}
```

```forge-requirement
{"id":"NFR-COMPAT-01","kind":"constraint","text":"All harness-specific commands, flags, discovery formats, state parsing, and trust behavior live behind the adapter contract; route and UI code must not branch on harness names."}
```

```forge-requirement
{"id":"NFR-MAINT-01","kind":"constraint","text":"A clean checkout must support documented install, development, build, start, typecheck, unit/integration, e2e, and live-probe commands without undocumented global tooling."}
```

---

## 8. Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| SEC-01 | Spawn CLI processes with argument arrays and no shell interpolation; canonicalize every path before use. | Must |
| SEC-02 | Never read, persist, or log credentials or tokens; report only whether authentication evidence exists. | Must |
| SEC-03 | Treat terminal output and `SKILL.md` content as untrusted text; render through xterm or escaped React text, never raw HTML. | Must |
| SEC-04 | The server refuses non-loopback binding and provides no remote-access feature. | Must |
| SEC-05 | Slan sends no telemetry or application data off the machine. | Must |
| PRIV-01 | Persist only config, chain definitions, run metadata, and a bounded terminal tail. | Must |
| PRIV-02 | Remove a recent project without deleting project files; deleting a chain is an explicit project-local operation. | Must |

### 8.1 Canonical Security Constraints

```forge-requirement
{"id":"SEC-01","kind":"constraint","text":"Spawn harness CLIs with an executable plus argument array and no shell string interpolation. Canonicalize project and chain paths with realpath and reject traversal outside the intended project data directory."}
```

```forge-requirement
{"id":"SEC-02","kind":"constraint","text":"Never read credential values, copy tokens, or log environment secrets. Authentication checks may inspect command output, credential-file presence, and environment-variable presence, but must redact values."}
```

```forge-requirement
{"id":"SEC-03","kind":"constraint","text":"Render terminal bytes only through xterm.js and render skill text through escaped React text. Do not use dangerouslySetInnerHTML for harness, skill, or run content."}
```

```forge-requirement
{"id":"SEC-04","kind":"constraint","text":"Bind the Fastify server to 127.0.0.1 by default and reject any configured host that is not a loopback address. There is no authentication because there is no remote access."}
```

```forge-requirement
{"id":"SEC-05","kind":"constraint","text":"Slan must not add analytics, crash reporting, remote logging, or outbound application requests. Only the user-invoked harness CLI and package installation may use the network."}
```

```forge-requirement
{"id":"PRIV-01","kind":"constraint","text":"Persist configuration in the Slan config directory, chains and runs under the project .slan directory, and at most a 200-line or 32 KiB terminal tail per step. Never persist full transcripts."}
```

```forge-requirement
{"id":"PRIV-02","kind":"constraint","text":"Removing a recent project removes only the recent-entry record. Chain deletion touches only the selected chain file inside the project's .slan/chains directory."}
```

### 8.2 Risk Acceptance

The folder browser can list any readable absolute directory, including outside `$HOME`, because the owner explicitly chose no browse restriction. This is accepted only because the server is loopback-only and single-user; the UI must display a persistent local-only notice, and the server must refuse a non-loopback bind even if configured.

---

## 9. Accessibility

| ID | Requirement | Priority |
|----|-------------|----------|
| A11Y-01 | All authoring and run controls are operable by keyboard alone. | Must |
| A11Y-02 | Focus is visible, focus order is logical, controls have labels, and status changes are announced. | Must |
| A11Y-03 | Step and run status is conveyed by text and icon, never color alone. | Must |
| A11Y-04 | The terminal offers xterm screen-reader mode and a documented way to focus and leave it. | Must |

### 9.1 Canonical Accessibility Constraints

```forge-requirement
{"id":"A11Y-01","kind":"constraint","text":"Every authoring action, including adding, removing, reordering, saving, preflight, and run control, must be reachable and executable with the keyboard alone, with move-up/move-down alternatives to drag-and-drop."}
```

```forge-requirement
{"id":"A11Y-02","kind":"constraint","text":"Provide visible focus indicators, semantic labels, a skip link, logical focus order, and aria-live announcements for step transitions, preflight results, and run state."}
```

```forge-requirement
{"id":"A11Y-03","kind":"constraint","text":"Status must be readable as text or icon plus text; color must not be the only differentiator for pending, running, done, failed, skipped, or interrupted."}
```

```forge-requirement
{"id":"A11Y-04","kind":"constraint","text":"Enable xterm.js screen-reader mode, expose a labeled terminal region, and provide a keyboard method to move focus into and out of the terminal without trapping it."}
```

---

## 10. System States / Lifecycle

### 10.1 Project

- `none` → no project selected; show recent projects and browser.
- `selected` → canonical project path registered; show chain library, catalog, and new-chain action.
- `invalid` → path missing, not a directory, or unreadable; show the error and keep the previous project selected.

### 10.2 Catalog

- `idle` → no harness selected.
- `loading` → discovery in progress; show skeleton and allow cancellation by navigation.
- `ready` → grouped entries; warnings displayed without hiding results.
- `error` → harness discovery failed; show the command, exit code, and retry action.

### 10.3 Chain Draft

- `clean` → saved state matches the editor.
- `dirty` → unsaved edits; navigation prompts for confirmation.
- `invalid` → schema or placeholder errors; save disabled with field-level messages.
- `saving` → atomic write in progress; controls disabled briefly.
- `saved` → persisted; updated timestamp shown.

### 10.4 Preflight

- `idle` → form ready.
- `running` → checks in progress.
- `pass` → no hard blocks; Start enabled.
- `warn` → warnings only; Start enabled with warning acknowledgement.
- `blocked` → at least one hard block; Start disabled with remediation.
- `trust-required` → Copilot trust flow available or manual fallback shown.

### 10.5 Run

- `starting` → snapshot written, PTY spawning.
- `running` → step process active.
- `awaiting-user` → supervised step needs Done/Failed/Skipped and Next/Retry/Skip/Abort.
- `paused` → automatic mode paused by the user or after a failure.
- `failed` → current step failed; retry/skip/abort offered.
- `completed` → all steps done or skipped; record final.
- `aborted` → user stopped the run; current process terminated.
- `interrupted` → server restarted or PTY lost; retry/continue/restart offered, never auto-replay.

### 10.6 Step

`pending` → `running` → `done` | `failed` | `skipped`, with `interrupted` when the process is lost. A skipped step records why and does not run.

---

## 11. Analytics and Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Real saved chain executed end-to-end | A 3+ step chain completed twice within one week of building | Run records under `.slan/runs/` plus the owner's log |
| Reuse without rebuilding | The same chain edited and re-run for a different task using inputs | Run records showing the same chain id with different resolved inputs |
| Authoring speed | Authoring a 3-step chain is faster than typing the same prompts by hand | Owner timing during the acceptance review |
| Kill signal | If the owner still opens a terminal and types the sequence instead of using Slan, v1 has failed | Owner decision recorded in the acceptance review |
| Preflight effectiveness | No chain reaches step 2 with a skill that was missing at step 1 | Review of failed-run records and review notes |

No telemetry is collected. These signals are evaluated from local run records and human review evidence.

---

## 12. Dependencies and Risks

### 12.1 Dependencies

- OpenCode CLI 2.2.5 installed and authenticated for the selected provider.
- GitHub Copilot CLI 1.0.105 installed and authenticated for Copilot runs.
- Node.js 24+, npm, and a working native toolchain for `node-pty`.
- A local browser with WebSocket support.
- Project-local or global `SKILL.md` packages in harness-recognized directories.
- The user's chosen project directories and git availability for the optional `git init` and dirty-tree warning.

### 12.2 Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Harness flags or output formats change | Discovery, session continuation, or advancement breaks | Adapter isolation, live probe scripts, preflight version reporting, localized fixes |
| Skills do not actually fire | A step runs without the intended skill | State the limitation in the UI, best-effort observation indicator, acceptance review with a real skill token |
| Copilot trust cannot be set programmatically | First interactive run stalls or swallows the prompt | Trust detection from config, launched trust session, manual fallback, preflight hard block |
| Copilot automatic permissions are broad | Unintended file or shell access | Explicit per-chain opt-in, show exact flags at preflight and run start, default off |
| OpenCode approval prompt keeps `state=working` | Automatic run waits indefinitely | Bounded timeout pauses the run; supervised mode remains the portable path |
| `node-pty` native build fails | No terminal execution | Document build prerequisites and fail installation with a clear message |
| Full filesystem browsing on a loopback server | Local process or browser tab can read directory names | Accepted single-user risk, no auth by design, persistent local-only notice, no remote bind |
| Fork semantics differ by harness | A "fork" is not a true copy on Copilot or interactive OpenCode | Native fork where supported, deterministic handoff note elsewhere, preflight states the mechanism |
| Terminal tail contains sensitive output | Local run records leak information to the repo | Bounded tail, `runs/` ignored by default, no full transcript, user can delete runs |

---

## 13. Future Considerations

- Electron or Tauri packaging once the workflow is proven.
- A global chain library so recipes can follow the user across projects.
- Deliberate worktree support for concurrent or isolated runs.
- Per-step model or agent selection, if harnesses expose stable flags.
- Approval-prompt detection and richer skill-firing verification.
- Run comparison and transcript replay, only if the no-transcript policy is revisited.
- Import/export of chains between machines.

---

## 14. Features

| # | Feature | File | Dependencies | Priority |
|---|---------|------|--------------|----------|
| 1 | App Foundation | [docs/features/app-foundation.md](features/app-foundation.md) | None | Must |
| 2 | Project Workspace | [docs/features/project-workspace.md](features/project-workspace.md) | App Foundation | Must |
| 3 | Skill Catalog | [docs/features/skill-catalog.md](features/skill-catalog.md) | App Foundation, Project Workspace | Must |
| 4 | Chain Authoring | [docs/features/chain-authoring.md](features/chain-authoring.md) | App Foundation, Project Workspace, Skill Catalog | Must |
| 5 | Run Preflight | [docs/features/run-preflight.md](features/run-preflight.md) | App Foundation, Project Workspace, Skill Catalog, Chain Authoring | Must |
| 6 | Run Execution | [docs/features/run-execution.md](features/run-execution.md) | App Foundation, Project Workspace, Chain Authoring, Run Preflight | Must |
| 7 | V1 Acceptance | [docs/features/v1-acceptance.md](features/v1-acceptance.md) | App Foundation, Project Workspace, Skill Catalog, Chain Authoring, Run Preflight, Run Execution | Must |

### Feature Dependency Graph

```
App Foundation
├── Project Workspace
│   ├── Skill Catalog
│   │   └── Chain Authoring
│   │       └── Run Preflight
│   │           └── Run Execution
│   └── (project data used by all later features)
└── V1 Acceptance (requires every feature)
```

---

## 15. Glossary

| Term | Definition |
|------|------------|
| Chain | An ordered list of steps bound to one harness, with a name, optional inputs, and a session mode. |
| Step | One skill name, a required instruction, an optional label, and a stable id. |
| Run | One execution of a chain snapshot against one project in supervised or automatic mode. |
| Session | A harness conversation identifier reused across steps according to the chain's session mode. |
| Supervised mode | A run where each step starts a CLI in the same PTY and the user confirms Done/Failed/Skipped and advances. |
| Automatic mode | A run that advances on OpenCode `state=idle` or Copilot process exit, with Pause and Run-next controls. |
| Preflight | The blocking and warning checks performed before a run starts. |
| Handoff note | Deterministic text built from a previous step's metadata and bounded terminal tail when a native fork is unavailable. |
| Bounded tail | At most 200 lines or 32 KiB of terminal output retained per step. |
| Source badge | A visible label identifying project, personal, plugin, custom, builtin, or Slan-extra origin. |

---

## 16. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Does any OpenCode configuration expose additional skill directories beyond the project and `~/.config/opencode/skills` paths? | Only those native paths plus Slan-configured extra directories are scanned; add more when discovered. |
| 2 | Does an OpenCode approval prompt keep the terminal at `state=working`, and can automatic mode distinguish it from a long turn? | Treat it as working until a bounded timeout pauses the run; supervised mode is the safe path. |
| 3 | Is Copilot folder trust always persisted in `~/.copilot/config.json` after the interactive dialog? | Detect the `trustedFolders` entry; if absent after the trust session, hard-block with the manual command. |
| 4 | Can Copilot authentication be determined reliably without a paid prompt? | Use env-token presence and local config evidence; if ambiguous, require explicit acknowledgement. |
| 5 | Does OpenCode `run --fork` preserve enough state for a practical fork? | Use native fork only in automatic OpenCode and label it; verify in the live execution task. |
| 6 | Should Slan warn when a skill was not observed firing? | Show a best-effort indicator only; never block or fail a step on it. |
| 7 | Is the three-screen layout the right visual feel? | Three routed screens with a terminal-dominant run view; revisit only after real use. |
| 8 | Should chains ever follow the user across projects? | No in v1; project-local `.slan/chains` is intentional. |
| 9 | Is Electron/Tauri packaging worth it? | No packaging in v1; run from source with npm scripts. |
