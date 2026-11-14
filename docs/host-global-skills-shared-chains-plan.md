# Skill Loom host-global skills and shared chains pivot

## Direction

Make the host's `.agents/skills` directory the sole catalog source for authoring chains. Store chains in one shared Loom library, then let a user select a chain for a project, copy its required skill packages into that project's `.agents/skills`, and run the ordered steps in the already-active project agent session.

Support both a local installation and a private, single-user container using the same model and code paths. The container is a persistent catalog and chain-library service; it does not launch a nested harness. The agent-side companion skill or CLI integration drives the current session.

The user considers selected repositories and installed skills intentional. Do not build a provenance-review or immutable-snapshot workflow around them. Retain basic filesystem correctness and safety: canonical paths, safe relative package paths, atomic persistence, and explicit handling of destination conflicts.

## Decisions captured

- **Skill source:** one host-global `.agents/skills` root, provisioned and kept current by the user or their existing installation method. Loom indexes it; Loom is not responsible for remote skill acquisition or updates.
- **Chain sharing:** shared host/container library, replacing routine portable bundle export/import.
- **Deployment:** local and container deployments are both first-class in the initial target, implemented as one architecture. The hosted container is private to one user and relies on its platform/VPN access boundary.
- **Container runtime:** prefer Podman. Support Podman on Linux, macOS, and Windows hosts, including the host-path and volume-mount differences of Podman Machine.
- **Execution:** a selected chain runs in the current agent session for the selected project, not in a Loom-managed child harness.
- **Project installation:** selected chain skills are copied into the target repository's `.agents/skills`; existing destination packages are not silently overwritten.

## Current state

- The default authoring catalog and capability index scan only the configured global skills root (`~/.agents/skills` or `LOOM_SKILLS_DIR`). The legacy source label remains `personal` for API compatibility; project-local packages are apply destinations, not catalog sources.
- Saved chains use the shared Loom config library. Valid chains in `<project>/.loom/chains/` are lazily copied on first access; originals remain. Chain steps refer to skill names, which resolve against the current global catalog at apply time, rather than stable package ids or pinned revisions.
- `chain project apply` copies only referenced packages to `<project>/.agents/skills/`, refuses to overwrite, and reports missing, ambiguous, or conflicting packages.
- `loom-chain-workflow` describes current-session execution without a nested harness or persisted run record. Legacy bundle, remote-source, discovery-handoff, and managed-run functionality remains in the codebase and is outside the default workflow; it has not been removed.
- Podman deployment files and cross-platform plan tests exist. The Linux image was built successfully. macOS/Windows Podman Machine mounts and live container behavior remain unverified.
- The service remains single-user and loopback-bound. Localhost publishing is the Podman default; private hosted access requires authenticated platform/VPN ingress.

Evidence: `README.md` (product and feature scope, catalog/index, project skills), `docs/OPERATIONS.md` (catalog and storage contracts), `docs/admin-guide.md` (chain/bundle and execution details), `docs/current-gaps.md`, and the source files named above.

## Target model

1. **Canonical catalog:** configure one host-global skills directory. Default to the host's `~/.agents/skills`; make the path configurable so a container can mount it at a stable data path. Index skill metadata and searchable text from this root only. Keep project `.agents/skills` as the destination/runtime copy, not a second authoring catalog.
2. **Chain records:** store versioned, atomically written chain documents in the Loom data directory's shared library. Current records refer to skills by name and resolve that name against the current global catalog at apply time; updates are adopted for future applies, while existing project copies remain unchanged.
3. **Apply to project:** selecting a chain for a project copies its referenced package directories into `<project>/.agents/skills`. Do not overwrite an existing destination package; return a clear conflict so the user can resolve it. Do not require review digests, pinned remote snapshots, or a full bundle inspection step.
4. **Run in current session:** an agent-side companion skill reads the selected chain and project context, ensures the selected packages are available to the host, then guides the active agent through ordered steps and declared inputs. Keep the existing product caveat: Loom controls prompt order but cannot guarantee the host loads a named skill.
5. **Container:** mount persistent Loom state, the global skills tree, and the intended project workspace. The service remains bound to loopback inside the container; expose it only through a private authenticated platform/VPN boundary or a trusted local proxy. Keep the service single-user. External provisioning updates skills in the mounted tree; Loom does not fetch or refresh them.

## Implementation status on this branch

