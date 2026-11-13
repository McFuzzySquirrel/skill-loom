# Skill Loom Operations Guide

This guide is the operator contract for Skill Loom's local and private single-user Podman deployments, including trusted remote clients using Podman-over-SSH. It covers configuration, on-disk data, the global skill catalog, the security model, backup and cleanup, compatibility features, and troubleshooting.

Read [README.md](../README.md) first for install, development, build, start, and test commands. For task-oriented guidance, see the [user guide](user-guide.md), [standalone skill guide](standalone-skill-guide.md) for legacy bundles, and [administrator guide](admin-guide.md). The durable decisions behind this contract are in the [ADR index](adr/README.md), and release validation is in [the 0.1.0 release notes](releases/0.1.0.md).

## Configuration

Skill Loom stores global configuration in `~/.config/loom/config.json` by default. Set `LOOM_CONFIG_DIR` to use a different directory, for example an isolated directory for tests or a separate profile:

```bash
LOOM_CONFIG_DIR=/absolute/path/to/loom-profile npm start
```

`LOOM_CONFIG_DIR` is read on every configuration operation. A relative value is resolved against the server's working directory, so an absolute path is recommended. The directory is created when the configuration is first written.

| Environment variable | Default | Behavior |
|----------------------|---------|----------|
| `LOOM_CONFIG_DIR` | `~/.config/loom` | Overrides the global config, recent-project, and active-run pointer location. |
| `LOOM_SKILLS_DIR` | `~/.agents/skills` | The single host-global skill catalog. External installation tools own provisioning and updates. |
| `LOOM_HOST` | `127.0.0.1` | Bind host. Only `127.0.0.0/8`, `::1`, and `localhost` (normalized to `127.0.0.1`) are accepted; any other value aborts startup. |
| `LOOM_PORT` | `7373` | TCP port from 1 to 65535. |
| `LOOM_WEB_ROOT` | discovered `dist/web` | Optional override for the built chain editor directory; intended for controlled deployments and tests. |
| `LOOM_CAPABILITY_INDEX` | enabled | `catalog project page` uses the derived, disposable capability index by default. Set `LOOM_CAPABILITY_INDEX=0` to force the fresh catalog scan. When the index is missing, stale, corrupt, unsafe, unsupported, or oversized, retrieval uses the fresh scan. The indexed path keeps the existing paging and `snapshotId` contract and reports `retrieval.mode`, `retrieval.ranking`, and any fallback reason. |

The versioned config document retains fields for compatibility. The active authoring catalog scans only `LOOM_SKILLS_DIR`; legacy extra directories and remote snapshot sources are not consulted by the default chain workflow. `harnessCommands` and other remaining settings are validated, and credential-like fields such as `apiKey`, `token`, or `secret` are invalid and never stored there. Configuration writes use an atomic temporary-file replacement. A corrupt or unsupported-version config is reported rather than silently rewritten.

Recent projects store the canonical path, display name, derived id, and last-opened time; removing a recent entry never removes project files.

## Package and CLI

The npm package is `skill-loom-cli` and exposes the `skill-loom` binary. It remains private for now, so local use is from a packed tarball:

```bash
npm run build
npm pack
npx --yes --package=./skill-loom-cli-0.1.0.tgz skill-loom
```

The CLI supports `--help`, `--version`, `--no-open`, `--port <number>`, and `--config-dir <path>`. It starts the same loopback-only production server as `npm start`, prints the resolved config directory and URL, and opens the default browser only when stdout is a TTY and `CI` is unset. `--no-open` disables that behavior entirely.

The derived capability index is a local retrieval cache, not a new source of truth. It reads package frontmatter and bounded text, never executes skill content, and never sends it off the machine. `catalog project page` returns bounded snippets and scores, declared metadata, `metadataCoverage` counts, `metadataFacets` for every unique declared tag/tool/input/output, and optional `sources`, `enabled`, `tags`, `tools`, `inputs`, `outputs`, `hasTags`, `hasTools`, `hasInputs`, and `hasOutputs` filters. Indexed remote entries carry the exact `sourceId`, `revision`, `repositoryPath`, and `fingerprint`; a snippet is not package review. If the scan fallback answers, metadata filters are not applied and a `METADATA_FILTER_UNSUPPORTED` warning says so. Deleting `capability-index.sqlite` loses no user data and simply forces the next retrieval to rebuild it or use the fresh scan. For a manual, isolated procedure with real projects and pinned remote sources, see [Capability index dogfooding](capability-index-dogfooding.md).

