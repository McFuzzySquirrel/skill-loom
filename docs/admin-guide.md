# Skill Loom Administrator Guide

This guide is for the person installing, configuring, backing up, upgrading, and troubleshooting Skill Loom on a local machine. End-user workflows are in the [user guide](user-guide.md); the full operator contract is in [OPERATIONS.md](OPERATIONS.md).

## Responsibilities and Architecture

Skill Loom is a **single-user local web application**. The administrator is usually the same person as the user. There is no server fleet, hosted control plane, database, or multi-tenant deployment.

At runtime:

- A Fastify server on `127.0.0.1:7373` serves the JSON/WebSocket API and the built React UI.
- A Vite dev server on `127.0.0.1:5173` serves the UI during development and proxies `/api` and WebSocket upgrades to Fastify.
- The server owns configuration, project registration, filesystem browsing, skill discovery, chain and run persistence, preflight, PTY transport, and run orchestration.
- Harness CLIs are spawned as child processes or PTYs with an executable and argument array, never a shell string.
- The browser is a typed API/terminal client; it cannot spawn processes or choose executables.

See [Architecture decisions](adr/README.md) for the durable choices behind this shape, especially [ADR-0001](adr/0001-loopback-only-single-user-server.md) and [ADR-0011](adr/0011-shell-free-process-and-pty-transport.md).

## Prerequisites

- **Node.js 24 or newer.** `package.json` declares `node >= 24`. The build, typecheck, Node test suites, and package smoke test for the 0.1.0 documentation refresh ran on Node 26.13.0, the same version recorded in the live evidence. A Node 24.22.2 toolchain was used earlier in development.
- **npm**.
- **A native build toolchain for `node-pty`:** Python 3, `make`, and a C++ compiler. Debian/Ubuntu: `sudo apt install build-essential python3`. macOS: Xcode Command Line Tools.
- **OpenCode CLI 2.2.5** for OpenCode chains, installed and authenticated.
- **GitHub Copilot CLI 1.0.105** for Copilot chains, installed and authenticated.
- **A desktop browser.** The application uses xterm.js and a desktop-oriented layout.
- **Git**, optional. It is used for the `git init` option and the dirty-tree preflight warning.
- **Disk access** to the project folders you register. Run records can contain terminal output and should be treated as sensitive local data.

Harness CLIs are deliberately not dependencies of this package. Install them with their own installers and confirm they resolve from the `PATH` used to launch Skill Loom.

## Installation

### From a checkout

```bash
git clone https://github.com/McFuzzySquirrel/skill-loom.git
cd skill-loom
npm install
npm run build
npm start
```

`npm install` compiles `node-pty`; a failure there is a native toolchain failure, not a hidden success. `npm run build` builds the React UI into `dist/web` and the server into `dist/src`. `npm start` runs the compiled server and serves the API and UI from `http://127.0.0.1:7373`.

For development:

```bash
npm run dev
```

This starts the API on `127.0.0.1:7373` and Vite on `127.0.0.1:5173`. Open the Vite URL; Vite proxies `/api` and WebSocket upgrades to the API.

### From a packed package

The npm package is named `skill-loom-cli` and exposes the `skill-loom` binary. It is still `"private": true`, so there is no registry release. Build and pack locally:

```bash
npm run build
npm pack
npx --yes --package=./skill-loom-cli-0.1.0.tgz skill-loom
```

The CLI accepts `--help`, `--version`, `--no-open`, `--port <number>`, and `--config-dir <path>`. It starts the same production server, prints the config directory and loopback URL, and opens a browser only when stdout is a TTY and `CI` is unset.

The tarball contains `dist/src`, `dist/web`, the compiled package metadata, `docs/OPERATIONS.md`, and the manifest. Source, tests, build scripts, and the other documentation files are excluded. Installing the package still builds the native `node-pty` module.

### Publishing is a deliberate future step

Before publishing, add repository metadata, verify the package name, flip `"private"`, run `npm run test:package`, and publish. Do not treat the current tarball as a supported public release.

