# Slan

Slan is a single-user local web application for assembling, saving, and running ordered chains of installed agent skills. It inventories the skills a selected CLI harness can load, lets you inspect them and build a reusable recipe, preflights the run, and executes the chain in a real interactive terminal.

Slan does not author skills and does not execute a skill as a callable command. Each chain step is sent to a local harness as a prompt; skills are **model-invoked** context. The chain order is prompt order, **not a guarantee** that a harness loads or fires a named skill. A harness may decline to load a skill even when preflight resolved it.

## Requirements

- **Node.js 24 or newer** (`package.json` declares `>=24`; the verified toolchain used Node 24.22.2).
- npm.
- A native build toolchain for `node-pty`: Python 3, `make`, and a C++ compiler. On Debian/Ubuntu install `build-essential` and `python3`; on macOS install the Xcode Command Line Tools.
- **OpenCode CLI 2.2.5** for OpenCode chains, installed and authenticated.
- **GitHub Copilot CLI 1.0.105** for Copilot chains, installed and authenticated.
- Git, optional but used for the `git init` option and the dirty-tree preflight warning.
- A Chromium browser for Playwright e2e; install it once with `npx playwright install chromium`.

## Install

```bash
npm install
```

`node-pty` compiles native code during installation. If the install fails at that step, install the native toolchain above and run `npm install` again (or `npm rebuild node-pty`). Slan does not hide a native build failure behind a generic install success message.

Harness CLIs are deliberately not installed by this project. Install OpenCode 2.2.5 and/or GitHub Copilot CLI 1.0.105 with their own installers, then confirm they are on `PATH`; alternatively set `harnessCommands.opencode` or `harnessCommands.copilot` in the Slan config.

## Development

```bash
npm run dev
```

This starts the Fastify API on `http://127.0.0.1:7373` and the Vite dev server on `http://127.0.0.1:5173`. Open the Vite URL in a browser. Vite proxies `/api` (including WebSocket upgrades) to the API server. Both processes bind to loopback only.

## Build and run

```bash
npm run build
npm start
```

`npm run build` builds the React UI into `dist/web` and compiles the server into `dist/src`. `npm start` runs the compiled server, which serves both the API and the built UI from the single loopback origin `http://127.0.0.1:7373`. The production server does not use the Vite dev proxy.

## Commands

| Capability | Command | Notes |
|------------|---------|-------|
| Install dependencies | `npm install` | Native `node-pty` build requires the toolchain above. |
| Development | `npm run dev` | API on 7373, Vite UI on 5173. |
| Build | `npm run build` | Web then server. |
| Start built app | `npm start` | Serves `dist/web` and the API on 7373. |
| Typecheck | `npm run typecheck` | Runs server and web project checks. |
| Unit tests | `npm run test:unit` | Vitest, Node environment. |
| Integration tests | `npm run test:integration` | Vitest, real Fastify composition root. |
| All Node tests | `npm test` | Unit and integration suites. |
| Browser end-to-end | `npm run test:e2e` | Builds and starts an isolated app; see below. |
| Live discovery probe | `npm run test:live:discovery` | Requires real harness CLIs. |
| Live execution probe | `npm run test:live:execution` | Requires real harness CLIs and may make paid model calls. |
| Documentation gate | `npm run check` | Runs `scripts/check-docs.mjs`. |

Playwright never reads or writes your real Slan or harness state. `npm run test:e2e` builds the app, starts it with a temporary `SLAN_CONFIG_DIR`, a temporary `HOME`, a temporary project area, and an isolated harness `PATH`; it never attaches to an already-running developer instance.

The live probes exercise real OpenCode and Copilot CLIs. They fail with a clear diagnostic when a required CLI is absent; they do not silently skip. Run them only when you intend to use the installed harnesses and credentials.

## First run

1. Start the development app with `npm run dev` and open `http://127.0.0.1:5173`, or build and run production with `npm run build && npm start` and open `http://127.0.0.1:7373`.
2. On the Projects screen, open an existing folder or create a new project. Registering a project records it in the recent-projects list; removing a recent entry does not delete project files.
3. Open the project workspace and expand the skill catalog (it starts collapsed). Choose the harness, search or expand a skill's `SKILL.md`, and optionally add extra skill directories in the settings dialog. A skill discovered from a personal, plugin, custom, or extra source can be copied into the project with **Copy into this project**; OpenCode copies land in `.opencode/skills/` and Copilot copies in `.github/skills/`.
4. Create a chain, add at least one step, choose the harness, give every step an instruction, declare any named inputs, and save. A saved chain is stored under `<project>/.slan/chains/`. **Save and run** saves the chain and opens its run-start screen.
5. On run start, choose supervised or automatic mode, provide required inputs, and run preflight. Preflight never makes a model call.
6. Resolve every blocking finding and acknowledge every required warning, then choose **Start run**. Slan creates the run through `POST /api/projects/<projectId>/runs`, re-runs the blocking preflight on the server, and opens the dedicated terminal page at `/runs/<runId>/terminal`.
7. The terminal page keeps xterm and the compact run controls together without scrolling past step details; **Run details** opens `/runs/<runId>` for the step rail, full controls, and recovery guidance. A run never advances because of terminal output, a timer, or a page load. A chain card's **Run** action returns to the run-start screen, and the project screen links to any active run.
8. To reuse a recipe, choose **Save copy to library** in the builder. The global library at `/chains` stores independent snapshots; importing one into another project copies it with a new chain id.

See the [operations guide](docs/OPERATIONS.md) for configuration, data locations, harness prerequisites, Copilot trust and automatic permissions, security, backup and cleanup, limitations, fork behavior, and troubleshooting.

## Security and privacy

Slan is **loopback-only**. The server binds to `127.0.0.1` by default, refuses any non-loopback `SLAN_HOST`, and has **no authentication** because there is no remote access. Never expose the port through a reverse proxy, tunnel, container port publish, or remote host.

The server owns all filesystem traversal, persistence, process spawning, and PTY handling. The browser performs no shell execution and receives only typed API and WebSocket data. Slan sends no telemetry, crash reports, remote logs, or outbound application requests; only user-invoked harness CLIs and package installation use the network. Credentials and tokens are never read into Slan, persisted, or logged.

## Operations guide

The full operator contract is in [docs/OPERATIONS.md](docs/OPERATIONS.md).
