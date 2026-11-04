# Project Idea

## Summary

Slan is a local tool for assembling and running **chains of installed agent skills**. It inventories the skills a CLI harness can load, shows what each one does, lets the user order selected skills into a reusable recipe, and runs that recipe against a project inside a real interactive terminal in the UI.

The original idea, preserved: a local UI where users find installed global skills, select the ones they want and the order to run them, see what the skills do to choose well, and execute the ordered set in a harness (OpenCode CLI and Copilot CLI for now) in an interactive xterm terminal, starting from an existing or new project.

## Problem

Both OpenCode and Copilot already let an agent choose and load skills, and a user can type "use skill A, then B, then C" into a prompt. What is missing is not skill *discovery* but **repeatability and control**:

- Known-good sequences are re-derived by a model on every run instead of being saved.
- Long chains lose the thread, and there is no per-step visibility into what happened.
- The same sequence must be re-typed, and there is no place to keep a recipe per project.
- There is no honest way to see which skills are installed, what they do, and which one the current harness can actually load.

The skill catalog exists to support chain authoring. It is not the product on its own.

## Target user and ownership

- **Personal tool for a single local user**, on a machine where the chosen harness CLI is installed and authenticated.
- No multi-user support, authentication, hosting, or onboarding in v1.
- The core should stay clean enough to share later, but v1 optimizes for "my paths, my CLIs, my skills."

## The wedge

**The chain is data, not prose.** A chain is user-assembled, inspectable, editable, stored per project, and written in terms of skill names so the same recipe can be re-run under a different harness. If the sequence were fixed, a custom agent or a written procedure would be the better tool; Slan's value is authoring, saving, and swapping chains without editing prompts.

## Core concepts

- **Skill** — a `SKILL.md` package exposed by a harness (project, personal, plugin, custom, or builtin source).
- **Step** — one skill reference plus a required free-text instruction and an optional label. The instruction says what to do with the skill; a skill alone is just "load this and figure it out," which is the unreliable behavior Slan exists to remove.
- **Chain** — an ordered list of steps bound to one harness, with a name and optional inputs.
- **Run** — one execution of a chain against a project, in supervised (one PTY-backed session) or automatic (harness-signaled) mode, with per-step status.
- **Project** — the working directory a chain runs against, selected or created before a run.

## How a run works

1. Select an existing project folder or create an empty one (optional `git init`), using a server-side folder browser with a recent-projects list. No scaffolding or templates.
2. Pick the harness for the chain (OpenCode or Copilot). A chain is bound to one harness; steps are stored by skill name so the recipe stays portable, and missing skills are flagged when re-run elsewhere.
3. Author the chain: browse the catalog, inspect a skill, add it as a step, write the instruction, and reorder steps.
4. Preflight before step 1: resolve every skill name against the chosen harness, confirm the CLI exists and is authenticated, and resolve Copilot's folder trust. Unresolved skills or a missing/unauthenticated CLI hard-block the run; a dirty git tree warns but does not block.
5. Choose an execution mode. **Supervised** (portable default, both harnesses): each step runs the real interactive CLI in a PTY seeded with the step prompt (`opencode --prompt "<prompt>"`, `copilot -i "<prompt>"`), the live TUI is visible, and the same terminal is reused for the run. **Automatic** (harness-specific): OpenCode advances when the CLI reports `state=idle`; Copilot runs one headless process per step with a shared session ID and advances on process exit.
6. Steps share **one continuous session** by default, so later steps see earlier work. Fresh-per-step and fork-from-previous are chain settings.
7. On a failed step or non-zero exit, pause the chain and offer retry, skip, or abort. In supervised mode the user presses **Next**; in automatic mode the harness completion signal or process exit advances. Never continue through a failure or an ambiguous state.
8. Persist a small run record so the run can be resumed or retried after a reload or crash.

## Settled decisions

### Catalog and discovery

- Show everything the selected harness can load, grouped by source, with source badges.
- Copilot discovery uses `copilot skill list --json` (project, personal, plugin, custom, builtin).
- OpenCode has no listing command; scan `.opencode/skills`, `~/.config/opencode/skills`, and configured extra directories, parsing `SKILL.md` frontmatter for name and description.
- This machine currently has no globally installed skills, only project-local ones, so project-local skills must appear from day one.
- Provide an "add skills directory" escape hatch.
- Skill detail: name, description, source, and the full `SKILL.md` on expand, with search across name and description. No AI-generated summaries.

### Chain model and persistence

- A step is a skill name, a required instruction, and an optional label.
- Chains are saved as JSON under `<project>/.slan/chains/`, so recipes travel with the repo and can be reviewed in git.
- Keep a recent-chains list. No template marketplace in v1.
- Support `{{input}}` placeholders in step instructions, resolved by a run-start form, remembering the last values per chain. This is what makes a chain a reusable recipe rather than a one-shot task.
- Chains are harness-bound. Per-step harness switching is a non-goal because it would reset the shared session.

### Execution

- Two execution modes, implemented as **per-harness adapters** rather than one uniform loop:
  - **Supervised** (portable default): interactive PTY-hosted CLI, one terminal per run, manual Next.
  - **Automatic**: OpenCode advances on its terminal state signal; Copilot runs one headless process per step sharing a session and advances on process exit.
