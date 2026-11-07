# Skill Loom User Guide

This guide is for the person using Skill Loom to design reusable skill workflows, save them in the chain library, and share portable bundles. Optional local testing with OpenCode or GitHub Copilot CLI is also covered. Installation and machine administration are in the [administrator guide](admin-guide.md).

## Who This Is For

Skill Loom is a **single-user, local** application. The person at the browser is the only user: there are no accounts, roles, sharing links, or remote collaborators. Use the chain library to keep reusable workflow templates, then export a reviewed bundle and move it into a project repository using your own Git or file-sharing workflow. Local execution is optional; a portable runner skill can also run a reviewed bundle in a compatible CLI harness.

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

On first load you land on the **Chain library**, the home for reusable workflow templates. The responsive workspace shell provides:

- A desktop navigation sidebar, or a compact **Menu** on smaller screens.
- Breadcrumbs for the current project, chain, and run workflow.
- **Projects**, **Scenario catalog**, and the reusable **Chain library**. A selected project adds separate **Project chains** and **Project skills** destinations.
- **Remote skill repositories** for registering Git sources and explicitly refreshing pinned snapshots.
- **Drafts** for project-independent authoring and **Shared bundles** for reviewed bundles in a configured local directory.
- A **Local-only** reminder and **Server connected · v0.1.0** health indicator. If the indicator changes to **Server connection error**, use **Retry**.
- An **Appearance** selector for **System**, **Light**, or **Dark**. System follows the operating-system preference; an explicit choice is remembered in this browser.

Choose **Projects** to register an existing folder or create a new project for authoring, adapting, importing, or locally testing a chain. Registering a project records it in the recent-projects list; removing a recent entry does not delete the folder.

## Main Workflows

### Register and open a project

1. From **Projects**, choose an existing folder or create a new one. Creating a project can optionally initialize a Git repository.
2. Open the project's **Chains** workspace. The project name and project-specific navigation remain available while you work.
3. Choose **Project skills** to search and inspect the project's skill catalog. Choose **Project chains** to build or run chains. Project metadata is available under **Project details**.

### Browse the skill catalog

1. Open **Project skills**, then choose the harness whose installed skills you want to inspect.
2. Search, or expand a skill to read its `SKILL.md` metadata. Skill text is displayed as escaped text, never as raw HTML.
3. Optionally add extra skill directories from the catalog settings dialog. Extra directories are global, not per project; each configured directory appears as its own collapsed catalog group.
4. A skill from a personal, plugin, custom, or extra source can be copied into the project with **Copy into this project**. Copies for both harnesses land in `<project>/.agents/skills/`. The copy is bounded, refuses symlinks, and never overwrites an existing package.

OpenCode also discovers legacy project packages under `.opencode/skills/`. Copilot discovery remains authoritative through `copilot skill list --json`; Skill Loom does not move or migrate existing skill directories.

### Register remote skill repositories

1. Open **Remote skill repositories** and enter an HTTPS or SSH Git URL. Do not include a username/password or token in the URL.
2. Optionally enter a branch, tag, or commit, then register the source. Private repositories use the Git authentication already configured on this machine; Skill Loom does not collect credentials.
3. Choose **Refresh pinned snapshot** to explicitly access the repository. Skill Loom resolves a commit and stores a local snapshot of discovered `SKILL.md` packages. Repository files are read as data; Loom does not check out the repository or run its scripts.
4. Open **Project skills** for a project and inspect the remote group. A selected package can be copied into `<project>/.agents/skills/` through the existing no-overwrite copy action. Alternatively, start a project-independent draft and select pinned remote packages directly without installing them into a project.
5. **Unregister** removes the source registration but keeps saved snapshots. This preserves already-discovered packages; it does not delete snapshot storage.

Refresh requires Git and network access. Each refresh is bounded to 100 packages, 2,000 files, 20 MiB of skill-package content, 128 MiB of temporary Git staging data, 10,000 staging entries, and bounded Git command output/time. A limit, authentication, host-key, or network error is reported rather than shown as an empty catalog. Remote package contents are untrusted instructions; review them before copying or running a chain that uses them.

### Start a project-independent draft from a goal

