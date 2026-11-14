# Changelog

All notable changes are documented here. This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories: Added, Changed, Deprecated, Removed, Fixed, and Security.

## [Unreleased]

The package version `0.1.0` is private and has no Git release tag or npm publication; all listed changes remain unreleased.

### Added

- An offline `loom-chain-workflow` path to validate and run a tracked repository chain from its local `.agents/skills/` in the active session, with explicit chain selection, input collection, and change/interruption handling.
- Repo-local chain authoring in tracked `chains/<id>.json` files, versioned hosted-publication sidecars, and explicit revision-checked publish, compare, recovery, and republish commands through the SSH-backed Podman bridge.
- A persistent Linux host deployment manager using rootless Podman Quadlets, with install, lifecycle, update/rollback, and stopped-volume backup commands; it publishes no HTTP port by default and supports trusted remote clients over SSH.
- A Podman deployment for Linux, macOS, and Windows hosts, with persistent config, global-skill, and project mounts, localhost-only default publishing, private-network mode, and a cross-platform plan command.
- A `skill-loom-podman` CLI bridge that forwards command arguments and stdin to the running app container without using a shell, enabling host-side chain and apply operations against the shared service.
- The standalone `loom-chain-workflow` package now includes the Podman bridge for clients using an existing SSH-backed named Podman connection, so a remote agent can search the hosted global catalog and shared chains without exposing the Skill Loom server.
- A bounded `chain project export` operation and `skill-loom-podman chain project apply-local` command that transfer only the selected chain's global skills to a remote client's project without sending its path to the host or overwriting existing packages.
- A `catalog skill export` operation and `skill-loom-podman catalog skills copy-local` command that copy exact reviewed host-global catalog entries into a client repository before chain creation. The client validates a versioned package-fingerprint manifest, writes only under `.agents/skills/`, refuses existing packages, and reports partial success without sending its project path to the host.
- A [Host Catalog Operations guide](docs/host-catalog-operations.md) for the operator-controlled catalog source, safe package updates and rollback, read-only Podman mount checks, discovery refresh behavior, backups, permissions, and troubleshooting.
- A `chain project apply` command that copies only a selected shared chain's current global skills into the target project's `.agents/skills/` root, never overwrites existing packages, and reports missing, ambiguous, or partial-copy failures.
- A non-destructive first-access migration that copies valid legacy project chains into the shared library and leaves original files in place.
- The `loom-chain-workflow` current-session path for searching the host-global catalog, creating or selecting a shared chain, applying its skills, and carrying out ordered steps without launching a nested harness.
- A derived, disposable SQLite capability index for chain authoring. It searches bounded names, descriptions, frontmatter, headings, file paths, and body excerpts with FTS5 ranking (or a deterministic token table), fingerprints packages for invalidation, preserves remote binding identity, and falls back to the fresh catalog scan when the index is disabled, missing, corrupt, unsafe, unsupported, or too large. It is enabled by default; set `LOOM_CAPABILITY_INDEX=0` to force the scan.
- `catalog project page` now uses the capability index when it is enabled. Entries carry bounded `match.snippet` and `match.score` values, indexed `fingerprint` provenance, and the exact remote `sourceId`, `revision`, and `repositoryPath`. The response reports `retrieval.mode`, `retrieval.ranking`, and any fallback reason while keeping the existing paging, `snapshotId`, warning-cursor, and cache-limit contract. Large indexed result sets and any indexed failure use the fresh scan instead of truncating or hiding skills.
- `scenario-discovery` and `loom-chain-workflow` now expand an outcome into bounded capability queries and rerank the shortlist with the harness model before reading complete packages. They treat snippets as ranking signals, surface scan fallback, and keep the exact remote binding identity.
- The retrieval corpus adds a pinned remote candidate with exact-binding checks and a source-policy exclusion case. `npm run eval:retrieval` compares the scan and indexed paths and reports binding accuracy, excluded violations, fallbacks, and build time.
- Structured skill metadata from frontmatter: bounded `tags`, `allowed-tools`/`tools`, `inputs`, `outputs`, and `when_to_use`, with field-level validation issues. Indexed results include the extracted metadata, and `catalog project page` returns `metadataCoverage` counts for missing or invalid metadata.
- `catalog project page` accepts optional `sources`, `enabled`, `tags`, `tools`, `inputs`, `outputs`, `hasTags`, `hasTools`, `hasInputs`, and `hasOutputs` filters. They are part of the snapshot identity and are applied by the indexed path; the scan fallback reports `METADATA_FILTER_UNSUPPORTED` instead of pretending they held.
- `catalog project page` returns `metadataFacets` with every unique declared tag, tool, input, and output plus counts, so an author can discover available metadata values before filtering.
- The capability index now uses schema version 2 with a dedicated metadata FTS column and token weights. An older index rebuilds automatically from unchanged package files.
- The retrieval corpus adds metadata filter tasks and `precision@10`. The Phase 3 comparison records precision improving from 0.637 to 0.731 while recall stays at 1.000.
- Skill Loom is CLI- and skill-driven. A shared-owner CLI (`service`, `project`, `chain`, `catalog`, `discovery`, `bundle`, `run`, `workspace`) provides versioned JSON envelopes, stdin payloads, reviewed digests, and explicit confirmations.
- Companion skills: `scenario-discovery` discovers candidates and builds reviewed bundles, `loom-chain-workflow` coordinates discovery, optional workspace testing, import, and current-session execution, `loom-run-bundle` runs a bundle in the current host session, and `loom-skill-catalog` searches registered sources and installs one reviewed package. The workflow, discovery, and catalog skills offer to install the CLI when it is missing.
- A single visual chain editor opened with `skill-loom edit` for reordering steps, editing instructions, managing `{{inputs}}`, and saving back to a draft or project chain.
- Project-independent drafts and project chains with revision preconditions and atomic versioned persistence.
- Portable `.loom.json` bundles with complete referenced skill packages, project-local source preference, bounded validation, explicit conflict handling, and no-overwrite import. Version 2 preserves one selected native agent.
- Portable bundle runs can reuse a catalog-resolved host-global skill package instead of copying it into the project. Reuse is explicit, the reviewed path and fingerprint are bound into the review digest, and the package is re-fingerprinted before every step; an edited package blocks the run.
- Local and pinned remote skill catalogs with explicit HTTPS/SSH source registration, bounded refresh, pagination, candidate inspection, and no execution of package content.
- `catalog skill review` and `catalog skill install` add a reviewed, digest-bound install path for one exact catalog candidate. Review returns the complete package inventory, license files, destination conflict, and provenance; install rechecks the digest, refuses stale or changed content, targets the shared `.agents/skills/` root, and never overwrites or suffixes a conflicting name.
- The `loom-skill-catalog` companion skill searches registered local and pinned remote sources, reads the selected package in full as untrusted data, and installs one reviewed package into the project. It does not create chains and does not browse a public registry.
- Validated discovery handoffs prepared from pinned snapshots and consumed offline by the standalone discovery skill.
- Managed disposable test workspaces and discovery workspaces with retained output and explicit `skill-loom workspace remove` cleanup.
- Deterministic preflight with hard blocks, warnings, and acknowledgements; preflight makes no model call.
- Supervised and automatic managed runs with frozen snapshots, one global active run, bounded step tails, explicit interruption recovery, `run events`, and `run attach`.
- Profile ownership lock and authenticated local control transport: a private socket on Unix and mutually authenticated loopback TLS on Windows.
- Documentation set: user, administrator, operations, scenario, standalone skill, visual tour, and capability-index dogfooding guides; ADR index and records; release notes; [known gaps](docs/current-gaps.md); and a [documentation archive](docs/archive/README.md) for retired plans.
- Global install guidance for a locally packed tarball, including the npm 11 `allow-scripts` workaround for `file:` dependencies.
- An extended documentation gate that checks relative links and anchors, documented npm scripts, retired vocabulary, ADR index dates, and checked-in skill mirrors.

