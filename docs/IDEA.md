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
- **Run** — one execution of a chain in one PTY-backed continuous session, with per-step status.
- **Project** — the working directory a chain runs against, selected or created before a run.

## How a run works

1. Select an existing project folder or create an empty one (optional `git init`), using a server-side folder browser with a recent-projects list. No scaffolding or templates.
2. Pick the harness for the chain (OpenCode or Copilot). A chain is bound to one harness; steps are stored by skill name so the recipe stays portable, and missing skills are flagged when re-run elsewhere.
3. Author the chain: browse the catalog, inspect a skill, add it as a step, write the instruction, and reorder steps.
4. Preflight before step 1: resolve every skill name against the chosen harness, confirm the CLI exists and is authenticated. Unresolved skills or a missing/unauthenticated CLI hard-block the run; a dirty git tree warns but does not block.
5. Run. Each step starts the real interactive CLI in a PTY, seeded with the step prompt (`opencode --prompt "<prompt>"`, `copilot -i "<prompt>"`), so the live TUI is visible and the user can approve, interrupt, or take over. The same terminal is reused for the whole run.
6. Steps share **one continuous session** by default, so later steps see earlier work. Fresh-per-step and fork-from-previous are chain settings.
7. Advance with an explicit **Next** control. On a failed step or non-zero exit, pause the chain and offer retry, skip, or abort. Never continue silently.
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

- Interactive PTY-hosted CLI is the primary mode. Headless per-step execution is a possible later "auto-run" mode, not the v1 path.
- One PTY per run, reused across steps. One active run at a time; concurrent runs in the same repo are a data-loss risk and belong with a deliberate worktree feature later.
- Manual Next is the default. Auto-advance on terminal idle is deferred: an agent asking a clarifying question looks idle, and auto-submitting through it corrupts the run.
- Full unattended chain execution is a **known limitation**, not a missing toggle.
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
- Unattended auto-advanced execution.
- Generating PRDs, agent teams, or builds from inside Slan.

## Success signals

- Within a week of building it, run a real 3+ step saved chain end-to-end **twice** without falling back to typing the prompts manually.
- The chain can be edited and re-run for a different task without rebuilding it from scratch.
- **Kill signal:** if authoring a chain is slower than typing the prompts by hand, and you still open a terminal and type the sequence, the tool has failed.

## Constraints and risks

- Skills are model-invoked context, not callable commands. Neither CLI exposes a `skill run`, so deterministic order means deterministic *prompt order*, not guaranteed skill firing. This is the central limitation and must be stated in the UI.
- Interactive TUI behavior differs between harnesses; prompt seeding and session continuation are the stable integration points, not keystroke scripting.
- Session continuation must use `--session` / `--continue` (OpenCode) and `--resume` / `--continue` / `--session-id` (Copilot). Any harness change can break these flags.
- Skill name collisions across sources and harnesses need a visible source badge rather than silent deduplication.
- Preflight exists because discovering a missing skill at step 3 destroys the context the chain was built to preserve.

## Open Questions

- **Visual feel and screen layout.** Whether the builder is a sidebar, a list, or a canvas, and how much chrome the terminal gets, cannot be settled in text. Settle it with a throwaway static mock of the three-screen flow (project → chain builder → run) before implementation.
- **Auto-advance.** Whether idle-based advancement ever becomes safe enough to ship depends on a spike against real harness output, including permission prompts and clarifying questions. Leave it out until that evidence exists.
- **Packaging.** Electron or Tauri may be worthwhile once the workflow is proven; no decision is needed to start.
- **Cross-repo chains.** Project-local storage makes recipes repo-specific by design. If chains should follow the user across projects, that needs a global library decision later.

---

> Sharpened through a grilling session on 2026-11-04; decisions above were accepted by the project owner.
> Next step: `@workspace /forge-build-prd Use docs/IDEA.md as the project idea`.