Open **Drafts** and choose **Start from a goal**. Describe the outcome, choose OpenCode or Copilot CLI, and optionally enter HTTPS/SSH repository URLs with branch, tag, or commit refs. On submit, Skill Loom registers and explicitly refreshes each source into pinned snapshots, then creates a draft whose first standalone instruction records the requested outcome. Earlier sources remain registered if a later repository fails; the error is shown so you can correct or remove them from **Remote skill repositories**.

The draft editor's catalog is limited to remote snapshots: review the listed skills and native agents, then select only the packages needed for the chain. This path does not install remote files into an existing project or automatically recommend a scenario; it provides the goal and safe catalog for you to build and review a chain. Keep credentials and private runtime values out of the goal. Add values that should be collected during a run as named inputs.

Drafts are stored separately from project chains and reusable templates. You can test one in a fresh managed workspace, export its reviewed bundle, or publish it to the shared bundle library. A draft can also be exported and then imported into a project through the regular bundle review flow.

### Start from a scenario example

The [Scenario catalog](scenario-chains.md) provides illustrative starter chains for business, study, app development, and game development. Filter and review the steps, inputs, prerequisites, pinned revisions, and third-party skill sources, then copy an example into an open project to adapt it in the normal chain builder. Examples are not prescribed workflows or endorsements, and the catalog is not an exhaustive list.

Copying a scenario creates only an ordinary independent project chain; it does not install skills or run a command. To copy an included third-party skill into the selected project's harness directory, use that skill's explicit **Add bundled skill to project** action. Review its source and license first. Skill Loom preserves supplied upstream license files and adds a `SKILL-LOOM-SOURCE.md` notice with the pinned source revision. It does not execute package scripts, fetch updates, or contact the upstream source. A same-name skill already visible to the selected harness must be resolved or renamed before a bundled copy can be added. Preflight blocks a run when a required skill is missing. Every copied chain is an ordinary independent project chain with a shared-session default and broad automatic permissions disabled.

### Design and save a chain

The **Workflow designer** places the skill catalog and ordered steps side by side on wider screens, with chain inputs below the design area. Select a step to open its editor in a dialog; choose **Done editing** or press Escape to close it. On smaller screens the catalog and steps stack in one column.

