---
id: ADR-0035
applies_to:
  - "scripts/podman-host.mjs"
  - "scripts/podman-host.d.mts"
  - "scripts/podman.mjs"
  - "Containerfile"
  - ".containerignore"
  - "docs/admin-guide.md"
  - "docs/OPERATIONS.md"
status: Accepted
---

# ADR-0035: Manage persistent Linux hosts with rootless Podman Quadlets

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-14

**Technical Story:** A Skill Loom service should persist on a dedicated Linux host and remain manageable by its administrator, while trusted clients connect through Podman-over-SSH rather than an exposed unauthenticated HTTP endpoint.

## Agent Rules

- **MUST:** Keep `scripts/podman.mjs` as the cross-platform local Podman path. Use `scripts/podman-host.mjs` only for a Linux host with rootless Podman, cgroup v2, a systemd user manager, and Podman 4.4 or newer.
- **MUST:** Run the hosted service under a dedicated non-root account. Enable linger when it must survive logout and start at boot.
- **MUST:** Enable the rootless `podman.socket` for SSH-backed Podman clients. Keep the Podman API on its Unix socket; do not bind an unauthenticated TCP API.
- **MUST:** Keep the application loopback-bound and publish no host HTTP port by default. An optional host port must bind to `127.0.0.1`; remote clients use a configured SSH-backed Podman connection.
- **MUST:** Refuse image builds when the checkout has staged or unstaged tracked changes, and tag the app image with its commit id. Use executable-plus-argument-array process spawning; never introduce shell command strings.
- **MUST:** Preserve the named config volume across service stop/update operations. Export it only while the app is stopped, and keep the previous app unit/image available for explicit rollback after an update.
- **MUST:** Keep host skills and workspace as mounts, not copied image content. Exclude common local environment and key files from the build context.
- **MUST:** Reject host mount paths that cannot be represented safely in Quadlet volume fields; do not emit shell-style quoted volume values.
- **MUST NOT:** Treat SSH/Podman authorization as Skill Loom authentication, or expose the unauthenticated HTTP/editor endpoint to a VPN or public interface.

## Verify

- **Check:** `npm run check && npm run typecheck && npm test && git diff --check`.
- **Check:** `npm run test:package && npm run podman:host -- plan`.
- **Expected:** Host planning shows rootless Quadlet units and no `PublishPort` unless an optional loopback port is configured. Mock-backed tests cover preflight, generated units, argument-array lifecycle calls, health checking, and install.
- **Manual evidence:** On Ubuntu 26.04 ARM64 with rootless Podman 5.7.0, `podman.socket` remained active after reboot and an authorized second client reached the Podman service. A config-volume export/import/re-export check passed using a disposable volume. The app container remained stopped during reboot; this does not verify Quadlet app startup or persistence.
- **Still unverified:** Live Quadlet app install/start and boot recovery, image update/rollback, the host manager's `backup` command, service-level restore, SELinux-enforcing behavior, and unauthorized-identity denial. See [known gaps](../current-gaps.md#execution-gates) and the [hosted-catalog evidence register](../plans/hosted-catalog-repo-chains-implementation-plan.md#evidence-recorded-while-planning-and-executing). The pre-pilot backup timing gate was missed and accepted as an exception.

## Decision Drivers

- Keep Skill Loom usable as a persistent shared catalog and chain library on a separately hosted Linux machine.
- Preserve the existing cross-platform local Podman workflow.
- Avoid exposing a service that has no application authentication.
- Make service lifecycle, image update, rollback, and config backup repeatable for the host administrator.

## Consequences

- Hosted installation requires Linux, rootless Podman 4.4+, cgroup v2, systemd user services, Node.js 24+, and a tracked-clean source checkout.
- The dedicated host account's Podman access controls containers and mounts and is therefore trusted host-account access, not per-command authorization.
- The optional HTTP port remains loopback-only; a remote browser/editor use case requires a separate authenticated ingress decision.
- Unit tests do not establish live service behavior. The recorded socket-reboot, disposable-volume, and authorized-client checks cover only their stated scope; they do not establish app boot startup, update recovery, or broader platform interoperability.

## Links

- Related: [ADR-0001](0001-loopback-only-single-user-server.md), [ADR-0011](0011-shell-free-process-and-pty-transport.md), [ADR-0033](0033-podman-ssh-remote-clients.md).
