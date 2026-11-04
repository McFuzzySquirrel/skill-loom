---
id: ADR-0001
applies_to:
  - "src/server/app.ts"
  - "src/server/index.ts"
  - "src/server/cli.ts"
  - "src/shared/api.ts"
status: Accepted
---

# ADR-0001: Bind Skill Loom to loopback with no authentication

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** ARCH-01 and SEC-04 established the deployment and trust boundary for the local v1 application.

## Agent Rules

- **MUST:** Default `LOOM_HOST` to `127.0.0.1` and reject every bind host outside `127.0.0.0/8`, `::1`, and `localhost` before listening.
- **MUST:** Keep the HTTP and WebSocket surface unauthenticated only because it is unreachable from another host by default.
- **MUST NOT:** Add a remote mode, a reverse-proxy assumption, or a login flow without superseding this record.
- **MUST NOT:** Publish, tunnel, container-publish, or proxy the port as part of this project's own deployment instructions.

## Verify

- **Check:** `npx vitest run tests/integration/server.test.ts tests/unit/cli.test.ts`
- **Expected:** Both suites pass, including the non-loopback rejection and default-port cases. Also run `grep -n "DEFAULT_HOST = '127.0.0.1'" src/server/app.ts`; it must print exactly one matching line.

## Context and Problem Statement

Skill Loom is a single-user application that can browse folders, write project files, spawn agent CLIs, and stream terminal output. Should it carry an application identity and authorization model, or can access be controlled entirely by binding the server to the local machine?

## Decision Drivers

- The application has no account, tenant, or role concept; the human at the machine is the only user.
- Authentication would add a credential store and a session surface without removing the need to protect a local port.
- The browser UI and API must share one origin, and the packaged CLI must work with no configuration.
- Any accidental non-loopback bind would expose filesystem and process control to the local network.

## Considered Options

- Loopback-only with no authentication, as a deliberate single-user boundary.
- Localhost-only with a generated bearer token or password.
- Configurable host with authentication for remote use.

## Decision Outcome

Chosen option: "Loopback-only with no authentication", because it matches the single-user deployment target and avoids inventing an identity system whose security would still depend on never exposing the port.

### Positive Consequences

- One-command local startup with no account setup, password reset, or token distribution.
- The browser can use the same-origin API and WebSocket endpoints without credential plumbing.
- The security model is easy to state and test: a non-loopback host aborts startup.

### Negative Consequences

- There is no defense against another local process or a local user on the same machine.
- A user who publishes the port through a proxy or tunnel removes the only boundary; documentation must warn about this repeatedly.
- Future multi-user or remote use requires a superseding decision and substantial security work.

## Pros and Cons of the Options

### Loopback-only with no authentication

- Good, because it is the smallest surface consistent with one local user.
- Bad, because the local machine's user boundary is also the application's security boundary.

### Localhost with a generated token

- Good, because it resists accidental requests from other local processes.
- Bad, because the token has to be stored, read, rotated, and supplied by the browser without a real user identity.

### Configurable host with authentication

- Good, because it supports remote access.
- Bad, because it turns a local tool into a multi-user service and requires authorization, TLS, and audit work that this project does not implement.

## Links

- Implemented by `src/server/app.ts` (`DEFAULT_HOST`, `isLoopbackHost`, `assertLoopbackHost`) and `src/server/cli.ts`.
- Related: [ADR-0011](0011-shell-free-process-and-pty-transport.md), which protects the execution surface that this boundary contains.
- User-facing boundary: [README.md](../../README.md#security-and-privacy) and [OPERATIONS.md](../OPERATIONS.md#security-model).