- **Implemented:** global-only default catalog and index; shared chain storage; non-destructive lazy migration of legacy project chains; project apply operation; current-session workflow; host-side Podman CLI bridge; persistent named config volume; documentation and ADR-0032; Podman launcher, image, proxy, and simulated host-platform plan tests.
- **Intentionally retained for compatibility:** legacy remote-source and bundle commands, the managed run/workspace subsystem, and the standalone bundle runner. They are not required for new chains and are not the default sharing or execution path.
- **Deferred:** migrating saved drafts or importing old bundles into the shared library; removing compatibility subsystems; changing chain skill references from names to stable ids; native macOS/Windows runtime and mount verification; live persistent-container smoke testing.
- **Known limitation:** applying multiple skills is not a single transaction. If a later copy fails, the error reports earlier successful copies; existing project packages are never overwritten.

## Implementation phases

### 1. Lock the new contract and compatibility boundary

- Record the product decision in an ADR: single global catalog, shared chain library, current-session execution, and private single-user container.
- Define the stable package identity and how chains behave when a package is renamed, removed, or updated. Recommended default: references resolve to the current package identity; updates are adopted on the next selection/apply, while copies already in a project remain unchanged until explicitly reapplied.
- Define supported migration input and conflict reporting before changing existing stores.
- **Status:** ADR-0032 records the product direction. Chain references currently use skill names, and migration copies legacy project chains without deleting originals.

### 2. Replace multi-scope catalog discovery with one global root

- Add a single configurable global skills root and use it consistently in catalog discovery, indexing, CLI/editor results, and companion-skill workflows.
- Remove project/personal/plugin/builtin/extra-root merging from the chain-authoring catalog unless a source is needed only for a documented compatibility path.
- Retire Loom-managed remote source registration, snapshot refresh/storage, snapshot-bound skill resolution, and discovery handoffs. Update `src/server/config/schema.ts`, catalog/control APIs, and catalog CLI accordingly.
- Keep the SQLite capability index only as a derived cache of the new root; simplify its indexed source identity and rebuild behavior.
- Update catalog tests to prove that the configured root is the only authoring source and that an index rebuild sees externally added, changed, and removed packages.
- **Status:** the default adapters and index use the configured global root. Remote/extra configuration surfaces remain but are not consumed by the default catalog; API source labels retain the legacy `personal` value.

### 3. Introduce the shared chain library and migrate saved chains

- Move the active chain store to the Loom data directory (the existing legacy global path may be reused after a clear versioned migration); use the existing atomic JSON persistence conventions.
- Update chain API, CLI, and editor context so chains are library-owned rather than project-owned. Project selection remains necessary for applying and running a chain.
- Migrate drafts and `<project>/.loom/chains` records into the shared library without deleting source records until migration succeeds. Report duplicate IDs/names and unresolved old skill bindings for user action.
- Provide a one-time compatibility importer for existing `.loom.json` bundles if feasible: install missing package directories into the global root and convert the chain to global package references. Do not retain bundle export/import as the normal sharing mechanism.
- Remove snapshot bindings from the active chain model after migration, with explicit handling for unsupported or ambiguous legacy records.
- **Status:** the active store is shared and legacy project chains migrate non-destructively. Drafts remain separate, bundle import has not been added, and old snapshot-bound compatibility paths remain.

### 4. Add project apply and active-session execution

- Add a chain selection/apply workflow that identifies the target repository, resolves referenced packages in the global catalog, and copies them into project `.agents/skills`.
- Preserve safe path validation and no-overwrite behavior, but remove content-review digests and revision pinning. Report missing skills and destination conflicts directly.
- Update or replace the portable runner companion skill so it loads a shared chain and coordinates the ordered steps in the current agent session. It must not spawn OpenCode, Copilot, or another harness.
- Keep execution state minimal and session-local unless a concrete recovery need is identified; do not carry forward PTY supervision, managed workspaces, authentication preflight, or run snapshots by default.
- Test that applying a chain makes its skills available in the target project and that step ordering and input substitution are preserved in the active-session workflow.
- **Status:** apply is implemented with no-overwrite and missing/ambiguous-name errors. The companion skill runs in the current conversation; the server does not persist run input or outcome state.

### 5. Deliver the local and private-container deployments