`--port` sets `LOOM_PORT`; `--config-dir` sets `LOOM_CONFIG_DIR`. Environment variables remain authoritative when a flag is omitted. The package contains the compiled server, built chain editor, compiled package metadata, the macOS PTY installation helper, `docs/OPERATIONS.md`, and the manifest; source, tests, build scripts, and the other documentation files are excluded. Installing the package may build the native `node-pty` module, so the Python/make/C++ toolchain is required.

To install the command globally instead of invoking the tarball through `npx`:

```bash
npm install -g ./skill-loom-cli-0.1.0.tgz
skill-loom --version
```

On npm 11.20 and newer this can warn that `skill-loom-cli` and `node-pty` have install scripts "not yet covered by allowScripts". The scripts still run unless `strict-allow-scripts` is enabled, so the warning is advisory. npm matches a `file:` dependency by path rather than by name, so a name-only allowlist covers `node-pty` but not the tarball package; pass both:

```bash
npm install -g ./skill-loom-cli-0.1.0.tgz \
  --allow-scripts="file:$PWD/skill-loom-cli-0.1.0.tgz,node-pty"
```

Persist that list with `npm config set allow-scripts="file:/absolute/path/to/skill-loom-cli-0.1.0.tgz,node-pty" --location=user`. `allow-scripts=all` is not a wildcard, and `--dangerously-allow-all-scripts` allows every dependency's scripts, so prefer the scoped list. A global install provides the CLI only; the companion skills are still copied into a project's `.agents/skills/<skill-name>/`. If `npm install -g` fails with `EACCES`, set a user-level npm prefix rather than installing with `sudo`, because the `node-pty` build and postinstall helper should run as the user.

Before publishing, flip `"private"` to `false`, add repository metadata, verify the package name is still available, run `npm run test:package`, and publish with `npm publish`. Once published, the invocation is `npx skill-loom-cli` or `npm install -g skill-loom-cli`, and the name-based allowlist `--allow-scripts=skill-loom-cli,node-pty` covers both packages.

The build creates `dist/skills/loom-run-bundle/`, `dist/skills/scenario-discovery/`, `dist/skills/loom-chain-workflow/`, and `dist/skills/loom-skill-catalog/` and their ZIP archives. It syncs the `scenario-discovery`, `loom-chain-workflow`, and `loom-skill-catalog` trees into `skill/`, and syncs the generated runner helper into `skill/loom-run-bundle/`; review any other checked-in mirror changes separately. The ZIP archives are the distributable skill packages; there is no in-app download. To install manually from a checkout, run `npm run build:portable-skill`, then copy the relevant directories into the target project's `.agents/skills/<skill-name>/`. The workflow skill requires the Skill Loom CLI owner or a configured Podman bridge; its package includes the `skill-loom-podman` client helper for remote SSH connections. The catalog skill requires the CLI and owner service; the legacy bundle and discovery helpers run on Node.js 24+ without that service, a native PTY, or an installed Loom npm package. Portable runner mutations use a project-local SQLite database. The runner skill prescribes `--disable-warning=ExperimentalWarning` to keep early Node 24 SQLite warnings out of structured stderr; this also suppresses other experimental warnings. The standalone ZIPs and files are included in the packed Skill Loom artifact. The development `npm run dev` lifecycle builds the skills before starting the server and UI.

The discovery skill's project-independent mode consumes a downloaded `*.loom-discovery.json` handoff, validates its schema, fingerprints, paths, and content offline, then proposes reviewed scenarios. It builds a standard v1 `.loom.json` bundle from only the approved packages. It does not import, install, run package code, or make network requests. Hosts must pass helper arguments as structured process arguments; do not substitute shell-concatenated commands.

The helper is not the `skill-loom` server CLI and does not launch a nested Copilot or OpenCode process. Its `inspect`, `prepare`, `status`, `step`, `record`, and `resume` protocol is documented in the packaged `SKILL.md`; it receives state-changing options as JSON on stdin. The host agent uses its ordinary tools for each step, so recorded success is agent-reported rather than a verified CLI process exit or OpenCode OSC signal.

Portable `prepare` requires the `reviewDigest` returned by `inspect` with the
target project. It binds the bundle, canonical project identity, and existing
destination fingerprints; changed evidence requires a new inspection and
approval. This is a point-in-time check, not an external filesystem lock or
proof that a person reviewed the content.

## Data locations

