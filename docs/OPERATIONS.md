# Skill Loom Operations Guide

This guide is the operator contract for the local Skill Loom v1 application. It covers configuration, on-disk data, harness prerequisites, Copilot trust and automatic permissions, the security model, backup and cleanup, known limitations, fork handoff behavior, and troubleshooting.

Read [README.md](../README.md) first for install, development, build, start, and test commands.

## Configuration

Skill Loom stores global configuration in `~/.config/loom/config.json` by default. Set `LOOM_CONFIG_DIR` to use a different directory, for example an isolated directory for tests or a separate profile:

```bash
LOOM_CONFIG_DIR=/absolute/path/to/loom-profile npm start
```

`LOOM_CONFIG_DIR` is read on every configuration operation. A relative value is resolved against the server's working directory, so an absolute path is recommended. The directory is created when the configuration is first written.

| Environment variable | Default | Behavior |
|----------------------|---------|----------|
| `LOOM_CONFIG_DIR` | `~/.config/loom` | Overrides the global config, recent-project, and active-run pointer location. |
| `LOOM_HOST` | `127.0.0.1` | Bind host. Only `127.0.0.0/8`, `::1`, and `localhost` (normalized to `127.0.0.1`) are accepted; any other value aborts startup. |
| `LOOM_PORT` | `7373` | TCP port from 1 to 65535. |
| `LOOM_WEB_ROOT` | discovered `dist/web` | Optional override for the built UI directory; intended for controlled deployments and tests. |

The versioned config document contains `version`, `harnessCommands`, `extraSkillDirectories`, `recentProjects`, and `uiPreferences`. `harnessCommands` may override the executable name or absolute path for `opencode` or `copilot`; a missing entry resolves from `PATH`. The config schema is strict: credential-like fields such as `apiKey`, `token`, or `secret` are invalid and are never stored there. Configuration writes use an atomic temporary-file replacement. A corrupt or unsupported-version config is reported rather than silently rewritten.

`extraSkillDirectories` is the global list managed from the skill-catalog settings dialog. Recent projects store the canonical path, display name, derived id, and last-opened time; removing a recent entry never removes project files.

## Data locations

| Path | Contents | Notes |
|------|----------|-------|
| `~/.config/loom/config.json` | Global config, harness command overrides, extra skill directories, recent projects, UI preferences. | Override the whole directory with `LOOM_CONFIG_DIR`. |
| `~/.config/loom/active-run.json` | Single global active-run pointer used for health reporting and startup recovery. | Holds only the active run's project path, run id, and status. |
| `~/.config/loom/chains/*.json` | Global chain templates saved with **Save copy to library**. | Independent snapshots, not live links to project chains. Importing copies one into a project with a new id. |
| `<project>/.loom/chains/*.json` | Saved chain definitions, including steps, inputs, harness, session mode, and the automatic-permission opt-in. | Versioned JSON written atomically. Chain files can be backed up or versioned if you want to keep recipes. |
| `<project>/.loom/runs/*.json` | Run snapshots, statuses, actions, and a bounded terminal tail per step. | At most a **200-line or 32 KiB** tail per step; never a full transcript. `.loom/runs/` is **git-ignored** by this repository's `.gitignore`. |
| `~/.copilot/config.json` | Copilot's own persistent folder-trust configuration. | Skill Loom only reads `trustedFolders`; it never writes this file. |

A run freezes an immutable snapshot of the chain definition and resolved inputs at creation. Editing the saved chain later does not change an existing or in-flight run, and retry uses the snapshot. Chain and run writes are versioned JSON with atomic temp-file replacement; restarting the server marks records that were active as `interrupted` instead of assuming completion.

## Harness prerequisites

Skill Loom v1 supports exactly two harnesses. A chain is bound to one harness; per-step harness switching and per-step model selection are not supported.

| Harness | Verified version | Install | Authentication | Discovery |
|---------|------------------|---------|----------------|-----------|
| OpenCode | 2.2.5 | Install OpenCode and put `opencode` on `PATH`, or set `harnessCommands.opencode`. | Run `opencode auth login` in a terminal, or provide a supported provider credential through the environment. | Filesystem `.opencode/skills` packages under the project, `~/.config/opencode/skills`, and configured extra directories. |
| GitHub Copilot | CLI 1.0.105 | Install `@github/copilot` 1.0.105 and put `copilot` on `PATH`, or set `harnessCommands.copilot`. | Run `copilot login` in a terminal, or provide a supported GitHub token through the environment. | `copilot skill list --json` in the project directory. |

