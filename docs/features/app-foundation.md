# Feature: App Foundation

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| US-03 | [Vision](../PRD.md#US-03) | participates |
| US-08 | [Vision](../PRD.md#US-08) | participates |
| FOUND-FR-01 | This feature | owns |
| FOUND-FR-02 | This feature | owns |
| FOUND-FR-03 | This feature | owns |
| FOUND-FR-04 | This feature | owns |
| FOUND-FR-05 | This feature | owns |
| FOUND-FR-06 | This feature | owns |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** App Foundation
**ID Prefix:** FOUND
**Summary:** Establish the runnable local application: TypeScript build, npm scripts, configuration store, Fastify composition root, React shell, and the PTY/WebSocket transport every later feature depends on.
**Dependencies:** None
**Priority:** Must

The foundation is complete when a clean install can typecheck, build, start one loopback server, load the routed React shell, exchange JSON through the shared error envelope, and stream a real PTY over WebSocket.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| FOUND-US-01 | solo builder | start one local command and open the app in a browser | I do not manage separate server and UI processes in production | Must |
| FOUND-US-02 | solo builder | have my harness paths, extra skill directories, and recent projects remembered | I do not re-enter local configuration on every launch | Must |
| FOUND-US-03 | solo builder | see truthful loading and failure states | I can tell an empty catalog from a broken server | Must |

---

## 3. Functional Requirements

```forge-requirement
{"id":"FOUND-FR-01","kind":"requirement","text":"Provide a single local Node 24 server that binds 127.0.0.1, serves the built React UI and JSON API, exposes WebSocket endpoints, and shuts down cleanly on SIGINT and SIGTERM."}
```

```forge-requirement
{"id":"FOUND-FR-02","kind":"requirement","text":"Load and persist user configuration in $SLAN_CONFIG_DIR when set, otherwise ~/.config/slan/config.json, validating a versioned schema and writing atomically; expose harness command paths, extra skill directories, recent projects, and UI preferences."}
```

```forge-requirement
{"id":"FOUND-FR-03","kind":"requirement","text":"Expose GET /api/health returning status, version, config directory, and active-run summary, and return a consistent JSON error envelope with error.code, error.message, and optional error.details for every API failure."}
```

```forge-requirement
{"id":"FOUND-FR-04","kind":"requirement","text":"Build a React shell with routes for projects, chain authoring, run start, and run view, including a skip link, visible keyboard focus, semantic landmarks, and an aria-live status region."}
```

```forge-requirement
{"id":"FOUND-FR-05","kind":"requirement","text":"Provide npm scripts for development, production build, start, typecheck, Vitest unit and integration tests, Playwright browser tests, and live harness probes; the production server serves the built UI from one origin."}
```

```forge-requirement
{"id":"FOUND-FR-06","kind":"requirement","text":"Provide a server-side PTY transport that streams terminal output and accepts input and resize messages over WebSocket, permits one active subscriber per PTY, and terminates the child process and socket when the session closes."}
```

| ID | Priority |
|----|----------|
| FOUND-FR-01 | Must |
| FOUND-FR-02 | Must |
| FOUND-FR-03 | Must |
| FOUND-FR-04 | Must |
| FOUND-FR-05 | Must |
| FOUND-FR-06 | Must |

---

## 4. UI / Interaction Design

The shell uses a persistent header with the Slan wordmark, the current project name when one is selected, a local-only badge, and a status region. Routes are `/projects`, `/projects/:projectId/chains/:chainId`, `/projects/:projectId/chains/:chainId/run`, and `/runs/:runId`. The initial route redirects to `/projects`.

The visual language is a dark, high-contrast terminal-adjacent theme. Every interactive element has a visible `:focus-visible` treatment. Buttons use text labels, not icon-only controls, unless an accessible name and tooltip are both present. The skip link targets the main landmark. The status region is polite by default and assertive only for run failures.

A failed API call renders an inline error panel with the server's message and a Retry action. A missing route renders a not-found panel with a link back to projects. The shell never blocks navigation on an in-flight request.

---

## 5. Implementation Tasks

### Phase 1: Skeleton, Configuration, and Server

```forge-task
{
  "id": "FOUND-01",
  "title": "Initialize the TypeScript application scaffold",
  "description": "Create the single-package TypeScript application from the project structure in the PRD. Add npm scripts for dev, build, start, typecheck, unit/integration Vitest, Playwright, live discovery, live execution, and docs checking. Pin the verified dependency versions from PRD section 6.1, configure strict TypeScript for server and web, configure Vite with the React plugin and dist/web output, configure Vitest for tests/unit and tests/integration, and configure Playwright to start the app with an isolated SLAN_CONFIG_DIR. Add tests/unit/build-config.test.ts asserting the required scripts, Node engine floor, and dependency majors. Do not implement application routes, config loading, or UI components in this task.",
  "ownerAgent": "platform-engineer",
  "dependencies": [],
  "expectedOutputs": [
    "package.json",
    "tsconfig.json",
    "tsconfig.server.json",
    "tsconfig.web.json",
    "vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
    "index.html",
    ".gitignore",
    "tests/unit/build-config.test.ts"
  ],
  "validationCommands": [
    "npm run typecheck",
    "npx vitest run tests/unit/build-config.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/app-foundation.md#FOUND-FR-05"],
    "acceptanceCriteria": [
      "npm run typecheck passes for the server and web projects",
      "The build-config test asserts dev, build, start, typecheck, test, test:e2e, test:live:discovery, test:live:execution, and check scripts",
      "package.json declares Node >=24 and the verified React, Vite, Fastify, node-pty, xterm, Zod, Vitest, and Playwright versions",
      "Playwright is configured to launch the app with an isolated config directory"
    ],
    "constraints": ["Do not add application behavior beyond the scaffold and its contract test"],
    "constraintRefs": ["docs/PRD.md#ARCH-02", "docs/PRD.md#NFR-MAINT-01"],
    "references": ["docs/PRD.md#6. Technical Architecture", "docs/PRD.md#6.2 Project Structure"]
  }
}
```

```forge-task
{
  "id": "FOUND-02",
  "title": "Implement the global configuration store",
  "description": "Implement the versioned global configuration module. Resolve the config directory from SLAN_CONFIG_DIR or ~/.config/slan, default to a schema with harness command paths, extra skill directories, recent projects, and UI preferences, and create the file on first read. Validate with Zod, reject unknown top-level versions, write through a temporary file plus rename, and expose typed get/update helpers for later features. Authentication values must never be stored. Cover missing file, corrupt file, atomic update, environment override, and unknown-version cases in tests/unit/config.test.ts. Do not implement project registration or skill discovery here.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["FOUND-01"],
  "expectedOutputs": [
    "src/server/config/schema.ts",
    "src/server/config/store.ts",
    "tests/unit/config.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/config.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/app-foundation.md#FOUND-FR-02"],
    "acceptanceCriteria": [
      "SLAN_CONFIG_DIR overrides the default path and is honored by every store operation",
      "A missing file produces the documented defaults and a created file",
      "A corrupt file returns a typed error without overwriting the user's file",
      "Writes are atomic and preserve unrelated fields",
      "Tests assert that credential-like fields are not part of the schema"
    ],
    "constraints": ["Do not log config file contents", "Do not add a database or remote config source"],
    "constraintRefs": ["docs/PRD.md#ARCH-04", "docs/PRD.md#SEC-02", "docs/PRD.md#PRIV-01"],
    "references": ["docs/PRD.md#6. Technical Architecture", "docs/PRD.md#8. Security and Privacy"]
  }
}
```

```forge-task
{
  "id": "FOUND-03",
  "title": "Build the Fastify composition root and health API",
  "description": "Create src/server/app.ts as the composition root and src/server/index.ts as the process entry. Build a Fastify instance that refuses a non-loopback host, serves dist/web in production, registers a route plugin in src/server/routes/index.ts, and exposes GET /api/health with status, package version, config directory, and active-run summary placeholder. Define the shared API envelope and error types in src/shared/api.ts, and install a not-found and error handler that always returns the envelope. Add graceful shutdown for SIGINT and SIGTERM. Add tests/integration/server.test.ts using Fastify inject to assert health, envelope shape, non-loopback refusal, and static fallback behavior. Do not add project, catalog, chain, preflight, or run routes yet.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["FOUND-01", "FOUND-02"],
  "expectedOutputs": [
    "src/server/app.ts",
    "src/server/index.ts",
    "src/server/routes/index.ts",
    "src/server/routes/health.ts",
    "src/shared/api.ts",
    "tests/integration/server.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/integration/server.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/app-foundation.md#FOUND-FR-01", "docs/features/app-foundation.md#FOUND-FR-03"],
    "acceptanceCriteria": [
      "The app binds or is injectable on 127.0.0.1 and rejects a non-loopback host",
      "GET /api/health returns the documented fields through src/server/app.ts",
      "Unknown routes and thrown errors both return the shared error envelope",
      "SIGINT and SIGTERM close the server without leaving handles open",
      "The integration test exercises the route through the composition root"
    ],
    "constraints": ["Do not expose a network-facing listener", "Do not add a second HTTP framework"],
    "constraintRefs": ["docs/PRD.md#ARCH-01", "docs/PRD.md#ARCH-03", "docs/PRD.md#ARCH-05", "docs/PRD.md#SEC-04"],
    "references": ["docs/PRD.md#6.3 Key APIs and Interfaces", "docs/PRD.md#6. Technical Architecture"]
  }
}
```

### Phase 2: Web Shell and Terminal Transport

```forge-task
{
  "id": "FOUND-04",
  "title": "Build the routed React shell and API client",
  "description": "Create the Vite entry, React router, app layout, theme, typed API client, error boundary, status region, and placeholder route components for projects, chain authoring, run start, and run view. The layout must include a skip link, header with local-only badge, main landmark, and aria-live region. The API client must decode the shared error envelope and expose typed health calls. Add tests/e2e/shell.spec.ts covering direct route loads, the skip link, the local-only notice, a raw API failure rendered as an inline error, and a not-found route. Do not implement project, chain, catalog, or run business behavior.",
  "ownerAgent": "frontend-engineer",
  "dependencies": ["FOUND-03"],
  "expectedOutputs": [
    "src/web/main.tsx",
    "src/web/App.tsx",
    "src/web/api/client.ts",
    "src/web/components/AppLayout.tsx",
    "src/web/components/StatusRegion.tsx",
    "src/web/routes/ProjectsPage.tsx",
    "src/web/routes/ChainBuilderPage.tsx",
    "src/web/routes/RunStartPage.tsx",
    "src/web/routes/RunPage.tsx",
    "src/web/routes/NotFoundPage.tsx",
    "src/web/styles/theme.css",
    "tests/e2e/shell.spec.ts"
  ],
  "validationCommands": [
    "npx playwright test tests/e2e/shell.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/app-foundation.md#FOUND-FR-04"],
    "acceptanceCriteria": [
      "Every route renders through src/web/App.tsx without a console error",
      "The skip link moves focus to the main landmark",
      "The local-only badge is visible on every route",
      "The aria-live status region announces an API failure",
      "The not-found route offers a keyboard-reachable path back to projects",
      "The Playwright test exercises the shell through the real server and built app"
    ],
    "constraints": ["Do not add a client-side state library", "Do not render raw HTML from server data"],
    "constraintRefs": ["docs/PRD.md#ARCH-05", "docs/PRD.md#A11Y-01", "docs/PRD.md#A11Y-02", "docs/PRD.md#SEC-03"],
    "references": ["docs/features/app-foundation.md#4. UI / Interaction Design"]
  }
}
```

```forge-task
{
  "id": "FOUND-05",
  "title": "Implement the PTY WebSocket transport",
  "description": "Create the server-side terminal transport with node-pty. Spawn a command from an executable plus argument array, stream output as WebSocket messages, accept input and resize messages, cap buffered output per session, and terminate the child and socket on close or error. Register the WebSocket route through src/server/app.ts and expose a typed TerminalSession interface for later runners. Add tests/unit/pty.test.ts using a short node process and tests/integration/terminal-ws.test.ts using a real WebSocket client to assert output, resize, client input, cleanup, and one-subscriber enforcement. Do not implement run orchestration or the xterm view here.",
  "ownerAgent": "backend-engineer",
  "dependencies": ["FOUND-03"],
  "expectedOutputs": [
    "src/server/terminal/pty.ts",
    "src/server/routes/terminal.ts",
    "src/server/app.ts",
    "tests/unit/pty.test.ts",
    "tests/integration/terminal-ws.test.ts"
  ],
  "validationCommands": [
    "npx vitest run tests/unit/pty.test.ts tests/integration/terminal-ws.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": ["docs/features/app-foundation.md#FOUND-FR-06"],
    "acceptanceCriteria": [
      "The unit test observes stdout from a spawned node process through the session interface",
      "The integration test connects through the registered WebSocket route",
      "Resize and input messages reach the PTY",
      "Closing the socket terminates the child process",
      "A second subscriber is rejected without disturbing the active one"
    ],
    "constraints": ["Never build a shell command string from user input", "Do not use the web client to spawn processes"],
    "constraintRefs": ["docs/PRD.md#ARCH-03", "docs/PRD.md#SEC-01", "docs/PRD.md#NFR-REL-02"],
    "references": ["docs/PRD.md#6.4 Execution Model", "docs/PRD.md#6.3 Key APIs and Interfaces"]
  }
}
```

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Config schema, PTY wrapper, build configuration | Vitest with temporary `SLAN_CONFIG_DIR` and a short-lived node child process |
| Integration | Fastify composition root, health API, WebSocket route | Fastify `inject` plus a real WebSocket client on an ephemeral port |
| Browser | Shell routing, skip link, status region, error rendering | Playwright against the real dev server with an isolated config directory |
| Human | None in this feature | Covered by the V1 Acceptance human reviews |

Key test scenarios:

1. A missing config file is created with defaults; a corrupt config returns an error and remains untouched.
2. A non-loopback host is refused before listen.
3. `/api/health` returns the shared envelope shape through `src/server/app.ts`.
4. A PTY streams a node process's output and is killed when the socket closes.
5. The shell loads every route directly and announces an API failure.

---

## 7. Acceptance Criteria

1. A clean `npm install`, `npm run typecheck`, `npm run build`, and `npm start` produce one loopback server that serves the shell.
2. Configuration is versioned, validated, atomic, and isolated by `SLAN_CONFIG_DIR`.
3. The health API and every failure use the shared JSON envelope.
4. The React shell exposes all four routes with accessible landmarks, focus, and status announcements.
5. A real PTY can be streamed over WebSocket and is cleaned up on close.
6. No later feature needs to alter the composition roots to become reachable.

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should the default port be configurable by environment or by config file? | Use `SLAN_PORT` with default 7373; expose it in the health response. |
| 2 | Should the production server compress static assets? | Add `@fastify/compress` only if measured payloads require it; not in v1 scaffold. |
| 3 | Should a browser tab opening a non-loopback hostname be rejected? | The server binds loopback, so the UI is reachable only through localhost in v1. |
