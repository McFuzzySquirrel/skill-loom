# Changelog

All notable changes are documented here. This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories: Added, Changed, Deprecated, Removed, Fixed, and Security.

## [Unreleased]

The package version `0.1.0` is private and has no Git release tag or npm publication; all listed changes remain unreleased.

### Added

- Reusable `loom-run-bundle` Agent Skill package with a standalone Node.js helper for reviewed bundle installation, host-mediated chain execution, confirmation gates, and explicit interrupted-run recovery.
- Separate portable run records, bundle fingerprints, no-overwrite skill installation, and an export-dialog download for the reusable runner skill.
- Portable `.loom.json` chain export/import with complete skill packages, review previews, explicit reuse of installed skills, safe bounded file handling, and fresh permission consent.
- Standalone agent instruction steps alongside skill steps, with labels, ordering, named inputs, preflight, and run lifecycle support.
- Project skill copies and bundle imports use the shared `.agents/skills/` location for either harness.
- Project workspace navigation and selectable system, light, and dark appearance modes.
- Project documentation set: user guide, administrator guide, ADR index and records, release notes, and this changelog.
- Documentation navigation from the README and the operations guide.
- Loopback-only Fastify server with a React web UI, typed JSON API, and WebSocket terminal transport.
- Project registration, recent projects, folder browser, optional `git init`, and canonical path handling.
- Skill catalogs for OpenCode filesystem discovery and Copilot `copilot skill list --json`, including extra directories, warnings, and bounded copy-into-project.
- Chain model, builder, step reordering, named inputs and `{{name}}` placeholders, session modes, per-chain automatic-permission opt-in, and project-local persistence.
- Global chain library with independent template snapshots and import-with-new-id.
- Deterministic preflight for harness executable resolution, authentication evidence, Copilot folder trust, catalog resolution, inputs, session mode, permissions, and Git state.
- Supervised and automatic run modes with a frozen chain snapshot, resolved inputs, bounded tails, one global active run, and startup recovery.
- OpenCode and Copilot adapters with shell-free command construction, session planning, native fork where available, and deterministic handoff elsewhere.
- Terminal run view, run details, recovery controls, keyboard focus exit from xterm, and live status announcements.
- Local `skill-loom` CLI with `--help`, `--version`, `--no-open`, `--port`, and `--config-dir`.
- Unit, integration, Playwright end-to-end, package smoke, and live discovery/execution probes.

### Changed

- The workflow designer now gives the skill catalog and ordered steps a two-column layout on wider screens and opens selected-step editing in a dialog.
- OpenCode discovery includes the shared `.agents/skills/` directory while retaining legacy `.opencode/skills/` discovery. Copilot discovery remains CLI-authoritative.
- Bundle export prefers one enabled project-local package over same-named personal or extra-directory packages, while rejecting distinct project duplicates and other ambiguous sources.
- README, user, administrator, and release documentation now distinguish supported behavior, limitations, and unpublished status.

### Fixed

- Chain bundle export no longer rejects a valid project package merely because another enabled package with the same name exists outside the project.
- Missing, disabled, ambiguous, and unavailable bundle sources now have distinct actionable diagnostics.
- Portable run-state writes now succeed on platforms such as Windows that reject directory fsync after an atomic replacement.

### Security

- The server is loopback-only with no authentication; credential-like fields are rejected, and authentication checks use presence evidence only.
- Harness processes are spawned with an executable and argument array, never a shell string.
- Copilot trust is read-only, and broad automatic flags require an explicit per-chain opt-in.
- No telemetry, crash reporting, remote logging, or outbound application requests are sent by Skill Loom.