- Use the same CLI/API and storage model in both deployment modes. Add a Podman-compatible `Containerfile`, deployment definition, and documented persistent mounts for Loom state, global skills, and project workspaces.
- Verify the Linux container image on Linux, macOS, and Windows Podman hosts. Provide platform-specific setup instructions or a shell-free launcher for path translation, Podman Machine startup, volume mounts, and localhost-only access; do not assume POSIX host paths or shell syntax.
- Publish/test both `linux/amd64` and `linux/arm64` images where the build and dependency set permit it; document unsupported architectures rather than silently relying on emulation.
- Keep host credentials outside the image and inject them through the single-user platform's secret mechanism only if the active agent session requires them.
- Document that access control is supplied by the private platform/VPN boundary or trusted proxy. Do not bind the Loom server to a non-loopback interface or add anonymous network access.
- Add container smoke checks for persistent chain/index state across restarts, mounted skill discovery, project apply, and health/status behavior.
- **Status:** Linux image build and cross-platform local command-planning tests are available. A separate rootless Linux Quadlet manager now installs and manages a persistent host service and defaults to no host HTTP publishing. Runtime persistence and Podman Machine mount behavior on macOS/Windows remain unverified; dedicated-host reboot, update/rollback, backup/restore, and second-client VPN verification are pending.

### Persistent hosted Linux service follow-up

The local Podman launcher remains the cross-platform path. For a service hosted
on a separate Linux machine, `scripts/podman-host.mjs` provides rootless
Quadlet installation and management from a tracked-clean source checkout:

- install/start/stop/restart/status/logs using the dedicated user's systemd
  manager, with `loginctl enable-linger` for reboot persistence;
- enable the rootless `podman.socket` so trusted remote clients can reach the
  Podman API through SSH without publishing a TCP endpoint;
- build app images tagged by commit, update the app unit, retain the previous
  app image/unit for rollback, and attempt recovery when an update fails;
- export the persistent config volume only after the app is stopped; skill and
  workspace directories remain separately administered host paths;
- keep host HTTP publishing disabled by default, with an optional loopback-only
  port; remote clients continue to connect over SSH-backed Podman.

**Status:** implementation and mock-backed unit coverage are present. Quadlet
generation has not been validated by a live systemd user manager, and a
dedicated Linux host has not been exercised through reboot, update failure,
rollback, or backup/restore. Do not claim those deployment gates passed until
they are run on a real host.

### 6. Remove superseded surfaces and update documentation

- Deprecate managed run/workspace and bundle/discovery-handoff commands, schemas, routes, stores, and companion skills that are no longer reachable from the supported workflow. Remove in coherent slices after the replacement path is covered.
- Update README, user/admin/operations guides, standalone skill procedures, release notes, and relevant ADR index entries. Explain that external tooling provisions the global skills directory and that project copies do not update automatically.
- Add a migration guide that preserves old chain files and offers a report before migration; document that old portable bundles cease to be a sharing format after the compatibility window.
- **Status:** primary docs and ADR-0032 describe the new workflow. Compatibility documentation remains because legacy commands were not removed; a separate migration guide has not been added.

## Verification

- Focused catalog/index tests: one configured root; external file changes are reflected; no remote snapshot dependency.
- Focused chain-store and migration tests: atomic writes, legacy drafts/project chains, duplicate identities, missing/renamed skills, and non-destructive failure.
- Focused apply tests: copies only referenced packages, rejects unsafe paths, leaves existing packages untouched, and reports conflicts.
- Companion-skill tests/manual procedure: chain loads in the current project session, follows saved order, and does not launch a child harness.
- Container smoke test: mounted paths persist, the configured root is indexed, and access remains behind the private single-user boundary.
- Before completion run `npm run check`, `npm run typecheck`, `npm test`, and `git diff --check`; run `npm run test:package` for changed distributable/container packaging.

## Key tradeoffs and non-goals

- A chain follows the current global skill package, not an immutable version. This simplifies updates and sharing, but historical reproducibility is intentionally reduced.
- A skill copied into a project is a point-in-time copy; refreshing the global root does not silently rewrite project contents.
- Loom will not manage remote repositories, verify license/provenance, or automatically update skills. The user assumes those sources are intentional.
- This is not a public or multi-tenant service. If the deployment later needs multiple users, per-user permissions, or direct public ingress, revisit authentication, authorization, isolation, and storage before exposing it.
- The service indexes and copies skill files but does not execute them. The active agent/harness remains responsible for skill loading and any actions implied by the skills.
