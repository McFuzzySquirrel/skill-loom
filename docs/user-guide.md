# Skill Loom User Guide

This guide is for the person using Skill Loom to browse installed skills, build a chain, and run it against a local OpenCode or GitHub Copilot CLI. Installation and machine administration are covered in the [administrator guide](admin-guide.md).

## Who This Is For

Skill Loom is a **single-user, local** application. The person at the browser is the only user: there are no accounts, roles, sharing links, or remote collaborators. It is intended for a developer or operator who already uses a supported harness and wants to assemble repeatable skill prompts without writing a script.

If you need to install Node.js, build `node-pty`, install a harness CLI, or choose a config directory, start with the [administrator guide](admin-guide.md).

## Before You Begin

You need:

- Skill Loom running locally and its loopback URL open in a desktop browser. The default URL is `http://127.0.0.1:7373` for a production build or `http://127.0.0.1:5173` for `npm run dev`.
- A project folder you are willing to let a harness read and modify. Chain and run data is written under `<project>/.loom/`.
- The harness you intend to use installed, authenticated, and resolvable from the `PATH` that launched Skill Loom:
  - OpenCode 2.2.5 for OpenCode chains.
  - GitHub Copilot CLI 1.0.105 for Copilot chains.
- For Copilot, the project folder trusted in Copilot's own trust dialog before the first run.
- Optional: a Git repository in the project if you want the dirty-tree preflight warning. A non-Git project skips that warning.

Skill Loom does not install or authenticate harnesses for you, and it does not send prompts to a hosted service of its own.

## Sign In and First Use

There is **no sign-in**. Skill Loom binds to loopback and has **no authentication** because it is not designed for remote access. Do not expose the port through a reverse proxy, tunnel, container port publish, or remote host.

On first load you land on **Projects**. The header shows:

- **Local-only**, a reminder that the server is loopback-bound.
- **Server connected · v0.1.0**, the health indicator. If it changes to **Server connection error**, use **Retry**.
- **Projects**, **Scenario catalog**, and **Chain library** navigation.

Register an existing folder with the folder browser or create a new project. Registering a project records it in the recent-projects list; removing a recent entry does not delete the folder.

## Main Workflows

### Register and open a project

1. From **Projects**, choose an existing folder or create a new one. Creating a project can optionally initialize a Git repository.
2. Open the project workspace. The project name appears in the header and the chain library is scoped to that project.
3. The skill catalog starts collapsed. Expand it when you need it.

### Browse the skill catalog

1. Choose the harness whose installed skills you want to inspect.
2. Search, or expand a skill to read its `SKILL.md` metadata. Skill text is displayed as escaped text, never as raw HTML.
3. Optionally add extra skill directories from the catalog settings dialog. Extra directories are global, not per project.
4. A skill from a personal, plugin, custom, or extra source can be copied into the project with **Copy into this project**. OpenCode copies land in `<project>/.opencode/skills/`; Copilot copies land in `<project>/.github/skills/`. The copy is bounded, refuses symlinks, and never overwrites an existing package.

Copilot's own discovery command runs in the project directory. Skill Loom writes project copies to `.github/skills/`, a project-skill location recognized by Copilot CLI; the CLI also supports `.agents/skills/`.

### Start from a scenario example

The [Scenario catalog](scenario-chains.md) provides illustrative starter chains for business, study, app development, and game development. Filter and review the steps, inputs, prerequisites, pinned revisions, and third-party skill sources, then copy an example into an open project to adapt it in the normal chain builder. Examples are not prescribed workflows or endorsements, and the catalog is not an exhaustive list.

Copying a scenario creates only an ordinary independent project chain; it does not install skills or run a command. To copy an included third-party skill into the selected project's harness directory, use that skill's explicit **Add bundled skill to project** action. Review its source and license first. Skill Loom preserves supplied upstream license files and adds a `SKILL-LOOM-SOURCE.md` notice with the pinned source revision. It does not execute package scripts, fetch updates, or contact the upstream source. A same-name skill already visible to the selected harness must be resolved or renamed before a bundled copy can be added. Preflight blocks a run when a required skill is missing. Every copied chain is an ordinary independent project chain with a shared-session default and broad automatic permissions disabled.

### Build and save a chain