| Path | Contents | Notes |
|------|----------|-------|
| `~/.agents/skills/` | The single host-global skill catalog. | External tools provision and update packages. Override with `LOOM_SKILLS_DIR`. |
| `~/.config/loom/config.json` | Global config, harness command overrides, recent projects, and UI preferences (unused by the chain editor). | Override the whole directory with `LOOM_CONFIG_DIR`. |
| `~/.config/loom/drafts/*.json` | Project-independent chain drafts. | Independent of projects; back up with the config directory. |
| `~/.config/loom/profile-owner.sqlite` | Profile ownership lock. | One owner per profile. Do not remove while the service is running; the OS releases the lock on exit. |
| `~/.config/loom/capability-index.sqlite` | Derived index of the configured global skill catalog. | Disposable and excluded from backups. Owner-only, capped at 64 MiB, and safe to delete at any time. A missing, corrupt, unsafe, unsupported, or too-large index falls back to the fresh catalog scan. |
| `~/.config/loom/control.json` | Temporary local control endpoint and bearer capability; Windows also holds client TLS credentials. | Private to the owning process. Do not commit, back up, or remove while the service is running. |
| `~/.config/loom/test-workspaces/<uuid>/` | Retained managed test project, including its `.loom/chains/` and `.loom/runs/` data. | Hidden from the ordinary recent-project list. Remove with `skill-loom workspace remove` after inspecting results; active-run ownership blocks cleanup. |
| `~/.config/loom/discovery-workspaces/<uuid>/` | Reviewed discovery handoff, bundled `scenario-discovery` package, managed project, result file, and run state. | Retained until explicit CLI cleanup; cleanup refuses the workspace that owns the active run. |
| `~/.config/loom/catalog-sources/<source-id>/<commit>/` | Compatibility snapshots of validated remote skill packages. | Not used by the default global catalog or current-session chain workflow. |
| User-selected download location (`*.loom-discovery.json`) | A self-contained discovery handoff with goal, harness, exact pinned candidate identities, and selected package files. | Returned on stdout by `skill-loom discovery handoff`; not persisted by the server. Treat it as potentially private and redistribution-restricted. Maximum 100 packages, 2,000 files, 20 MiB decoded content, and 30 MiB JSON. |
| `~/.config/loom/active-run.json` | Single global active-run pointer used for health reporting and startup recovery. | Holds only the active run's project path, run id, and status. |
| `~/.config/loom/chains/*.json` | Shared chain library, visible from every registered project context. | Versioned JSON written atomically. Back up with the config directory. |
| Podman volume `skill-loom-config` | Container deployment's config, shared chains, and derived index. | Persists across `podman:down`; inspect and back up with `podman volume export`. |
| `<project>/.loom/chains/*.json` | Legacy project-local chain definitions. | Copied into the shared library on first access; original files remain. Corrupt files and id collisions are reported. |
| `<project>/.agents/skills/` | Project-local copies installed by applying a shared chain. | Global source updates do not rewrite these copies; existing packages are never overwritten. |
| `<project>/.loom/runs/*.json` | Run snapshots, statuses, actions, and a bounded terminal tail per step. | At most a **200-line or 32 KiB** tail per step; never a full transcript. `.loom/runs/` is **git-ignored** by this repository's `.gitignore`. |
| `<project>/.loom/portable-runs/*.json` | Separate standalone-skill run snapshots, resolved input values, package fingerprints, attempts, and bounded summaries. A reused host-global package is recorded with `source: "global"` and its reviewed absolute path instead of a project copy. | Contains local input values and machine-local package paths; created and Git-ignored by the portable helper. Writes use same-directory temporary files and atomic replacement; directory fsync is attempted where supported and may be skipped on platforms that reject it. It does not use native run records or the global active-run pointer. |
| `~/.copilot/config.json` | Copilot's own persistent folder-trust configuration. | Skill Loom only reads `trustedFolders`; it never writes this file. |

Current portable helpers reject preparation or step execution if another
unfinished portable run is recorded in the project. The scan is limited to
1,000 other records and 64 MiB and fails closed on unsafe or corrupt records.
Archive completed records only when no helper can access them. Without the
opt-in protocol this does not coordinate with managed runs or other profiles,
and older helpers never participate. Operators must arrange exclusive project use
before installation or execution and maintain it through completion or explicit
abort. Status checks do not lock the project; stop if exclusive use cannot be
established.
Before enabling coordination, do not start another profile that knows a project while a managed run is
active. Recovery leaves active records not named by its own pointer unchanged
and logs `RUN_RECOVERY_AMBIGUOUS`, but a matching stale pointer does not prove
ownership.
Matching-pointer recovery initializes a project-local `.loom/project-claim.sqlite`
database and ignores it and its sidecars in `.loom/.gitignore`. Do not remove or
replace it while a service is running. If a claim exists or project coordination
is enabled, recovery retains the record and pointer and logs `RUN_RECOVERY_CLAIMED`.
Use project coordination review and separately confirmed actions to reconcile it.
Invalid coordination data blocks recovery.
Current participating clients migrate version 1 coordination databases to
version 2; older participating clients reject the new version. Stop and update
them before accessing the same project. Retired workspaces reject new run
mutations, and incomplete removal may be retried through the owning service.
Managed starts, actions, automatic transitions, and shutdown participate in the
protocol when enabled, and retain claims until separately reviewed. Process-tree
cleanup remains unverified; confirmations that descendants have stopped are
operator assertions, not proof.
If the active-run pointer is corrupt, startup fails with
`RUN_ACTIVE_POINTER_CORRUPT` and leaves the file unchanged. Establish that
earlier work and processes have stopped before inspecting it or restoring a
verified backup; do not delete it merely to bypass the error.