1. Choose a project to provide a skill catalog and workspace for authoring. Create a chain and choose one harness. A chain is bound to that harness; per-step harness selection is not supported.
2. Add at least one step. Choose a catalog skill with **Add as step**, or use **Add instruction** for a standalone agent prompt without an installed skill. Both require a non-whitespace instruction and support an optional label. Adding a remote skill pins the step to that exact source revision and package path; the editor shows the pin, and changing the skill clears it so you can select another catalog entry. A remote native agent can also be selected from the catalog; adding it copies the exact pinned definition to the harness's native project agent directory without overwriting an existing file.
3. Reorder steps by dragging or with **Move up** and **Move down**. The visible order is the prompt order.
4. Optionally declare named inputs and reference them from instructions as `{{name}}`. Input names use identifier syntax; required inputs must resolve before a run starts.
5. Choose a session mode: **shared**, **fresh**, or **fork**. See [Session modes](#session-modes).
6. Optionally select one native agent for the whole chain. Agent definitions are harness-specific and are never translated. OpenCode native-agent selection is available for automatic/headless runs only; supervised OpenCode has no supported selector. Copilot agent selection applies to supervised and automatic runs. Preflight blocks a missing, modified, unsafe, or incompatible installed agent.
7. For Copilot automatic mode, explicitly enable the automatic-permission opt-in. It is off by default and grants broad filesystem and tool access.
8. Save the chain under `<project>/.loom/chains/`. Choose **Save and run** only when you want to test it locally.

An unsaved chain shows a dirty indicator. Navigating away or closing the tab prompts before discarding unsaved changes.

Instruction steps run through the chain's selected harness in the same order and session mode as skill steps. They support `{{name}}` inputs, retry, skip, recovery, and both supervised and automatic runs. They do not request a skill or require catalog resolution. An instruction is a normal prompt, not a higher-priority system instruction or a custom agent definition.

### Reuse a chain

- **Save copy to library** stores an independent snapshot in the global **Chain library** (`/chains`), which is the home for reusable templates.
- Importing a library template into a project copies it with a new chain id. The project copy is independent; later edits to the template do not affect it.
- Duplicating a project chain also creates a separate chain id.
- Deleting a chain or a global template removes only that file. It does not remove the other copies.

### Test in a disposable project

In the workflow designer, choose **Test in disposable workspace** to save the current chain and create a fresh managed test project containing its chain and selected packages. The run uses Skill Loom's regular preflight, trust, permissions, and run controls. It does not modify the source project's files. The test project and run records are retained for inspection until you remove them from **Test workspaces** in the navigation. Cleanup is blocked while a workspace owns the active run.

A separate working directory is not a security sandbox: the selected harness can still access files, network resources, and credentials allowed by its normal permissions. A new test workspace is not shown in the ordinary recent-project list, but remains registered for run recovery. Do not treat successful execution as proof that the chain or its outputs are correct.

### Share a chain and its skills

1. Save the chain, then return to the project's **Chains** list and choose **Export** on its card. Export uses the saved version, not an unsaved builder draft.
2. Review the chain instructions, input definitions, package file lists, and `SKILL.md` previews. The bundle includes complete referenced skill packages: scripts, binary assets, and supporting files, with executable flags preserved. A chain with a selected native agent exports as bundle version 2 and includes its exact definition and pinned identity; the export review displays the agent text. Private repository URLs are not included.
3. Confirm that you reviewed the contents and have redistribution permission, then choose **Download bundle**. Send the resulting `.loom.json` file using your own file-sharing method; Skill Loom does not upload it or create a public link.

The export excludes input default values, run records, terminal output, local catalog source paths, chain identity/timestamps, and automatic-permission consent. It refuses packages containing symbolic links, special files, `.env` files, credential-named files, `.git`, `.loom`, `.ssh`, or `node_modules` directories rather than silently exporting a partial package. Version 1 remains the export format for chains without a selected native agent; version 2 includes the selected agent definition and provenance identity. This is not a secret scanner: secrets, private paths, or confidential material inside ordinary instructions and files must be removed before sharing.

Each skill must resolve to an enabled, readable package for the chain's selected harness. A single project-local package takes precedence over same-name personal or extra-directory copies; multiple distinct project packages remain ambiguous. If there is no project copy, only one available non-project package can be exported. Missing, disabled, ambiguous, or non-filesystem skills block export. Bundles support up to 100 skill packages, 2,000 files, and 20 MiB of decoded file content; the JSON upload limit is 30 MiB. Directory names and file paths must be portable and safe, and directory nesting is bounded.

### Import a shared chain

1. Open the destination project and choose **Import bundle** in its **Chains** list.
2. Select a `.loom.json` file. Preview validates the bundle without installing files. Review its harness, steps, inputs, package file lists, and `SKILL.md` text.
3. If a skill name is already installed, explicitly choose **Reuse installed** to keep your version; its contents may differ from the bundle. Import never overwrites an existing skill package. If a destination directory exists without a matching catalog skill, cancel and resolve that directory conflict first.
4. Confirm that you trust the instructions and packages, then choose **Import chain and skills**.
5. Open the new chain, provide inputs, review automatic permissions, and run preflight before running it.

Import creates an independent chain with a fresh id and timestamps, resets automatic-permission consent to off, and installs new packages under `.agents/skills/` for both harnesses. It rechecks conflicts at import time and removes newly installed packages if saving the chain fails. Existing packages remain untouched. Import never executes bundled scripts, starts a run, authenticates a harness, or grants folder trust. Removing the imported chain later does not remove its installed skills.

The recipient still needs the selected harness and any external tools, services, or dependencies used by the skills. Version 2 requires a Loom build that supports native agents; older readers should reject it rather than discard the selected agent. The standalone `loom-run-bundle` helper can inspect v2 agent content but will not prepare a chain that selects a native agent, because a current conversation cannot switch its harness agent. Import such a bundle into Skill Loom to run it with the selected agent. Bundles are not backups of project files or the global library, and exporting a global template requires first importing it into a project.

### Run an exported chain inside a harness

The export dialog also offers **Download reusable runner skill**. This ZIP contains the generic `loom-run-bundle` Agent Skill, its references, a dependency-bundled helper, and license notices; it does not contain the exported chain. A recipient needs Node.js 24+ and a harness that can read project skills, invoke Node with arguments/stdin, and request confirmation. Skill Loom does not need to be installed or running during execution.

Extract the ZIP and install its `loom-run-bundle/` directory into the target project's `.agents/skills/` directory, unless that skill already exists. Alternatively, in a Skill Loom checkout run `npm run build:portable-skill` and copy the generated `dist/skills/loom-run-bundle/` directory into that location. Do not merge over an existing runner package. Refresh or restart the host if it does not discover the new skill. The helper also needs to be invokable from the skill directory reported by the host; if the host cannot locate it or pass structured stdin, stop rather than guessing a global path.

In the target project's harness session, invoke `loom-run-bundle` and provide an absolute path to the downloaded `.loom.json` bundle. The helper's read-only `inspect` command validates the complete bundle and reports instructions, inputs, package files, `SKILL.md` text, executable bits, and project skill conflicts before installation. Review the content as untrusted, confirm package installation/reuse separately from chain execution, resolve inputs, and review the current host and session plan. The helper installs packages under `<project>/.agents/skills/` without overwriting; changed existing packages require a separate explicit reuse choice. If the harness needs a refresh to see newly installed skills, do that before starting a step.

The standalone workflow defaults to supervised execution: confirm each step, then record its outcome. Agent-driven progression is optional and needs separate consent. The helper persists a frozen bundle/input snapshot and bounded attempt summaries under `<project>/.loom/portable-runs/`, which it adds to the project's `.loom/.gitignore`; input values therefore remain local files and should not contain secrets unless you accept that storage. `status`, `pause`, `retry`, reasoned `skip`, `abort`, and explicit `resume` are available. An interrupted attempt is uncertain and is never replayed without a recovery choice. Retry does not roll back file changes.

Portable execution is not Skill Loom's terminal runner. The helper never launches a harness CLI, grants tool permissions, changes trust settings, or runs package scripts. The host performs the work and reports completion, so outcomes are not verified process exits and do not prove a skill fired. `shared` uses the current conversation. `fresh` needs a verified isolated worker or explicit acceptance of a shared-conversation approximation; `fork` needs a verified native fork or explicit acceptance of a labelled handoff. A different host from the bundle's authored harness requires compatibility review. If the current host cannot supply a required capability or confirmation, execution must stop before dispatch.

### Discover and package project workflows

The `scenario-discovery` Agent Skill can turn skills available to a project into a reviewed chain bundle. Install the skill in a location your current host discovers (for example, `.agents/skills/scenario-discovery/` in the project), or use the copy provided by this Skill Loom checkout. The host may need a refresh or restart after installation. For project-independent authoring from a goal and remote repositories, use the **Drafts** workflow above instead.

In the project session, ask for a specific outcome, for example: **"Use scenario-discovery to propose a workflow for reviewing our API changes."** The skill first asks for the desired outcome and whether remote repositories should be considered. It cannot inspect Loom-managed remote snapshots directly: register and explicitly refresh requested HTTPS/SSH sources in Skill Loom, review the pinned snapshot, and copy selected skill packages into the current project before using the skill. The skill does not clone repositories itself. It then:

1. Inventories enabled **project-local** skills and inspects their instructions as untrusted data; it does not run package scripts.
2. Proposes supported scenarios, ordered prompt steps, and any named inputs. Review the skill evidence and choose a proposal.
3. Shows the target harness, session mode, complete chain draft, and every selected package file. Review and explicitly confirm these before bundle creation.
4. Writes a new version 1 `.loom.json` bundle. It does **not** include selected native-agent definitions, import, or run the bundle. Build and export chains requiring a selected native agent in Skill Loom. To use a generated bundle in Skill Loom, open a project, choose **Import bundle**, and follow the separate preview, trust, and package-conflict review.

The builder helper requires Node.js 24+ and safe structured tool access to the manifest and output path. If your host cannot resolve the installed helper or pass arguments safely, stop rather than guessing a global path. `scenario-discovery` does not install itself, grant permissions, or guarantee that a harness will invoke any named skill.

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
3. Choose **Run preflight**. Preflight makes no model call. It checks the harness executable, authentication evidence, Copilot trust, catalog resolution, selected native-agent integrity/capability, inputs, session mode, permissions, and Git state.
4. Resolve every blocking finding. Acknowledge required warnings, such as ambiguous authentication or an unknown trust result.
5. Choose **Start run**. The server re-runs the blocking preflight, creates the run, freezes the chain snapshot and resolved inputs, and opens `/runs/<runId>/terminal`.

A dirty Git tree is a warning, not a block. Preflight never makes a model call and never edits your files.

### Supervised run controls

Supervised mode gives you the interactive terminal and explicit outcomes. A step never advances because output went quiet or a page loaded.

- **Mark done** records the step as done and enables **Next**.
- **Mark failed** records the step as failed and pauses for **Retry**, **Skip**, or **Abort**.
- **Mark skipped** records the step as skipped with a reason and enables **Next**.
- **Retry**, **Skip**, and **Abort** remain available according to the server-published action flags.

The terminal page keeps the xterm surface and compact controls together and follows the selected appearance. **Run details** opens `/runs/<runId>` for the step rail, full controls, and recovery guidance.

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

Skill Loom is a local application. The UI and API work without an internet connection; explicitly refreshing a registered Git repository, a harness CLI, package installation, or other tools you invoke may use the network. Remote snapshots already saved under Loom's config directory remain available offline.

- If the browser loses the server, the header shows **Server connection error** with a **Retry** action and a short screen-reader announcement.
- Run and terminal routes request a snapshot on connect and then receive ordered deltas. Reopening the run page does not start, advance, or replay a step.
- Closing the browser does not stop the server or a live harness process. Run terminals are server-owned and survive a browser detach so you can reattach. If the server itself exits, recovery marks active records `interrupted`.
- **Stop server** intentionally stops Skill Loom on this machine and interrupts its active local runs; every browser tab connected to that server is affected. If a chain has unsaved edits, explicitly confirm that they may be discarded. Restart Skill Loom using the same launch method, then choose a recovery action on the interrupted run. No step replays automatically.
- Stopping Skill Loom cannot stop work independently performed by a separate host agent using `loom-run-bundle`; use that host's explicit pause/abort controls. Closing a browser tab is not a server shutdown.
- A dropped terminal WebSocket retries a bounded number of times. After the retry budget, the terminal shows a disconnected notice.

Small question-mark buttons explain the current page or workflow section. Open **Help and user guide** in the sidebar for the complete guide and offline administrator, operations, scenario, and support articles. Links from contextual help open the guide in a new tab so you can keep your current draft or run visible.

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
- **Copied skill packages** under the project's `.agents/skills/` directory. Existing OpenCode `.opencode/skills/` packages are not migrated.
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

Skill Loom is **loopback-only** and sends no telemetry, crash reports, or remote logs. It performs Git network access only after a user explicitly refreshes a registered repository; it does not otherwise make outbound application requests. It does not read credentials into its own storage or log secret values. Authentication checks look for evidence such as command output, credential-file presence, or environment-variable presence, never credential values.

The browser performs no shell execution and receives typed API and WebSocket data. Harness and skill text is escaped; terminal output is rendered as text by xterm.js. The server owns filesystem traversal, persistence, process spawning, and PTY handling.

## Troubleshooting

### Preflight reports a missing harness CLI

Confirm the binary is on the `PATH` used to launch Skill Loom (`command -v opencode`, `command -v copilot`). Install the verified version or set `harnessCommands.opencode` / `harnessCommands.copilot` in `~/.config/loom/config.json`. Restart Skill Loom after changing the server `PATH`; a broken override does not silently fall back.

### Authentication is blocked or unknown

Run `opencode auth login` or `copilot login` in a normal terminal, then rerun preflight. For token-based setups, confirm the variable is present in the environment that launched Skill Loom. Preflight reports presence only. Do not paste tokens into Skill Loom.

### Copilot trust is blocked

Use the trust panel to start the interactive Copilot session. In the folder-trust dialog, choose **Yes, and remember this folder for future sessions**; a session-only choice is not saved and will still be reported as untrusted. Then choose **Verify trust** and rerun preflight. Or run `copilot -C <absolute-project-path>` yourself, choose the same persistent option, exit, and rerun preflight. Skill Loom reads `~/.copilot/config.json` and never writes it.

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