### Changed

- The persistent-host guide now walks from Linux account and rootless Podman socket setup through Quadlet installation and remote-client registration, and identifies Git as a host-install prerequisite.
- The host-global `~/.agents/skills/` directory, configurable with `LOOM_SKILLS_DIR`, is now the sole source for the default authoring catalog. External installation tools own provisioning and updates; remote snapshots and bundles remain compatibility surfaces rather than the default workflow.
- New chains are stored in the shared Loom library and are visible from each registered project context. Applying a chain creates independent project-local skill copies; later global changes do not rewrite them.
- Shared chain execution now uses the already-active agent session. The container path keeps the application loopback-bound and requires private authenticated ingress for non-local access.
- Indexed retrieval is the default for `catalog project page`. `LOOM_CAPABILITY_INDEX=0` forces the fresh scan. The default index now contains the configured host-global skills root only.
- The web application is reduced to the chain editor. Projects, catalogs, discovery, libraries, test workspaces, runs, themes, and the terminal are CLI-, skill-, or harness-driven.
- Chain documents use version 3 for exact remote skill bindings and optional native-agent identity. Valid version 1 and 2 records migrate on read.
- Portable bundle export uses version 2 for chains with a selected native agent and version 1 for agent-free chains.
- OpenCode catalog discovery covers project `.agents/skills/` and legacy `.opencode/skills/`, plus personal `~/.agents/skills` and `~/.config/opencode/skills`. Copilot discovery remains CLI-authoritative and now reports project and host-global locations.
- Windows profile security prefers stable PowerShell 7 and retains Windows PowerShell 5.1 with .NET 4.7.2+ as an availability-only fallback.
- Live discovery and execution probes accept stable OpenCode versions >=2.2.5, including 2.2.6, while retaining exact observed versions in evidence.
- README, user, administrator, operations, release, and evidence documentation now distinguish supported behavior, blocked gates, and unpublished status.

### Removed

- The HTTP API surface the CLI never used: project, catalog, discovery, filesystem, preflight, run, test-workspace, shared-bundle library, global-template, scenario-preset, portable-skill, and bundle routes.
- The WebSocket terminal transport, the xterm.js renderer, and the `@fastify/websocket` and `ws` dependencies. Run output is streamed to `skill-loom run attach` instead.
- Web screens for projects, catalogs, discovery, libraries, test workspaces, runs, and the terminal, along with their Playwright browser tests and the `docs:capture` and `test:e2e` scripts.
- The global chain-template library and the shared bundle library, whose interfaces were removed by ADR-0027 and ADR-0028. Retained files under the config directory have no current command.
- Historical planning and generated explainer documents moved to `docs/archive/`; stale machine-generated review and delivery artifacts were deleted.

### Fixed

- Remote source refresh now keeps a package whose `SKILL.md` has malformed frontmatter, using the directory-name fallback instead of aborting the whole snapshot with `CONTROL_INTERNAL_ERROR`.
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
