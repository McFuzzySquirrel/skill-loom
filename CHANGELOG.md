# Changelog

All notable changes are documented here. This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories: Added, Changed, Deprecated, Removed, Fixed, and Security.

## [Unreleased]

The package version `0.1.0` is private and has no Git release tag or npm publication; all listed changes remain unreleased.

### Added

- Opt-in `test:live:managed -- --confirm-live` OpenCode acceptance probe using the production profile lock, preflight, orchestrator, persistence and PTYs. It checks ordered two-step artifacts, shared sessions, pause, abort, orderly recovery and verified tracked-resource/session cleanup, with bounded redacted evidence and no automatic CLI guard changes.
- Standalone skill guide for the skill-only path: discover, inspect, run, and recover chains with `scenario-discovery`, `loom-run-bundle`, and `loom-chain-workflow` without the Skill Loom server.
- `loom-chain-workflow` companion skill, with a downloadable package, coordinating reviewed discovery, optional workspace testing, bundle import, and current-session execution.
- Shared-owner CLI (`service`, `catalog`, `project`, `chain`, `bundle`, `discovery`, `run`, `workspace`) with versioned JSON envelopes, stdin payloads, paginated catalog snapshots, a 1,000-skill / 20,000-file catalog budget, and read-only `bundle inspect`.
- Profile ownership lock and authenticated local control transport (Unix socket; mutually authenticated loopback TLS on Windows) so the UI and CLI share one owner ([ADR-0023](docs/adr/0023-profile-owner-lock.md), [ADR-0024](docs/adr/0024-local-control-transport.md)).
- Reviewed CLI approvals for bundle import, run start and actions, and workspace removal using review digests and explicit confirmations ([ADR-0025](docs/adr/0025-reviewed-cli-approval-contract.md)); managed `run events` streams and `run attach` terminal attachment.
- Opt-in project claim protocol and coordination review for managed and portable runners.
- Bounded `workspace inspect` and `workspace evaluate` checks that never execute workspace content ([ADR-0026](docs/adr/0026-bounded-opt-in-workspace-evaluation.md)).

- Global remote skill-repository registration with explicit pinned refresh, bounded package snapshots, and catalog visibility for either supported harness.
- Project-independent drafts start from an outcome, register and explicitly refresh optional remote repositories, and select pinned skills and agents without installing them into an existing project.
- A configurable local shared bundle library supports reviewed no-overwrite publication, browsing, and import of portable bundles.
- Remote native-agent discovery and selection, safe installation into native project locations, and preflight checks for installed content and command-surface support.
- Remote skill selections persist their exact source, revision, and package path through chain editing, preflight, and export.
- Disposable chain-test workspaces with retained project/run state, recent-project hiding, explicit cleanup, and refusal to delete a workspace that owns the active run.
- Reusable `loom-run-bundle` Agent Skill package with a standalone Node.js helper for reviewed bundle installation, host-mediated chain execution, confirmation gates, and explicit interrupted-run recovery.
- Separate portable run records, bundle fingerprints, no-overwrite skill installation, and an export-dialog download for the reusable runner skill.
- Portable `.loom.json` chain export/import with complete skill packages, review previews, explicit reuse of installed skills, safe bounded file handling, and fresh permission consent.
- Version 2 portable bundles that preserve an exact selected native agent definition; version 1 remains available for agent-free chains.
- Standalone agent instruction steps alongside skill steps, with labels, ordering, named inputs, preflight, and run lifecycle support.
- Managed interactive scenario discovery workspaces with a pinned handoff, supervised harness launch, fingerprint-bound result review, retained recovery state, and optional import into a new project-independent draft.
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

- Live discovery and execution probes accept stable OpenCode versions >=2.2.5, including 2.2.6, while retaining exact observed versions in evidence. Older and prerelease versions still warn; automatic advancement remains subject to live signal verification.
- CLI-managed starts remain limited to instruction-only chains without native agents; OpenCode automatic starts stay blocked until the `clear` signal between `working` and `idle` is live-verified ([ADR-0007](docs/adr/0007-explicit-advancement-signals.md)).
- Copilot trust guidance now distinguishes persistent folder trust from session-only approval.
- Persisted chain documents now use version 3 for exact remote skill snapshot bindings and migrate valid version 1 and 2 chains while preserving their existing fields.
- Portable bundle export uses version 2 for chains with a selected native agent, while preserving version 1 for agent-free chains; import is no-overwrite and rollback-safe for both packages and agent definitions.
- The workflow designer now gives the skill catalog and ordered steps a two-column layout on wider screens and opens selected-step editing in a dialog.
- OpenCode discovery includes the shared `.agents/skills/` directory while retaining legacy `.opencode/skills/` discovery. Copilot discovery remains CLI-authoritative.
- Bundle export prefers one enabled project-local package over same-named personal or extra-directory packages, while rejecting distinct project duplicates and other ambiguous sources.
- README, user, administrator, and release documentation now distinguish supported behavior, limitations, and unpublished status.

### Fixed

- User-supplied Linux x64 evidence now confirms the OpenCode 2.2.6 record-aware parser fix: prompt, product advancement, recall and cleanup pass. Copilot CLI 1.0.107 also passes execution and recall, with its exact-baseline version warning retained. Managed multi-step automatic acceptance remains open; CLI guards are unchanged.
- OpenCode OSC advancement now distinguishes root summary and child record IDs: child removal no longer erases root working, while root clear, matching-record clear, idle-only streams and per-step reset retain their fail-closed behavior. Live probe evidence now includes up to 64 status records and a truncation flag; automatic CLI starts remain blocked pending managed multi-step acceptance.
- Health reporting now reads the existing run owner or persisted active-run pointer instead of always returning an inactive placeholder; invalid pointer files surface an error without being modified.
- Chain bundle export no longer rejects a valid project package merely because another enabled package with the same name exists outside the project.
- Bundle import no longer treats a same-name personal or remote catalog entry as an installed project conflict when the target package directory is empty.
- Missing, disabled, ambiguous, and unavailable bundle sources now have distinct actionable diagnostics.
- Legacy name-only steps no longer pass preflight by selecting the first of multiple same-named remote packages.
- Copilot catalog discovery now maps `personal-agents` and `personal-copilot` source labels to `personal` instead of skipping those skills.
- Portable run-state writes now succeed on platforms such as Windows that reject directory fsync after an atomic replacement.

### Security

- The server is loopback-only with no authentication; credential-like fields are rejected, and authentication checks use presence evidence only.
- Remote repository access occurs only after an explicit user refresh. Git uses the machine's existing authentication without storing credentials; package scripts are not checked out or executed.
- Harness processes are spawned with an executable and argument array, never a shell string.
- Copilot trust is read-only, and broad automatic flags require an explicit per-chain opt-in.
- No telemetry, crash reporting, or remote logging is sent by Skill Loom. User-requested Git refreshes, harness CLIs, and package installation may access the network.