A run freezes an immutable snapshot of the chain definition and resolved inputs at creation. Editing the saved chain later does not change an existing or in-flight run, and retry uses the snapshot. Chain and run writes are versioned JSON with atomic temp-file replacement; restarting the server marks the active record named by its profile pointer as `interrupted` instead of assuming completion.

`skill-loom workspace list` shows retained disposable projects, `workspace inspect` reads bounded files from one, and `workspace remove` (with `"confirmed":true`) cleans one up. If cleanup reports that a workspace owns the active run, finish or explicitly abort/recover that run first. Workspaces isolate files from the original project only; they do not restrict the harness's normal filesystem, network, or credential access.

## Harness prerequisites

Skill Loom v1 supports exactly two harnesses. A chain is bound to one harness; per-step harness switching and per-step model selection are not supported.

| Harness | Verified version | Install | Authentication | Discovery |
|---------|------------------|---------|----------------|-----------|
| OpenCode | 2.2.5 | Install OpenCode and put `opencode` on `PATH`, or set `harnessCommands.opencode`. | Run `opencode auth login` in a terminal, or provide a supported provider credential through the environment. | Filesystem project `.agents/skills`, legacy project `.opencode/skills`, personal `~/.agents/skills` and `~/.config/opencode/skills`, and configured extra directories. |
| GitHub Copilot | CLI 1.0.105 | Install `@github/copilot` 1.0.105 and put `copilot` on `PATH`, or set `harnessCommands.copilot`. | Run `copilot login` in a terminal, or provide a supported GitHub token through the environment. | `copilot skill list --json` in the project directory, including project and host-global skill locations. |

Authentication is evidence-based: preflight may inspect command output, credential-file presence, or environment-variable **presence**, but it never reads credential values, copies tokens, or logs secrets. The supported login hints are:

- OpenCode: `opencode auth login`
- Copilot: `copilot login`, or set `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`

The host-global `LOOM_SKILLS_DIR` is the only authoring catalog. Applying a shared chain copies only its referenced packages into the project's `.agents/skills/` root. Copies are bounded, symlinks are refused, existing packages are never overwritten, and project copies do not track later global updates. Bundle import remains a compatibility path.

The chain editor's **Add instruction** adds an ordered standalone prompt without a catalog skill. It uses the same harness, inputs, session modes, and run controls as skill steps.