- OpenCode emits machine-readable TUI state over the terminal stream: `OSC 7501;state=working|idle|clear`, plus the session ID (`id=ses_...`). `state=idle` is a real turn-completion signal, not an idle heuristic.
- Copilot emits no comparable state. Its TUI animation makes output-idle detection fire both prematurely and late, so output-idle heuristics are a non-goal for both harnesses.
- Copilot shows a folder-trust dialog on the first interactive run in a folder. Preflight must resolve trust before step 1; a prompt queued while the dialog is open can be swallowed.
- Automatic chaining broadens permission scope: headless Copilot required `--allow-all-paths` and pre-approved tools. Surface this at preflight rather than silently defaulting to broad permissions.
- One active run at a time; concurrent runs in the same repo are a data-loss risk and belong with a deliberate worktree feature later. Supervised runs reuse one PTY; automatic Copilot runs are per-step processes sharing a session.
- Persist run metadata (chain, harness, session ID, per-step status, timestamps) under `.slan/runs/` for resume and retry. Do not capture or replay full transcripts.

### Delivery

- Local web app: a Node server owns PTYs, filesystem scanning, and chain storage; the browser UI talks to it over WebSocket and renders the terminal with xterm.js.
- PTY handling has to be server-side regardless, so the browser adds no constraint; packaging as Electron or Tauri is a later option.

## Non-goals for v1

- Multi-user support, authentication, or hosted/remote use.
- Authoring or editing skills inside Slan.
- Model routing or model selection per step.
- Per-step harness switching within a chain.
- Parallel chain execution.
- Full transcript capture, replay, or a logging database.
- AI-generated skill summaries.
- A chain template marketplace.
- Idle-heuristic auto-advance, or any automatic advancement not backed by a harness state signal or a process exit.
- Generating PRDs, agent teams, or builds from inside Slan.

## Success signals

- Within a week of building it, run a real 3+ step saved chain end-to-end **twice** without falling back to typing the prompts manually.
- The chain can be edited and re-run for a different task without rebuilding it from scratch.
- **Kill signal:** if authoring a chain is slower than typing the prompts by hand, and you still open a terminal and type the sequence, the tool has failed.

## Constraints and risks

- Skills are model-invoked context, not callable commands. Neither CLI exposes a `skill run`, so deterministic order means deterministic *prompt order*, not guaranteed skill firing. This is the central limitation and must be stated in the UI.
- Interactive TUI behavior differs between harnesses; prompt seeding and session continuation are the stable integration points, not keystroke scripting. OpenCode's state stream is a bonus integration point; Copilot has no equivalent.
- Session continuation must use `--session` / `--continue` (OpenCode) and `--resume` / `--continue` / `--session-id` (Copilot). Copilot rejects `--session-id` together with `--trust-folder`, so trust and session handling must be sequenced. Any harness change can break these flags.
- Skill name collisions across sources and harnesses need a visible source badge rather than silent deduplication.
- Preflight exists because discovering a missing skill at step 3 destroys the context the chain was built to preserve.

## Evidence from the execution spike (2026-11-04)

A PTY-driven spike against OpenCode 2.2.5 and Copilot CLI 1.0.105 established:

- A seeded prompt submits in both interactive TUIs: `opencode --prompt "<text>" <dir>` and `copilot -i "<text>"`.
- A prompted named skill actually loads in both harnesses. A throwaway `spike-skill` returned its token (`PINEAPPLE`) in each; Copilot logged `● skill(spike-skill)`.
- OpenCode exposes `OSC 7501;state=working|idle|clear` with `id=ses_...`; Copilot exposes no semantic state.
- Cross-process session resume works in both: OpenCode `run --session ses_...`, Copilot `-p ... --session-id <uuid>`. A token remembered in the first process was recalled in the second.
- Copilot's first interactive run blocks on a folder-trust dialog; `trustedFolders` is not settable through `copilot config`, and `--trust-folder` is prompt-mode only and conflicts with `--session-id`.
- Headless Copilot chaining required `--allow-all-paths --allow-all-tools`.
- OpenCode auto-approved both a file write and a shell command in the test environment, so approval-prompt behavior was not exercised.

## Open Questions

- **Visual feel and screen layout.** Whether the builder is a sidebar, a list, or a canvas, and how much chrome the terminal gets, cannot be settled in text. Settle it with a throwaway static mock of the three-screen flow (project → chain builder → run) before implementation.
- **Approval prompts.** OpenCode auto-approved writes and shell in the spike, and Copilot's manual-approval UI was not exercised. Whether an approval prompt keeps OpenCode at `state=working` (safe for auto-advance) and how to detect one in Copilot's TUI are still unknown. Supervised mode makes this non-blocking.
- **Verifying skill firing.** Both harnesses complied in the spike, but neither guarantees it. Copilot logs `skill(...)`; OpenCode does not visibly. Whether Slan should warn on "skill not observed" needs evidence from more runs.
- **Packaging.** Electron or Tauri may be worthwhile once the workflow is proven; no decision is needed to start.
- **Cross-repo chains.** Project-local storage makes recipes repo-specific by design. If chains should follow the user across projects, that needs a global library decision later.

---

> Sharpened through a grilling session on 2026-11-04; decisions above were accepted by the project owner.
> Execution-model spike run 2026-11-04 (OpenCode 2.2.5, Copilot CLI 1.0.105); evidence recorded above.
> Next step: `@workspace /forge-build-prd Use docs/IDEA.md as the project idea`.
