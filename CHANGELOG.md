# Changelog

All notable changes are documented here. This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories: Added, Changed, Deprecated, Removed, Fixed, and Security.

## [Unreleased]

The package version `0.1.0` is private and has no Git release tag or npm publication; all listed changes remain unreleased.

### Added

- Skill Loom is CLI- and skill-driven. A shared-owner CLI (`service`, `project`, `chain`, `catalog`, `discovery`, `bundle`, `run`, `workspace`) provides versioned JSON envelopes, stdin payloads, reviewed digests, and explicit confirmations.
- Companion skills: `scenario-discovery` discovers candidates and builds reviewed bundles, `loom-chain-workflow` coordinates discovery, optional workspace testing, import, and current-session execution, and `loom-run-bundle` runs a bundle in the current host session. The first two offer to install the CLI when it is missing.
- A single visual chain editor opened with `skill-loom edit` for reordering steps, editing instructions, managing `{{inputs}}`, and saving back to a draft or project chain.
- Project-independent drafts and project chains with revision preconditions and atomic versioned persistence.
- Portable `.loom.json` bundles with complete referenced skill packages, project-local source preference, bounded validation, explicit conflict handling, and no-overwrite import. Version 2 preserves one selected native agent.
- Local and pinned remote skill catalogs with explicit HTTPS/SSH source registration, bounded refresh, pagination, candidate inspection, and no execution of package content.
- Validated discovery handoffs prepared from pinned snapshots and consumed offline by the standalone discovery skill.
- Managed disposable test workspaces and discovery workspaces with retained output and explicit `skill-loom workspace remove` cleanup.
- Deterministic preflight with hard blocks, warnings, and acknowledgements; preflight makes no model call.
- Supervised and automatic managed runs with frozen snapshots, one global active run, bounded step tails, explicit interruption recovery, `run events`, and `run attach`.
- Profile ownership lock and authenticated local control transport: a private socket on Unix and mutually authenticated loopback TLS on Windows.
- Documentation set: user, administrator, operations, scenario, standalone skill, and visual tour guides; ADR index and records; release notes; [known gaps](docs/current-gaps.md); and a [documentation archive](docs/archive/README.md) for retired plans.
- Global install guidance for a locally packed tarball, including the npm 11 `allow-scripts` workaround for `file:` dependencies.
- An extended documentation gate that checks relative links and anchors, documented npm scripts, retired vocabulary, ADR index dates, and checked-in skill mirrors.
- An explicit per-gap authoring branch for discovery: proposals may mix existing skills, instruction-only steps, and new locally authored skills. `skill-creator` scaffolds into `.skill-loom-authored/`, `skill-review` audits only that package, and the new `authored-skill.mjs` helper validates, fingerprints, and installs without overwriting. Handoff bundles may include reviewed `localSkills` entries beside pinned candidates.

### Changed

- The web application is reduced to the chain editor. Projects, catalogs, discovery, libraries, test workspaces, runs, themes, and the terminal are CLI-, skill-, or harness-driven.
- Chain documents use version 3 for exact remote skill bindings and optional native-agent identity. Valid version 1 and 2 records migrate on read.
- Portable bundle export uses version 2 for chains with a selected native agent and version 1 for agent-free chains.
- OpenCode discovery includes the shared `.agents/skills/` directory while retaining legacy `.opencode/skills/` discovery. Copilot discovery remains CLI-authoritative.
- Windows profile security prefers stable PowerShell 7 and retains Windows PowerShell 5.1 with .NET 4.7.2+ as an availability-only fallback.
- Live discovery and execution probes accept stable OpenCode versions >=2.2.5, including 2.2.6, while retaining exact observed versions in evidence.
- README, user, administrator, operations, release, and evidence documentation now distinguish supported behavior, blocked gates, and unpublished status.
- The companion skill set now includes `skill-creator` and `skill-review`; both are packaged in `dist/skills/` and mirrored under `skill/` without their generated `node_modules`.

### Removed

- The HTTP API surface the CLI never used: project, catalog, discovery, filesystem, preflight, run, test-workspace, shared-bundle library, global-template, scenario-preset, portable-skill, and bundle routes.
- The WebSocket terminal transport, the xterm.js renderer, and the `@fastify/websocket` and `ws` dependencies. Run output is streamed to `skill-loom run attach` instead.
- Web screens for projects, catalogs, discovery, libraries, test workspaces, runs, and the terminal, along with their Playwright browser tests and the `docs:capture` and `test:e2e` scripts.
- The global chain-template library and the shared bundle library, whose interfaces were removed by ADR-0027 and ADR-0028. Retained files under the config directory have no current command.
- Historical planning and generated explainer documents moved to `docs/archive/`; stale machine-generated review and delivery artifacts were deleted.

### Fixed

- The chain editor now blocks step, input, and reorder mutations while a save is in flight and keeps any newer edit if one still arrives, adopting only the server's identity fields instead of silently replacing newer work.
- `skill-loom edit` now asks the running profile owner for its actual HTTP endpoint instead of guessing from `LOOM_PORT`; it fails with a clear message when the endpoint is unavailable.
- The editor restores its skip-to-content link, and the render fallback returns to the editor landing page rather than the removed `/projects` route.
- OpenCode OSC advancement now distinguishes root summary and child record IDs: child removal no longer erases root working, while root clear, matching-record clear, idle-only streams, and per-step reset retain their fail-closed behavior. Automatic CLI starts remain blocked pending managed multi-step acceptance.
- Health reporting reads the existing run owner or persisted active-run pointer instead of always returning an inactive placeholder; invalid pointer files surface an error without being modified.
- Chain bundle export no longer rejects a valid project package merely because another enabled package with the same name exists outside the project.
- Bundle import no longer treats a same-name personal or remote catalog entry as an installed project conflict when the target package directory is empty.
- Missing, disabled, ambiguous, and unavailable bundle sources now have distinct actionable diagnostics.
- Legacy name-only steps no longer pass preflight by selecting the first of multiple same-named remote packages.
- Copilot catalog discovery maps `personal-agents` and `personal-copilot` source labels to `personal`.
- Remote refresh fetches blobs with the shallow clone instead of triggering a lazy network fetch for each package file.
- Portable run-state writes succeed on platforms that reject directory fsync after an atomic replacement.
- Windows installation repairs the pinned `node-pty` 1.1.0 natural-exit resource lifecycle with a hash-bound compatibility fix; unknown dependency bytes fail installation rather than receiving an unverified patch.

### Security

- The server is loopback-only with no authentication; credential-like config fields are rejected, and authentication checks use presence evidence only.
- Remote repository access occurs only after an explicit user refresh. Git uses the machine's existing authentication without storing credentials; package scripts are not checked out or executed.
- Harness processes are spawned with an executable and argument array, never a shell string.
- Copilot trust is read-only, and broad automatic flags require an explicit per-chain opt-in.
- No telemetry, crash reporting, or remote logging is sent by Skill Loom. User-requested Git refreshes, harness CLIs, and package installation may access the network.