For compatibility, cross-installation sharing remains available through `skill-loom bundle create`. Review instructions and package contents with `bundle inspect` before sharing; bundle import still applies its review and confirmation requirements. New workflows use the shared chain library and global skills catalog instead. See the [legacy bundle workflow](user-guide.md#legacy-share-a-chain-as-a-bundle).

The default `loom-chain-workflow` uses the shared library and current global catalog, then performs ordered steps in the already-active agent session. It does not create portable run records or launch a nested harness. The legacy `loom-run-bundle` package remains for existing `.loom.json` artifacts only.

The discovery handoff is a different artifact from `skill-loom-chain` and is not accepted by chain import or execution APIs. `skill-loom discovery handoff` accepts only goal, harness, and immutable candidate identities; it resolves and verifies files from retained snapshots and rejects stale or unsafe packages. No artifact is retained server-side. The CLI helper treats the goal and package content as untrusted input, never executes package files, and writes the generated bundle exclusively. Native-agent selection is outside handoff v1; use the managed designer and run path for selected native agents.


Copilot CLI and OpenCode project skills both use `.agents/skills/` in Skill Loom's current adapter contract. This does not establish that every host version exposes subagents, isolated sessions, native forks, or skill reload. The runner must verify capabilities in the active host and block unsupported behavior; a shared-session fallback or handoff requires explicit user consent. Host-reported completion is not guaranteed work verification.

Preflight hard-blocks a missing harness executable, unauthenticated or ambiguously authenticated harness, unresolved Copilot trust, unresolved skills, missing required inputs, unsupported session modes, and a missing automatic-permission opt-in when Copilot automatic mode is selected. A dirty git tree is a warning, not a block. A non-git project skips the dirty-tree check.

## Copilot trust and automatic permissions

Copilot records persistent folder trust in `~/.copilot/config.json` under `trustedFolders`. Skill Loom reads that file and compares the canonical project path:

- A listed project is **trusted**.
- A missing or unlisted project is **untrusted** and hard-blocks a Copilot run.
- An unreadable or invalid config is **unknown**; preflight requires an explicit acknowledgement rather than assuming either outcome.

Skill Loom does not currently offer an in-app trust terminal. Run `copilot -C <absolute-project-path>` in a normal terminal and choose **Yes, and remember this folder for future sessions**; a session-only choice is not saved and is still reported as untrusted. Exit the terminal and rerun preflight. Skill Loom never writes `~/.copilot/config.json`. Preflight resolves trust before step 1 because a prompt queued behind a trust dialog can be swallowed.

Automatic Copilot mode requires an explicit per-chain opt-in. It is off by default. When enabled, Skill Loom passes the exact broad flags `--allow-all-paths` and `--allow-all-tools` for automatic steps and shows those flags at preflight and on the run; this grants broad filesystem and tool access inside the selected project. Revoke the opt-in on the chain to return to supervised mode. Supervised mode never passes automatic permission flags.

OpenCode automatic mode does not pass broad permission flags. Its intended advancement signal is OpenCode's terminal state sequence `OSC 7501` `state=working` followed by `state=idle`; Copilot automatic mode advances on process exit. A missing completion signal, non-zero exit, or a 30-minute per-step timeout pauses the run. Output-idle heuristics, animation quiescence, and fixed sleeps never advance a chain. At most one run can be active across the server; a second start is rejected while a run is starting, running, paused, or awaiting user input.

> **Live-verification scope:** the record-aware parser passed a user-supplied OpenCode 2.2.6 live probe. Managed multi-step automatic chain execution remains unverified and CLI starts remain blocked. See [Known live-verification gaps](#known-live-verification-gaps).

Watch a run with `skill-loom run attach --run <id>` (Ctrl-] detaches), `run show`, and `run events`; there is no browser run or terminal page. Attaching, showing, or streaming never starts, advances, or replays a step.

## Security model

Skill Loom is a **loopback-only** single-user application. The server binds to `127.0.0.1` and rejects non-loopback hosts. The app has **no authentication** and must not be exposed directly to a public or untrusted network. In the Podman deployment, the Caddy proxy shares the pod's network namespace and forwards to the loopback-bound app; the default host publish binds only to `127.0.0.1`. A private deployment may use a private authenticated platform/VPN ingress as its access boundary. Do not configure anonymous ingress, a public port, or multi-user access.

Trusted remote clients may run the packaged `skill-loom-podman` helper over an SSH-backed Podman connection. SSH and Podman authorize access to the host account's containers and mounts; this is not Skill Loom user authentication or a per-command permission boundary. The helper uses `podman exec` to invoke the in-container CLI, which uses the existing private control transport. It does not expose the HTTP server or control socket. Client-local apply transfers only a bounded manifest of selected global packages (up to 100 packages, 2,000 files, and 20 MiB) and does not send the client project path to the host. A live second-machine SSH flow has not yet been verified; see [known gaps](current-gaps.md#execution-gates).

The server owns all filesystem traversal, path canonicalization, persistence, CLI process spawning, and PTY handling. Harness processes are spawned with an executable plus an argument array, never a shell command string; project paths are canonicalized and traversal outside the intended project data directory is rejected. The chain editor performs no shell execution and receives only typed API data.

Skill Loom sends no telemetry, crash reporting, or remote logging. Git network access occurs only when a user explicitly refreshes a registered source; user-invoked harness CLIs and package installation may also use the network. Terminal output is streamed to `skill-loom run attach`; the chain editor never renders it, and skill text is rendered as escaped React text. Harness, skill, and run content is never rendered as raw HTML. Credentials and tokens are never persisted or logged.

## Backup and cleanup

Back up the global config if you want to preserve `harnessCommands`, extra skill directories, recent projects, and UI preferences:

```bash
cp ~/.config/loom/config.json ~/loom-config.backup.json
```

Back up the shared recipes by copying `~/.config/loom/chains/` with the config directory. Legacy project chain files remain after migration. Run records under `<project>/.loom/runs/` are optional compatibility history; because they can contain terminal output, treat them as sensitive local data and keep them out of version control.

Cleanup behavior:

- **Remove a recent project:** removes only the recent-entry record. The project directory and its files are untouched.
- **Delete a chain:** removes only that chain's file under `<project>/.loom/chains/`. `skill-loom chain project remove` requires `expectedRevision` and `"confirmed":true`; it cannot be undone.
- **Remove a chain:** removes only that chain's file under the shared library; legacy source copies remain available under the project's `.loom/chains/`.
- **Delete run history:** with no active run, remove individual files under `<project>/.loom/runs/`, or the directory. Do not delete `active-run.json` while a run is live; let Skill Loom release it, or restart the server so startup recovery marks the stale run interrupted.
- **Stop the server:** run `skill-loom service stop` (refused while a run is active) or let `SIGINT`/`SIGTERM` shut down PTYs, control-channel clients, and child processes. Do not kill harness children manually and then resume the run.
- **Reset all Skill Loom state for a test profile:** use a temporary `LOOM_CONFIG_DIR` and project directory; never point test tooling at your real `~/.config/loom`.

## Skill firing limitation

Skills are **model-invoked** context, not callable commands. Skill Loom guarantees deterministic **prompt order** only. That order is **not a guarantee** that the harness loads or fires a named skill: a model may decline to load a skill even when it exists and preflight resolved it.

Run records report skill observation on a best-effort basis, visible with `skill-loom run show`. OpenCode interactive output does not expose a reliable skill-load line, so its state is recorded as not observable. Copilot may print skill evidence that Skill Loom records as observed or not observed. None of these observations block or fail a step. Treat the attached terminal and the step result as the source of truth, and confirm skill behavior during acceptance rather than assuming it.

## Fork handoff behavior

A chain selects one session mode:

- **Shared** reuses one session id across steps.
- **Fresh** creates a new session id for each step.
- **Fork** asks for a new session derived from the previous step where the harness supports it.

OpenCode exposes a native `--fork` only on its headless `run` surface. Supervised interactive OpenCode fork and every Copilot fork use a deterministic **handoff** note instead; the note is explicitly labelled **not a native session fork**. It starts a new session seeded with the previous step's position, label, skill name, instruction, recorded status, and bounded terminal tail. The note is capped so no full transcript enters the prompt. Preflight states which mechanism applies for the selected harness and mode.

A handoff is not a byte-for-byte copy of the prior harness session. Treat it as a deterministic summary that lets the next step continue with useful context.

## Known live-verification gaps

These are current gaps between the intended contract and what was observed with the verified CLIs. They are not shipped claims.

- **Automatic OpenCode advancement:** Historical evidence recorded parser and clear-order mismatches. The record-aware fix passed the [user-supplied 2.2.6 probe](evidence/live-execution-2026-11-10-opencode-2.2.6-passed.json): prompt, product advancement, recall and cleanup passed. The managed multi-step automatic journey is still unverified, so automatic CLI starts remain blocked.
- **Platform coverage:** historical evidence covers Linux ARM64 with OpenCode 2.2.5 and Copilot CLI 1.0.105. The supplied passing execution probe covers Linux x64 with OpenCode 2.2.6 and Copilot CLI 1.0.107; Copilot retains an exact-baseline version warning. This is not cross-platform or full managed-chain acceptance.
- **Package release:** version `0.1.0` is declared in `package.json`, but the package is private and has no Git release tag or npm publication.

## OpenCode-only live verification

Run this from a current checkout on a machine
with Node 24+, dependencies installed, stable OpenCode 2.2.5 or newer on `PATH`, and an
authenticated, available model provider. This makes real network/model calls
and may incur charges. It creates a disposable project in the user cache and
an OpenCode session in the normal OpenCode session store; it attempts to delete
and verify removal of that session and the disposable project afterward. It is
not a sandbox. Review the final cleanup status, especially after interruption.

From a current checkout, confirm the tool versions:

```bash
node --version
opencode --version
```

Install dependencies with `npm install` if needed. Authenticate with
`opencode auth login` if necessary. To select a specific already-authenticated
model, optionally set `LOOM_LIVE_OPENCODE_MODEL` to its provider/model ID.
Clear inherited Loom and Copilot profile overrides for this probe, then run:

```bash
env -u LOOM_CONFIG_DIR -u COPILOT_HOME npm run test:live:execution -- --harness opencode
```

This mode does **not** invoke Copilot or use its broad permission flags. It
replaces `docs/evidence/live-execution-opencode.json` on each run; use
`--evidence /absolute/path/to/output.json` to select another output file.
The default command **without** `--harness opencode` runs both harnesses,
including Copilot headless with `--allow-all-paths --allow-all-tools`, and
replaces the combined `docs/evidence/live-execution.json`.

The probe checks a seeded interactive prompt, an observed OSC sequence, recall
in a second process using the same session, and the product's actual OSC state
machine. It removes the temporary skills before recall. Inspect the console and
the evidence file: `scope` must be `opencode`, `result` must be `passed`,
`opencode.product-advancement` must pass, the observed OpenCode version must be
a stable release at least 2.2.5, and
cleanup must report the temporary root removed, no tracked processes or PTYs
remaining, and the probe session deleted. A root `clear` between root `working`
and `idle` still resets observation; clearing a child record does not.
Inspect `harnesses.opencode.signal.records` (the first 64 records, with
`recordId: null` for root and `recordsTruncated` indicating omitted records),
checks, and warnings; do not treat
that mismatch, a version warning, a failed cleanup, or a failed/blocked check
as a pass. A successful session-delete command is not enough if the subsequent
session list cannot verify absence; that cleanup result fails closed.

Both live probes accept stable OpenCode releases >=2.2.5, including 2.2.6.
Prereleases do not qualify. Evidence retains the exact observed version;
`expectedVersion` is the 2.2.5 baseline and `versionMatches` remains an exact
equality check for historical compatibility. Thus `versionMatches: false`
alone is not a failure for a newer stable OpenCode release. Older or prerelease
versions still produce a version warning; the probe continues diagnostically,
but their results do not establish supported-version acceptance. Meeting the
minimum version does not prove signal compatibility or unblock automatic runs.

This verifies the captured interactive signal and session recall, **not** an
end-to-end automatic chain or actual skill invocation. A passing result alone
does not enable the blocked CLI automatic path. Share only the reviewed evidence
JSON and failure codes; inspect it for sensitive information first, and never
share credentials or full terminal transcripts. If cleanup reports failure,
follow its remediation for the specific recorded session or temporary path.

## Managed OpenCode acceptance

The interactive signal probe above does not exercise the automatic runner's
actual `opencode run` invocation. From a current checkout, after `npm install`,
use the dedicated managed probe on a machine with stable OpenCode >=2.2.5 and
an authenticated model provider:

```bash
# Optional: uncomment with an already-authenticated provider/model ID.
# export LOOM_LIVE_OPENCODE_MODEL=provider/model
npm run test:live:managed -- --confirm-live
```

`--confirm-live` explicitly approves real model calls (possibly paid) and a
temporary project configuration allowing file read/edit/search tools while
denying other tools and external-directory access. This is not an OS sandbox:
the installed harness still runs as you, with its normal provider credentials
and session store. No credentials are copied. The probe does not run Copilot.
It always creates its own Loom profile and Copilot home, ignoring inherited
profile overrides, strips inherited OpenCode session/config overrides, and
acquires the production profile lock before startup recovery. The optional
model setting is written only into the disposable project's config.

The probe uses production services, preflight, the run owner, persistence and
real PTYs. It does not replace the harness adapter, inject completion signals,
change automatic command selection, or enable the blocked CLI route. It runs:

1. A two-instruction shared-session automatic chain. Step one creates a small
   random-token artifact; step two reads it and creates a matching artifact.
   Both must complete once, in order, with the same session ID, matching files,
   one advancement edge per launch and completed persisted records.
2. A separate run paused during step one. The first step may finish, but the
   second must stay pending without its artifact. The probe then aborts it.
3. A separate active run aborted before step two. No second launch or artifact
   is allowed.
4. A separate active run stopped with orderly owner shutdown. A new owner
   recovers the interrupted record without starting any process or replaying.

Control scenarios wait for an observed `working` record before acting, not
just a running status or an elapsed startup delay.

There are at most five step launches; earlier failure stops subsequent
scenarios instead of retrying. Each step has a 180-second timeout. Use
`--timeout-ms 300000` for slower models (allowed range 500–600000 milliseconds).
The chain deadline accounts for both sequential steps. A missing OSC signal,
including a zero process exit without the declared OSC edge, is a failure—not
permission to substitute silence or an exit heuristic. In particular,
`opencode run` may behave differently from interactive `--prompt`, or may
reject the production session setup; preserve that diagnostic evidence rather
than pre-seeding a session or bypassing the guard.

The default evidence file is `docs/evidence/live-managed-opencode.json`;
`--evidence /absolute/path/result.json` selects another destination. The file
is atomically replaced and the command exits nonzero on any failed check or
cleanup. Review `checks` (none may remain `not-run`), `launches`, `runs` and
`cleanup`, not just the top-level result. Evidence includes redacted argument
vectors, bounded OSC records, artifact-match booleans and status summaries,
not prompts, token values, frozen inputs or terminal tails.

Cleanup stops the owner and tracked processes, deletes and verifies only the
observed OpenCode sessions, releases the profile lock and removes the temporary
tree. Failed cleanup retains its path as `retainedTemporaryRoot`; inspect the
specific session IDs and cleanup errors before removing retained work. Counts
cover tracked processes and PTYs, not escaped descendants.

Missing-signal, idle-only, nonzero-exit and timeout behavior is additionally
checked with deterministic executable fixtures:

```bash
npx vitest run tests/integration/live-managed-opencode.test.ts
```

Fixture results are not live evidence. The restart scenario is orderly
shutdown/recovery, not abrupt owner death. This probe does not establish
native-agent, skill-invocation, fresh/fork, cross-platform containment or
reviewed CLI start/action acceptance. Automatic CLI guards remain until live
managed evidence has passed and that reviewed CLI contract is verified.

## Troubleshooting

### Missing harness CLI

Preflight reports a blocking finding when `opencode` or `copilot` cannot be resolved. Confirm the exact binary is on the `PATH` used to launch Skill Loom (`command -v opencode`, `command -v copilot`), install the verified version, or set `harnessCommands.opencode` / `harnessCommands.copilot` in `~/.config/loom/config.json` to an absolute executable path. Restart Skill Loom after changing the server `PATH`, then rerun preflight. Skill Loom does not silently fall back from a broken override.

### Remote Podman connection

Confirm the host's rootless Podman service and Skill Loom app container are
running, and that `LOOM_PODMAN_CONNECTION` matches a connection shown by
`podman system connection list`. Test the connection with
`skill-loom-podman service status`; if that fails, resolve SSH identity,
account, or Podman connectivity before retrying. The client also needs Node.js
24+ and the workflow skill's packaged bridge. For client-local apply, verify
the host project and chain ids; an existing local skill package is reported as
a conflict and is never replaced.

### Authentication failure

Run `opencode auth login` or `copilot login` in a normal terminal and retry preflight. For token-based setups, confirm the relevant environment variable is present in the environment that launched Skill Loom; preflight reports presence only and never prints the value. An empty OpenCode credential store can be reported as unknown because providers may be configured elsewhere; use the CLI login when in doubt. Do not paste tokens into Skill Loom, issue reports, or the config file.

### Copilot trust block

If preflight says the folder is untrusted, run `copilot -C <absolute-project-path>` in a normal terminal and choose **Yes, and remember this folder for future sessions**. Session-only trust does not add the folder to `trustedFolders`. Skill Loom does not provide an in-app trust terminal; exit the terminal and rerun preflight. If Copilot's `~/.copilot/config.json` is unreadable or invalid, repair Copilot's own configuration or acknowledge the unknown-trust finding explicitly. Skill Loom never writes this file. A prompt queued during the trust dialog can be swallowed, so resolve trust before step 1.

### node-pty build failure

A `node-pty` install failure usually means the native toolchain is missing. Install Python 3, `make`, and a C++ compiler (Debian/Ubuntu: `build-essential python3`; macOS: Xcode Command Line Tools), then run `npm install` again or `npm rebuild node-pty`. Read the actual compiler error; Skill Loom and npm do not convert a native build failure into a successful install message. Confirm with `npm run test:unit` or by attaching to a supervised run with `skill-loom run attach`.

On a hosted macOS ARM64 runner, a clean install of `node-pty` 1.1.0 produced
`posix_spawnp failed` because its prebuilt `spawn-helper` had mode `0644`.
Skill Loom's postinstall grants the owner execute permission to regular,
privately linked installed helpers without changing their contents. An install
with lifecycle scripts disabled does not perform that repair. If a terminal
still fails, inspect the helper path and permissions from the directory where
Skill Loom resolves `node-pty`:

```bash
node -p "require('path').join(require('path').dirname(require.resolve('node-pty/package.json')), 'prebuilds', 'darwin-' + process.arch, 'spawn-helper')"
```

Verify that the printed path is the expected regular file in your installation,
not a symlink or hard link, before granting its owner execute permission with
`chmod u+x` on that exact path. Restart Skill Loom and retry the terminal. This
permission repair does not verify managed descendant cleanup.

### Dirty git tree

A dirty working tree is a preflight **warning**, not a block. Commit, stash, or discard the changes you do not want the harness to see, then rerun preflight; or acknowledge the warning if the state is intentional. A project that is not a git repository skips this check. Skill Loom never runs destructive git commands for you.

### Interrupted run

If the server stops, startup recovery marks the active record named by its profile pointer `interrupted` and clears the stale pointer. Active records without a matching pointer are left unchanged and reported in the server log; they may belong to another profile. Closing a browser or editor does not stop the run. Inspect the bounded step tail and reason with `skill-loom run show`, then use `run review-action` and `run action` to retry the interrupted step, continue from the next pending step, or restart from the snapshot. Nothing replays silently. Do not edit the run JSON by hand unless you are discarding the record.
