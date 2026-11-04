# Changelog

All notable changes are documented here. This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories: Added, Changed, Deprecated, Removed, Fixed, and Security.

## [Unreleased]

### Added

- Project documentation set: user guide, administrator guide, ADR index and records, release notes, and this changelog.
- Documentation navigation from the README and the operations guide.

### Changed

- Documented the live-verification gaps in automatic OpenCode advancement and Copilot's project-skill copy destination.

### Fixed

- No product fixes are recorded in this documentation refresh.

### Security

- Documented the loopback-only boundary, the absence of authentication and TLS, the read-only Copilot trust model, and the explicit automatic-permission opt-in.

## [0.1.0] - 2026-11-04

This is the initial local development version. The package is named `skill-loom-cli`, remains `"private": true`, and has not been published to npm or tagged as a Git release.

### Added

- Loopback-only Fastify server with a React web UI, typed JSON API, and WebSocket terminal transport.
- Project registration, recent projects, folder browser, optional `git init`, and canonical path handling.
- Skill catalog for OpenCode filesystem discovery and Copilot `copilot skill list --json`, including extra directories, warnings, and bounded copy-into-project.
- Chain model, builder, step reordering, named inputs and `{{name}}` placeholders, session modes, per-chain automatic-permission opt-in, and project-local persistence.
- Global chain library with independent template snapshots and import-with-new-id.
- Deterministic preflight for harness executable resolution, authentication evidence, Copilot folder trust, catalog resolution, inputs, session mode, permissions, and Git state.
- Supervised and automatic run modes with a frozen chain snapshot, resolved inputs, bounded tails, one global active run, and startup recovery.
- OpenCode and Copilot adapters with shell-free command construction, session planning, native fork where available, and deterministic handoff elsewhere.
- Terminal-dominant run view, run details view, recovery controls, keyboard focus exit from xterm, and live status announcements.
- Local `skill-loom` CLI with `--help`, `--version`, `--no-open`, `--port`, and `--config-dir`.
- Unit, integration, Playwright end-to-end, package smoke, and live discovery/execution probes.

### Changed

- None recorded for the initial version.

### Fixed

- None recorded for the initial version.

### Security

- Server binds to loopback, rejects non-loopback hosts, and has no authentication because it is not designed for remote access.
- Credential-like configuration fields are rejected; authentication checks use presence evidence only.
- Harness processes are spawned with an executable and argument array, never a shell string.
- Copilot trust is read-only, and broad automatic flags require an explicit per-chain opt-in.
- No telemetry, crash reporting, remote logging, or outbound application requests are sent by Skill Loom.
