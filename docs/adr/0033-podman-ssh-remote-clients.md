---
id: ADR-0033
applies_to:
  - ".github/skills/loom-chain-workflow/scripts/skill-loom-podman.mjs"
  - "src/server/catalog/install.ts"
  - "src/server/control.ts"
  - "src/server/control-cli.ts"
  - "docs/admin-guide.md"
status: Accepted
---

# ADR-0033: Connect remote clients to private hosts through Podman SSH

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-12

**Technical Story:** A hosted global skill catalog and shared chain library should be usable from another machine without opening a Skill Loom network endpoint or requiring a private npm installation on each client.

## Agent Rules

- **MUST:** Keep the Skill Loom HTTP server loopback-bound and its control transport private. Remote clients connect through a preconfigured SSH-backed Podman connection, not Caddy, the editor port, or a new server endpoint.
- **MUST:** Invoke `podman exec` with an executable and argument array; never build a shell command string.
- **MUST:** Treat Podman and SSH authorization as host-account access. Do not describe it as Skill Loom authentication or a per-command permission system.
- **MUST:** For client-local apply, keep the local project path on the client. Request only the selected chain's host-global packages through the control CLI, then validate the bounded manifest before writing to the client's `.agents/skills/`.
- **MUST:** Refuse existing destination packages and enforce limits of 100 packages, 2,000 files, and 20 MiB decoded content.
- **MUST NOT:** Let a remote client write to or provision the host-global skills directory.
- **MUST NOT:** Add public, anonymous, or multi-user access to the Skill Loom service.

## Verify

- **Check:** `npm run check && npm run typecheck && npm test && git diff --check`.
- **Check:** `npm run test:package` and `npm run podman:plan`.
- **Expected:** The packaged bridge selects the configured Podman connection, invokes the in-container CLI without a shell, and client-local apply writes only validated, selected global packages without overwriting existing skills or transmitting the client path.
- **Manual check:** A second-machine SSH connection to a real hosted Podman service has not yet been run; this limitation is tracked in [known gaps](../current-gaps.md#execution-gates).

## Decision Drivers

- Make hosted global skills and shared chains available to trusted clients on other machines.
- Preserve the loopback-only server and private control transport.
- Keep client projects independent of the host filesystem while reusing the host's intentionally provisioned global packages.
- Use Podman's native SSH connection support rather than adding a second network protocol or credential store.

## Consequences

- A remote client needs Node.js 24+, Podman, the standalone workflow skill package, and an administrator-configured SSH-backed Podman connection.
- Authorization is as broad as the host account's Podman access, including control over its containers and mounts; administrators must grant it only to trusted clients.
- Host-project apply continues to target the mounted `/workspace`; client-local apply transfers only the selected chain's global packages and never provisions the host catalog.
- Automated contract tests do not establish interoperability with a real second machine; live SSH verification remains outstanding.

## Links

- Related: [ADR-0001](0001-loopback-only-single-user-server.md), [ADR-0011](0011-shell-free-process-and-pty-transport.md), [ADR-0024](0024-local-control-transport.md), [ADR-0032](0032-host-global-skills-and-current-session-chains.md).