## Configuration

The server reads configuration from the environment on each operation and from `~/.config/loom/config.json`.

| Setting | Default | Behavior |
|---|---|---|
| `LOOM_CONFIG_DIR` | `~/.config/loom` | Overrides the global config, recent-project, active-run pointer, and global chain template directory. A relative value is resolved against the server working directory. |
| `LOOM_HOST` | `127.0.0.1` | Bind host. Only `127.0.0.0/8`, `::1`, and `localhost` are accepted; anything else aborts startup. `localhost` is normalized to `127.0.0.1`. |
| `LOOM_PORT` | `7373` | TCP port from 1 to 65535. |
| `LOOM_WEB_ROOT` | discovered `dist/web` | Optional built-UI directory override for controlled deployments and tests. |

The config document is versioned and strict:

```json
{
  "version": 1,
  "harnessCommands": {
    "opencode": "/absolute/path/to/opencode",
    "copilot": "/absolute/path/to/copilot"
  },
  "extraSkillDirectories": ["/absolute/path/to/extra-skills"],
  "remoteSkillSources": [],
  "recentProjects": [],
  "uiPreferences": {}
}
```

- `harnessCommands` optionally overrides the executable name or absolute path. A missing entry resolves from `PATH`. A broken override is a block; Skill Loom does not silently fall back to the default name.
- `extraSkillDirectories` is the global extra-skill search list managed from the catalog settings dialog.
- `remoteSkillSources` stores validated HTTPS/SSH Git URLs and optional refs for skill packages and supported native agents. Pinned snapshots live under `<LOOM_CONFIG_DIR>/catalog-sources/`; credentials are never stored.
- `recentProjects` stores the canonical path, display name, derived id, and last-opened time.
- `uiPreferences` is opaque to the server; the web client owns its meaning.
- Credential-like fields such as `apiKey`, `token`, or `secret` are structurally invalid and are never stored. Do not add them.

Configuration writes use an atomic same-directory temporary-file replacement. A corrupt or unsupported-version config is reported, not silently rewritten or reset.

### CLI flags

| Flag | Effect |
|---|---|
| `--help`, `-h` | Print usage. |
| `--version`, `-v` | Print the package version. |
| `--no-open` | Do not open a browser. |
| `--port <number>` | Set `LOOM_PORT`. |
| `--config-dir <path>` | Set `LOOM_CONFIG_DIR`; relative paths are resolved to absolute. |

Environment variables remain authoritative when a flag is omitted.

## Identity, Secrets, and TLS

Skill Loom has **no application identity, authentication, or authorization**. It is **loopback-only** by design and refuses a non-loopback host. There is no TLS listener and no supported reverse-proxy deployment. Do not expose the port through a proxy, tunnel, container publish, or remote host.

Harness credentials belong to OpenCode or Copilot and stay in their own stores or environment. Skill Loom may inspect command output, credential-file presence, or environment-variable presence as authentication evidence, but it never reads credential values into its config, logs, or API responses. Preflight reports presence only.

If you need multi-user or remote access, this project does not provide it. Treat that as a new architecture and security decision, not a configuration change.

## Storage and Backups