Authentication is evidence-based: preflight may inspect command output, credential-file presence, or environment-variable **presence**, but it never reads credential values, copies tokens, or logs secrets. The supported login hints are:

- OpenCode: `opencode auth login`
- Copilot: `copilot login`, or set `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`

The skill catalog starts collapsed. Expanding an entry from a non-project source exposes **Copy into this project**, which copies the whole package into `<project>/.opencode/skills/` for OpenCode or `<project>/.github/skills/` for Copilot. The copy is bounded, refuses symlinks, and never overwrites an existing package; a numeric suffix is used instead. The original personal, plugin, custom, or extra skill is left untouched.

Preflight hard-blocks a missing harness executable, unauthenticated or ambiguously authenticated harness, unresolved Copilot trust, unresolved skills, missing required inputs, unsupported session modes, and a missing automatic-permission opt-in when Copilot automatic mode is selected. A dirty git tree is a warning, not a block. A non-git project skips the dirty-tree check.

## Copilot trust and automatic permissions

Copilot records persistent folder trust in `~/.copilot/config.json` under `trustedFolders`. Skill Loom reads that file and compares the canonical project path:

- A listed project is **trusted**.
- A missing or unlisted project is **untrusted** and hard-blocks a Copilot run.
- An unreadable or invalid config is **unknown**; preflight requires an explicit acknowledgement rather than assuming either outcome.

The trust panel can start an interactive trust session in the project directory. Accept the Copilot folder-trust dialog there, then verify trust again; Skill Loom reads the result back from Copilot's config and never writes it. The manual fallback is to run `copilot -C <absolute-project-path>` yourself, accept the trust dialog, exit, and rerun preflight. Preflight resolves trust before step 1 because a prompt queued behind a trust dialog can be swallowed.

Automatic Copilot mode requires an explicit per-chain opt-in. It is off by default. When enabled, Skill Loom passes the exact broad flags `--allow-all-paths` and `--allow-all-tools` for automatic steps and shows those flags at preflight and on the run; this grants broad filesystem and tool access inside the selected project. Revoke the opt-in on the chain to return to supervised mode. Supervised mode never passes automatic permission flags.

OpenCode automatic mode does not pass broad permission flags. It advances only after observing OpenCode's terminal state sequence `OSC 7501` `state=working` followed by `state=idle`; Copilot automatic mode advances on process exit. A missing completion signal, non-zero exit, or a 30-minute per-step timeout pauses the run. Output-idle heuristics, animation quiescence, and fixed sleeps never advance a chain. At most one run can be active across the server; a second start is rejected while a run is starting, running, paused, or awaiting user input.

Starting a run opens the dedicated terminal page at `/runs/<runId>/terminal`, which keeps the xterm surface and compact controls visible without scrolling. **Run details** opens `/runs/<runId>` for the step rail, full controls, and recovery guidance. Both routes request the same run snapshot and event stream; neither starts, advances, or replays a step on load.

## Security model

Skill Loom is a **loopback-only** single-user application. The server binds to `127.0.0.1`, rejects non-loopback hosts, and has **no authentication** because it is not designed for remote access. Never expose it through a reverse proxy, tunnel, published container port, or remote host. The full-filesystem folder browser is an accepted single-user risk on a loopback origin.

The server owns all filesystem traversal, path canonicalization, persistence, CLI process spawning, and PTY handling. Harness processes are spawned with an executable plus an argument array, never a shell command string; project paths are canonicalized and traversal outside the intended project data directory is rejected. The browser performs no shell execution and receives only typed API and WebSocket data.

Skill Loom sends no telemetry, crash reporting, remote logging, or outbound application requests. Only the user-invoked harness CLI and package installation may use the network. Terminal output is rendered through xterm.js and skill text through escaped React text; harness, skill, and run content is never rendered as raw HTML. Credentials and tokens are never persisted or logged.

## Backup and cleanup

Back up the global config if you want to preserve `harnessCommands`, extra skill directories, recent projects, and UI preferences:

```bash
cp ~/.config/loom/config.json ~/loom-config.backup.json
```

Back up a project's recipes by copying `<project>/.loom/chains/`, and back up reusable templates by copying `~/.config/loom/chains/`. Run records under `<project>/.loom/runs/` are optional history; because they can contain terminal output, treat them as sensitive local data and keep them out of version control. This repository already ignores `.loom/runs/`.

Cleanup behavior:

- **Remove a recent project:** removes only the recent-entry record. The project directory and its files are untouched.
- **Delete a chain:** removes only that chain's file under `<project>/.loom/chains/`. The action is confirmed in the UI and cannot be undone.
- **Remove a global template:** removes only its file under `~/.config/loom/chains/`. Imported project copies are independent and are not affected.
- **Delete run history:** with no active run, remove individual files under `<project>/.loom/runs/`, or the directory. Do not delete `active-run.json` while a run is live; let Skill Loom release it, or restart the server so startup recovery marks the stale run interrupted.
- **Stop the server:** close browser sessions and let `SIGINT`/`SIGTERM` shut down PTYs, WebSocket subscribers, and child processes. Do not kill harness children manually and then resume the run.
- **Reset all Skill Loom state for a test profile:** use a temporary `LOOM_CONFIG_DIR` and project directory; never point test tooling at your real `~/.config/loom`.

## Skill firing limitation

Skills are **model-invoked** context, not callable commands. Skill Loom guarantees deterministic **prompt order** only. That order is **not a guarantee** that the harness loads or fires a named skill: a model may decline to load a skill even when it exists and preflight resolved it.

The run view reports skill observation on a best-effort basis. OpenCode interactive output does not expose a reliable skill-load line, so its state is shown as not observable. Copilot may print skill evidence that Skill Loom records as observed or not observed. None of these observations block or fail a step. Treat the terminal and the step result as the source of truth, and confirm skill behavior during acceptance rather than assuming it.

## Fork handoff behavior

A chain selects one session mode:

- **Shared** reuses one session id across steps.
- **Fresh** creates a new session id for each step.
- **Fork** asks for a new session derived from the previous step where the harness supports it.

OpenCode exposes a native `--fork` only on its headless `run` surface. Supervised interactive OpenCode fork and every Copilot fork use a deterministic **handoff** note instead; the note is explicitly labelled **not a native session fork**. It starts a new session seeded with the previous step's position, label, skill name, instruction, recorded status, and bounded terminal tail. The note is capped so no full transcript enters the prompt. Preflight states which mechanism applies for the selected harness and mode.

A handoff is not a byte-for-byte copy of the prior harness session. Treat it as a deterministic summary that lets the next step continue with useful context.

## Troubleshooting

### Missing harness CLI

Preflight reports a blocking finding when `opencode` or `copilot` cannot be resolved. Confirm the exact binary is on the `PATH` used to launch Skill Loom (`command -v opencode`, `command -v copilot`), install the verified version, or set `harnessCommands.opencode` / `harnessCommands.copilot` in `~/.config/loom/config.json` to an absolute executable path. Restart Skill Loom after changing the server `PATH`, then rerun preflight. Skill Loom does not silently fall back from a broken override.

### Authentication failure

Run `opencode auth login` or `copilot login` in a normal terminal and retry preflight. For token-based setups, confirm the relevant environment variable is present in the environment that launched Skill Loom; preflight reports presence only and never prints the value. An empty OpenCode credential store can be reported as unknown because providers may be configured elsewhere; use the CLI login when in doubt. Do not paste tokens into Skill Loom, issue reports, or the config file.

### Copilot trust block

If preflight says the folder is untrusted, use the trust panel to start the interactive Copilot trust session and accept the dialog, or run `copilot -C <absolute-project-path>` manually and accept it. Then verify trust in the trust panel and rerun preflight. If Copilot's `~/.copilot/config.json` is unreadable or invalid, repair Copilot's own configuration or acknowledge the unknown-trust finding explicitly. Skill Loom never writes this file. A prompt queued during the trust dialog can be swallowed, so resolve trust before step 1.

### node-pty build failure

A `node-pty` install failure usually means the native toolchain is missing. Install Python 3, `make`, and a C++ compiler (Debian/Ubuntu: `build-essential python3`; macOS: Xcode Command Line Tools), then run `npm install` again or `npm rebuild node-pty`. Read the actual compiler error; Skill Loom and npm do not convert a native build failure into a successful install message. Confirm with `npm run test:unit` or by starting the server and opening a run terminal.

### Dirty git tree

A dirty working tree is a preflight **warning**, not a block. Commit, stash, or discard the changes you do not want the harness to see, then rerun preflight; or acknowledge the warning if the state is intentional. A project that is not a git repository skips this check. Skill Loom never runs destructive git commands for you.

### Interrupted run

If the server stops, the browser closes, or a step loses its process, startup recovery marks records that were active as `interrupted` and clears the stale active-run pointer. Open the run view and choose the offered recovery action: **Retry interrupted step** restarts only that step with the existing session plan, **Continue** resumes after the recorded point when available, and **Restart** creates a new run from the snapshot. Nothing replays silently on reload. Inspect the bounded step tail and reason before retrying, and do not edit the run JSON by hand unless you are discarding the record.