1. Create a chain and choose one harness. A chain is bound to that harness; per-step harness selection is not supported.
2. Add at least one step. Choose a catalog skill with **Add as step**, or use **Add instruction** for a standalone agent prompt without an installed skill. Both require a non-whitespace instruction and support an optional label.
3. Reorder steps by dragging or with **Move up** and **Move down**. The visible order is the prompt order.
4. Optionally declare named inputs and reference them from instructions as `{{name}}`. Input names use identifier syntax; required inputs must resolve before a run starts.
5. Choose a session mode: **shared**, **fresh**, or **fork**. See [Session modes](#session-modes).
6. For Copilot automatic mode, explicitly enable the automatic-permission opt-in. It is off by default and grants broad filesystem and tool access.
7. Choose **Save and run** to save under `<project>/.loom/chains/` and open the run-start screen, or save without running.

An unsaved chain shows a dirty indicator. Navigating away or closing the tab prompts before discarding unsaved changes.

Instruction steps run through the chain's selected harness in the same order and session mode as skill steps. They support `{{name}}` inputs, retry, skip, recovery, and both supervised and automatic runs. They do not request a skill or require catalog resolution. An instruction is a normal prompt, not a higher-priority system instruction or a custom agent definition.

### Reuse a chain

- **Save copy to library** stores an independent snapshot in the global library at **Chain library** (`/chains`).
- Importing a library template into a project copies it with a new chain id. The project copy is independent; later edits to the template do not affect it.
- Duplicating a project chain also creates a separate chain id.
- Deleting a chain or a global template removes only that file. It does not remove the other copies.

### Share a chain and its skills

1. Save the chain, then return to the project's **Chains** list and choose **Export** on its card. Export uses the saved version, not an unsaved builder draft.
2. Review the chain instructions, input definitions, package file lists, and `SKILL.md` previews. The bundle includes complete referenced skill packages: scripts, binary assets, and supporting files, with executable flags preserved.
3. Confirm that you reviewed the contents and have redistribution permission, then choose **Download bundle**. Send the resulting `.loom.json` file using your own file-sharing method; Skill Loom does not upload it or create a public link.

The export excludes input default values, run records, terminal output, local catalog source paths, chain identity/timestamps, and automatic-permission consent. It refuses packages containing symbolic links, special files, `.env` files, credential-named files, `.git`, `.loom`, `.ssh`, or `node_modules` directories rather than silently exporting a partial package. This is not a secret scanner: secrets, private paths, or confidential material inside ordinary instructions and files must be removed before sharing.

Every skill name must resolve to exactly one enabled, readable package. Missing, ambiguous, or non-filesystem skills block export. Bundles support up to 100 skill packages, 2,000 files, and 20 MiB of decoded file content; the JSON upload limit is 30 MiB. Directory names and file paths must be portable and safe, and directory nesting is bounded.

### Import a shared chain

1. Open the destination project and choose **Import bundle** in its **Chains** list.
2. Select a `.loom.json` file. Preview validates the bundle without installing files. Review its harness, steps, inputs, package file lists, and `SKILL.md` text.
3. If a skill name is already installed, explicitly choose **Reuse installed** to keep your version; its contents may differ from the bundle. Import never overwrites an existing skill package. If a destination directory exists without a matching catalog skill, cancel and resolve that directory conflict first.
4. Confirm that you trust the instructions and packages, then choose **Import chain and skills**.
5. Open the new chain, provide inputs, review automatic permissions, and run preflight before running it.

Import creates an independent chain with a fresh id and timestamps, resets automatic-permission consent to off, and installs new packages under `.opencode/skills/` for OpenCode or `.github/skills/` for Copilot. It rechecks conflicts at import time and removes newly installed packages if saving the chain fails. Existing packages remain untouched. Import never executes bundled scripts, starts a run, authenticates a harness, or grants folder trust. Removing the imported chain later does not remove its installed skills.

The recipient still needs the selected harness and any external tools, services, or dependencies used by the skills. For Copilot, confirm the imported skills appear in its catalog; the project copy destination has the same live-verification limitation described above. Bundles are not backups of project files or the global library, and exporting a global template requires first importing it into a project.

### Session modes

| Mode | Behavior |
|---|---|
| **Shared** | Reuses one session id across every step. |
| **Fresh** | Creates a new session id for each step. |
| **Fork** | Asks for a new session derived from the previous step. OpenCode headless can use a native `--fork`; supervised OpenCode and all Copilot forks use a deterministic **handoff** note. A handoff is **not a native session fork**; it starts a new session seeded with the previous step's position, label, skill, instruction, status, and bounded tail. |

Preflight states which mechanism applies before you start.

### Preflight and start a run

1. On the run-start screen, choose **supervised** or **automatic**.
2. Provide every required input and review the selected session plan and permission scope.
3. Choose **Run preflight**. Preflight makes no model call. It checks the harness executable, authentication evidence, Copilot trust, catalog resolution, inputs, session mode, permissions, and Git state.
4. Resolve every blocking finding. Acknowledge required warnings, such as ambiguous authentication or an unknown trust result.
5. Choose **Start run**. The server re-runs the blocking preflight, creates the run, freezes the chain snapshot and resolved inputs, and opens `/runs/<runId>/terminal`.

A dirty Git tree is a warning, not a block. Preflight never makes a model call and never edits your files.

### Supervised run controls

Supervised mode gives you the interactive terminal and explicit outcomes. A step never advances because output went quiet or a page loaded.

- **Mark done** records the step as done and enables **Next**.
- **Mark failed** records the step as failed and pauses for **Retry**, **Skip**, or **Abort**.
- **Mark skipped** records the step as skipped with a reason and enables **Next**.
- **Retry**, **Skip**, and **Abort** remain available according to the server-published action flags.

The terminal page keeps the xterm surface and compact controls together. **Run details** opens `/runs/<runId>` for the step rail, full controls, and recovery guidance.

### Automatic run controls

Automatic mode advances only on the signal declared by the selected harness:

- **OpenCode:** an `OSC 7501` `state=working` event followed by `state=idle` in the same step.
- **Copilot:** exit of the headless step process.

Automatic controls include **Pause**, **Resume**, **Run next**, **Retry**, **Skip**, and **Abort** as available. A missing completion signal, a non-zero exit, or the 30-minute per-step timeout pauses the run. Output-idle heuristics, animation quiescence, and fixed sleeps never advance a step.

> **Current OpenCode limitation:** the live execution probe recorded that OpenCode 2.2.5 emitted colon-separated `OSC 7501` parameters while the product parser expects semicolon-separated parameters. The probe's own parser recognized the signal; the product parser did not. Until that parser mismatch is fixed and the live probe is rerun, do not rely on automatic OpenCode advancement. Supervised OpenCode runs are unaffected by this specific gap.

### Recover an interrupted run

If the server stops or a step loses its process, startup recovery marks the active record `interrupted` and clears the stale active-run pointer. Nothing replays on reload. The run view offers:

- **Retry interrupted step** — restarts only the interrupted step with its existing session plan.
- **Continue from next pending step** — leaves finished steps alone and starts at the next pending step.
- **Restart chain** — creates a new run from the frozen snapshot without rewriting the saved chain.

Inspect the bounded step tail and the reason before retrying. Do not edit run JSON by hand unless you are deliberately discarding the record.

## Offline and Reconnect Behavior

Skill Loom is a local application. The UI and API work without an internet connection; only a harness CLI, package installation, or other tools you invoke may use the network.

- If the browser loses the server, the header shows **Server connection error** with a **Retry** action and a short screen-reader announcement.
- Run and terminal routes request a snapshot on connect and then receive ordered deltas. Reopening the run page does not start, advance, or replay a step.
- Closing the browser does not stop the server or a live harness process. Run terminals are server-owned and survive a browser detach so you can reattach. If the server itself exits, recovery marks active records `interrupted`.
- A dropped terminal WebSocket retries a bounded number of times. After the retry budget, the terminal shows a disconnected notice.

## Statuses and Notifications

Run statuses are `starting`, `running`, `awaiting-user`, `paused`, `failed`, `completed`, `aborted`, and `interrupted`. Step statuses are `pending`, `running`, `done`, `failed`, `skipped`, and `interrupted`.

The persistent live region announces short transitions:

- **Polite** (`role="status"`) for ordinary progress, connection restoration, and state changes.
- **Assertive** (`role="alert"`) for failures and urgent interruptions.

Terminal output is never streamed through the live region; it stays in the xterm surface. Status is also expressed with text and icons, not color alone.

## Attachments or Other Data

Skill Loom accepts portable chain bundle JSON through **Import bundle**; it has no general attachment hosting or public sharing service. The data you create is:

- **Chain definitions** under `<project>/.loom/chains/`, including steps, inputs, harness, session mode, and the automatic-permission opt-in.
- **Run records** under `<project>/.loom/runs/`, including the frozen chain snapshot, resolved inputs, statuses, actions, and at most a **200-line or 32 KiB** terminal tail per step.
- **Global configuration and templates** under `~/.config/loom/` by default, including recent projects, executable overrides, extra skill directories, UI preferences, and global chain templates.
- **Copied skill packages** under the project's `.opencode/skills/` or `.github/skills/` directory.
- **Exported bundles** downloaded by your browser to its download location. These contain chain instructions and skill package contents; treat and share them accordingly.

Run tails and copied skills are local data. Treat run records as sensitive because terminal output can contain source code, prompts, or tool output.

## Accessibility and Mobile Use

- A **Skip to main content** link moves focus to the main landmark.
- Every route uses real anchors and heading structure; navigation works with the keyboard.
- Step reordering has a keyboard path through **Move up** and **Move down**, not only pointer dragging.
- Buttons publish their availability through disabled state and the server's action flags; status is never color-only.
- The terminal uses xterm.js screen-reader mode. **Escape** leaves the terminal and returns focus to the run controls without sending Escape to the harness. A **Focus terminal** control re-enters it.
- The persistent live region announces state changes without reading terminal output.
- The primary layout targets a desktop browser. No mobile-specific layout or touch workflow is claimed.

## Privacy and Data Handling

Skill Loom is **loopback-only** and sends no telemetry, crash reports, remote logs, or outbound application requests of its own. It does not read credentials into its own storage or log secret values. Authentication checks look for evidence such as command output, credential-file presence, or environment-variable presence, never credential values.

The browser performs no shell execution and receives typed API and WebSocket data. Harness and skill text is escaped; terminal output is rendered as text by xterm.js. The server owns filesystem traversal, persistence, process spawning, and PTY handling.

## Troubleshooting

### Preflight reports a missing harness CLI

Confirm the binary is on the `PATH` used to launch Skill Loom (`command -v opencode`, `command -v copilot`). Install the verified version or set `harnessCommands.opencode` / `harnessCommands.copilot` in `~/.config/loom/config.json`. Restart Skill Loom after changing the server `PATH`; a broken override does not silently fall back.

### Authentication is blocked or unknown

Run `opencode auth login` or `copilot login` in a normal terminal, then rerun preflight. For token-based setups, confirm the variable is present in the environment that launched Skill Loom. Preflight reports presence only. Do not paste tokens into Skill Loom.

### Copilot trust is blocked

Use the trust panel to start the interactive Copilot session, accept the folder-trust dialog, then choose **Verify trust** and rerun preflight. Or run `copilot -C <absolute-project-path>` yourself, accept the dialog, exit, and rerun preflight. Skill Loom reads `~/.copilot/config.json` and never writes it.

### A run is stuck in automatic mode

Check the current step reason. A missing completion signal pauses the run after the per-step timeout. For OpenCode, see the current parser limitation above and use supervised mode until it is fixed. For Copilot, confirm the headless process actually exited and that the trust dialog was resolved before step 1.

### A run was interrupted

Reload the run page and choose **Retry interrupted step**, **Continue from next pending step**, or **Restart chain**. Read the bounded tail first. Do not delete `active-run.json` while a run is live; restart the server and let recovery clear it.

### Unsaved changes block navigation

Save the chain, discard the draft, or cancel the navigation prompt. A browser `beforeunload` prompt appears when closing or reloading with unsaved changes.

### The server will not start

A non-loopback `LOOM_HOST` aborts startup by design. Use `127.0.0.1`, `::1`, or `localhost`. A port conflict can be resolved with `--port` or `LOOM_PORT`. See the [administrator guide](admin-guide.md#troubleshooting) for configuration and native build failures.

## Getting Help

- [Administrator guide](admin-guide.md) — installation, configuration, backup, upgrades, and operational troubleshooting.
- [Operations guide](OPERATIONS.md) — the full operator contract, data locations, trust and permissions, security model, fork behavior, and troubleshooting.
- [Support](SUPPORT.md) — ownership, intake, and escalation for this repository.
- [Architecture decisions](adr/README.md) — why the application is local-only, harness-agnostic, prompt-ordered, snapshot-based, and shell-free.