| Path | Contents | Notes |
|---|---|---|
| `~/.config/loom/config.json` | Global config, executable overrides, extra skill directories, remote sources, recent projects, managed-workspace ownership, and UI preferences. | Override the directory with `LOOM_CONFIG_DIR`. Created with restrictive permissions. |
| `~/.config/loom/drafts/*.json` | Project-independent chain drafts. | Separate from templates and project chains; back up with the config directory. |
| `~/.config/loom/test-workspaces/<uuid>/` | Managed disposable projects created by **Test in disposable workspace**. | Retained until explicit cleanup from **Test workspaces**. Cleanup refuses the workspace holding the global active run. |
| `~/.config/loom/active-run.json` | Single global active-run pointer. | Holds the active run's project path, run id, and status. Do not edit while a run is live. |
| `~/.config/loom/chains/*.json` | Global chain templates. | Independent snapshots; importing copies one into a project with a new id. |
| `<project>/.loom/chains/*.json` | Saved project chains. | Versioned JSON, atomic writes. Back up or version these recipes. |
| `<project>/.loom/runs/*.json` | Run snapshots, statuses, actions, and bounded tails. | At most 200 lines or 32 KiB per step. Never a full transcript. This repository git-ignores `.loom/runs/`. |
| `<project>/.agents/skills/` | Newly copied and bundle-imported skill packages for either harness. | Independent project files; deleting a chain does not remove them. Include these in recipe backups when needed. Existing packages are not migrated. |
| `<project>/.opencode/agents/` and `<project>/.github/agents/` | Explicitly copied remote native agent definitions for the corresponding harness. | Copy never overwrites; chain preflight verifies the selected definition fingerprint. These are harness-specific and are not translated. |
| Browser download location (`*.loom.json`) | Portable chain and skill bundles. | Version 1 contains skills; version 2 can also contain one selected native agent and its pinned identity. No run history or input defaults; review package contents and redistribution rights before sharing. Not a complete backup. |
| Configured shared bundle directory | Immutable published `.loom.json` files. | Must be an existing absolute directory visible to the server and support same-directory hard links. Publication never replaces an existing file; the directory is local or mounted storage, not a hosted service. |
| `~/.copilot/config.json` | Copilot's own folder-trust configuration. | Skill Loom only reads `trustedFolders`; it never writes this file. |

Back up the configuration and recipes:

```bash
cp -a ~/.config/loom ~/loom-config-backup
```

Back up a project's recipes by copying `<project>/.loom/chains/`. Run records are optional history; because they can contain terminal output, treat backups as sensitive and keep them out of version control. This repository already ignores `.loom/runs/`.

Restore by stopping the server, replacing the config or chain directory, and starting again. Validate the restored JSON before use; valid chain version 1 documents migrate to version 2, while unsupported versions or corrupt documents are rejected.

Managed test workspaces are working directories, not security sandboxes. They use the normal harness permissions and authentication available to the server process. Keep disk usage under review and use the UI's explicit cleanup; do not remove a directory while its run is active.

The **Shared bundles** page stores the configured server-side directory in global config. Configure it only to a directory whose access policy and backups are appropriate for the bundles it will contain. Publishing requires review confirmations for bundle contents and redistribution rights; the server regenerates the bundle and checks the reviewed fingerprint before atomically creating a new file without clobbering another. Skill Loom does not harvest license files or independently establish redistribution rights. A mounted share that does not support hard links fails visibly rather than falling back to an overwrite-prone write.

### Portable bundle administration

