---
id: ADR-0011
applies_to:
  - "src/server/terminal/pty.ts"
  - "src/server/runs/orchestrator.ts"
  - "src/server/preflight/auth.ts"
  - "src/server/catalog/copilot.ts"
  - "src/server/projects/registry.ts"
status: Accepted
---

# ADR-0011: Spawn harnesses without a shell and keep PTYs server-owned

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** ARCH-02 and SEC-05 required a server-owned execution boundary with no browser shell access.

## Agent Rules

- **MUST:** Spawn every child process with an executable and an argument array, `shell: false`, and an explicit working directory.
- **MUST:** Create PTY sessions only in the server and attach the browser through the typed terminal WebSocket; the browser may send input and resize only.
- **MUST:** Give each PTY one active subscriber and bound input size and retained output.
- **MUST NOT:** Build a command string from prompts, skill text, project paths, or user input, or let the browser choose an executable.
- **MUST NOT:** Terminate a run PTY when the browser detaches; the orchestrator owns its lifecycle.

## Verify

- **Check:** `npx vitest run tests/unit/pty.test.ts tests/unit/supervised-runner.test.ts tests/unit/automatic-runner.test.ts`
- **Expected:** All suites pass, including single-subscriber rejection, bounded output, detach-without-termination for run terminals, and shell-free spawn assertions. Run `grep -RIn "shell: true" src/server`; it must produce no output.

## Context and Problem Statement

Skill Loom launches agent CLIs that can read files and run tools, and it relays their interactive terminal to a browser. Should the browser own process creation and shell composition, or should the server own a narrow, typed execution surface?

## Decision Drivers

- Prompts, skill names, and project paths are untrusted text from the UI.
- A shell string creates injection and quoting hazards.
- The browser must not be able to spawn arbitrary programs.
- Interactive harnesses need a real PTY, not a pipe, and a reload should be able to reattach.
- Terminal output must remain raw text and never become HTML.

## Considered Options

- Server-owned shell-free spawn plus a typed PTY WebSocket.
- Browser sends shell command strings to the server.
- Browser connects directly to a local harness port.

## Decision Outcome

Chosen option: "Server-owned shell-free spawn plus a typed PTY WebSocket", because it keeps execution authority on the server and makes the browser a constrained terminal client.

### Positive Consequences

- Prompts and paths are passed as argv entries, not interpreted by a shell.
- The browser cannot choose an executable or working directory.
- PTYs survive a browser detach and are closed by the run lifecycle.
- Terminal output is streamed as bytes to the single control-channel subscriber (`skill-loom run attach`).

### Negative Consequences

- The server must implement PTY lifecycle, backpressure, and subscriber limits.
- A browser detach leaves the process running until the run completes or is aborted.
- The terminal WebSocket is another protocol surface that needs validation and tests.

## Pros and Cons of the Options

### Server-owned shell-free spawn

- Good, because it centralizes authority and removes shell interpolation.
- Bad, because the server carries all process and PTY complexity.

### Browser sends shell strings

- Good, because the client could launch arbitrary commands easily.
- Bad, because it turns any UI bug into arbitrary local execution and reintroduces quoting failures.

### Browser connects directly to a harness port

- Good, because the server would not relay terminal traffic.
- Bad, because the harness would need to expose a network service and the browser would bypass the app's validation and lifecycle.

## Links

- Implemented by `src/server/terminal/pty.ts`, `src/server/routes/terminal.ts`, and the managed PTY/process surfaces in `src/server/runs/orchestrator.ts`.
- Related: [ADR-0001](0001-loopback-only-single-user-server.md), [ADR-0004](0004-frozen-run-snapshots-and-bounded-tails.md), and [ADR-0009](0009-read-only-copilot-trust-and-explicit-permissions.md).