Users can export saved project chains with their referenced skill packages and import them into another local installation. See the [sharing workflow](user-guide.md#share-a-chain-and-its-skills). This does not add remote access, user accounts, or a hosted sharing service.

The `skill-loom-chain` bundle is JSON with base64-encoded package files and executable flags. Version 1 remains the export for chains without a selected native agent; version 2 adds the selected native agent identity and definition. Export prefers one enabled project-local package to same-name personal or extra-directory packages, but rejects multiple distinct project packages. The server validates both preview and import, rejects unsupported versions, unsafe paths, symlinks, special files, excluded credential/dependency directories, duplicate paths, mismatched skill metadata, and incomplete packages. Limits are 100 skill packages, 2,000 combined files, 20 MiB decoded content, and 30 MiB per import request. Existing skill and agent files are never overwritten, and permission opt-in is reset. Ordinary file contents are not secret-scanned; review remains essential.

Portable bundle version 2 includes the selected agent's source id, commit, repository-relative path, native path, fingerprint, and bytes; it omits the repository URL and all local filesystem paths. The current portable helper inspects v2 agents but refuses to prepare a selected-agent chain because it cannot switch the current host conversation's agent. Use Loom's managed run path for selected native agents. Persisted chain version 2 includes the optional pinned agent identity; older application builds that understand only chain version 1 will reject version 2 chains and bundles.

The same-origin API exposes `GET /api/projects/:projectId/chains/:chainId/bundle`, `POST /api/projects/:projectId/chain-bundles/preview`, and `POST /api/projects/:projectId/chain-bundles/import`. POST bodies contain `bundle`; import additionally requires `confirmed: true` and an optional `reuseSkills` array of installed skill names. Preview is read-only. Import revalidates the bundle and conflicts and rolls back newly installed packages and agent definitions if chain persistence fails. A bundle does not install harness CLIs or external skill dependencies.

Standalone instruction steps use `kind: "instruction"` and contain `id`, `instruction`, and an optional `label`, with no `skillName`. Existing skill steps remain valid without a `kind`; explicit `kind: "skill"` is also supported. Both persist under versioned chain format 2. Older application builds that do not understand instruction steps or version 2 will reject such chains; use a compatible build on the receiving installation.

## Health Checks and Monitoring

The liveness endpoint is:

```bash
curl --fail --silent http://127.0.0.1:7373/api/health
```

It returns:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "configDirectory": "/home/you/.config/loom",
  "port": 7373,
  "activeRun": { "active": false, "runId": null, "status": null }
}
```

Use `/api/health` to confirm the process is listening, the version, the resolved config directory, and the port. The production composition currently reports the inactive placeholder in `activeRun`; use `GET /api/runs/active` or the UI's active-run banner for live run state.

`npm start` and the direct server entry log request/error output. The packaged CLI starts the server with the logger disabled and prints the config directory and URL. Skill Loom sends no telemetry, metrics, crash reports, or remote logs, so monitoring is local process supervision plus the health endpoint.

## Upgrades and Rollback

There is no published release channel or automated upgrade mechanism in `0.1.0`.

Upgrade procedure for a checkout:

1. Stop Skill Loom and let `SIGINT`/`SIGTERM` close PTYs and child processes.
2. Back up `~/.config/loom` and each project's `.loom/chains/`.
3. Fetch or replace the checkout with the new version.
4. Run `npm install` (the native `node-pty` build may need to rerun) and `npm run build`.
5. Start the server, open the UI, and call `/api/health`.
6. Run `npm run check`, `npm run typecheck`, and `npm test` if you are validating the build.
7. Run a small supervised chain against each harness before relying on it.

Rollback:

1. Stop the server.
2. Restore the previous checkout or tarball.
3. Run `npm install` and `npm run build` for that version.
4. Restore the configuration and chain backups if the newer version wrote data you do not want to keep.
5. Start the server and verify `/api/health`.

Config, chain, run, and active-run documents carry explicit versions. An unknown version is rejected rather than reinterpreted. Version 1 is the current persisted format; there is no general migration tool.

## Known Limitations

- **Automatic OpenCode advancement is not proven end-to-end.** The live execution evidence records `OSC7501_PRODUCT_PARSER_MISMATCH`: OpenCode 2.2.5 emitted colon-separated `OSC 7501` parameters while the product parser splits on `;`. The probe's own parser recognized the signal; the product parser did not. Supervised OpenCode runs are unaffected by this specific mismatch. Do not rely on automatic OpenCode chains until the parser is fixed and the live probe is rerun.
- **`/api/health` activeRun is a placeholder in production.** Use `GET /api/runs/active` for live run state.
- **One harness per chain; no per-step harness or model selection.**
- **Native fork is available only on OpenCode's headless surface.** Supervised OpenCode and all Copilot forks use a deterministic handoff note, not a native session fork.
- **One active run globally.** A second start is rejected while a run is starting, running, paused, or awaiting user input.
- **Run history is bounded.** A step tail is at most 200 lines or 32 KiB; there is no full transcript.
- **No authentication, TLS, or remote access.** This is intentional, not a missing configuration.
- **No published npm package or Git release tag.** Version `0.1.0` is declared locally and the package is private.
- **Live evidence is platform-specific.** The recorded probes ran on Linux ARM64 with OpenCode 2.2.5 and Copilot CLI 1.0.105; other platforms and versions are unverified.

## Troubleshooting

### The server refuses to start with a host error

`LOOM_HOST` must be loopback. Use `127.0.0.1`, `::1`, or `localhost`. Startup aborts for any other value; this is the security boundary, not a bug.

### The port is already in use

Choose another loopback port:

```bash
LOOM_PORT=7399 npm start
```

The packaged CLI also accepts `--port 7399`.

### `node-pty` fails to build

Install Python 3, `make`, and a C++ compiler, then rerun `npm install` or `npm rebuild node-pty`. Read the compiler error; a native build failure is not converted into a successful install.

### The config is reported corrupt or unsupported

Inspect `~/.config/loom/config.json`. A missing or wrong `version`, an unknown top-level key, or a credential-like field is rejected. Repair the file deliberately or restore a backup. Skill Loom does not silently rewrite it.

### A harness is missing or not authenticated

Confirm `command -v opencode` or `command -v copilot` in the environment that launches Skill Loom, install the verified version, or set `harnessCommands`. Run `opencode auth login` or `copilot login`. Use absolute executable paths for overrides.

### Copilot trust is blocked

Use the trust panel, or run `copilot -C <absolute-project-path>` manually, accept the folder-trust dialog, exit, and rerun preflight. Skill Loom reads `~/.copilot/config.json` and never writes it. Resolve trust before step 1 because a prompt queued behind the dialog can be swallowed.

### A run is interrupted or the active pointer is stale

Restart the server and let startup recovery mark active records `interrupted` and clear the stale pointer. Then use **Retry interrupted step**, **Continue from next pending step**, or **Restart chain** in the run view. Do not delete `active-run.json` while a run is live.

### A corrupt run or chain file appears

The list reports a warning and leaves the file in place; it is not deleted or rewritten. Inspect the file, restore a backup, or remove it deliberately. Do not rely on a corrupt file being silently ignored as if the record did not exist.

For the full troubleshooting contract, including the dirty Git tree, node-pty, missing CLI, authentication, trust, and interrupted-run cases, see [OPERATIONS.md](OPERATIONS.md#troubleshooting).

## Security and Privacy Checklist

- [ ] `LOOM_HOST` is loopback (or unset) and the process is not published through a proxy, tunnel, or container port.
- [ ] `~/.config/loom` is readable only by the intended local user; config writes use restrictive permissions.
- [ ] No credential, token, API key, or secret is pasted into `config.json`, a chain, a run, or a support report.
- [ ] Harness CLIs are authenticated in their own stores; Skill Loom reports presence only.
- [ ] Copilot folder trust is resolved through Copilot's dialog; `~/.copilot/config.json` is not edited by hand unless you are repairing Copilot itself.
- [ ] The automatic-permission opt-in is enabled only for chains that genuinely need broad filesystem and tool access, and the exact flags are reviewed at preflight.
- [ ] Run records and backups are treated as sensitive and kept out of version control.
- [ ] Dependencies are installed from the lockfile and reviewed before upgrading.
- [ ] Live harness versions match the documented verified versions before relying on automatic behavior.

## Recovery and Support

- **Run recovery:** restart the server, inspect the interrupted run, and choose retry, continue, or restart. Nothing replays silently.
- **Data recovery:** restore `~/.config/loom` or `<project>/.loom/chains/` from backup. Run history is optional and may be deleted when no run is active.
- **Stale active pointer:** let startup recovery clear it; do not remove it while a run is live.
- **Support ownership and intake:** see [SUPPORT.md](SUPPORT.md).
- **Release notes and validation evidence:** see [releases/0.1.0.md](releases/0.1.0.md) and [evidence](evidence/).
- **Security reports:** do not publish credentials, tokens, or private paths in an issue. Contact the maintainer privately through the repository's GitHub profile.
