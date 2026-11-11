# Standalone Skill Guide

*How to discover, review, and run Skill Loom chains using only the companion Agent Skills inside your own agent session. Skill Loom's server, chain editor, and CLI are not required.*

## Who This Is For

Use this path when you already work in an agent harness (GitHub Copilot CLI, OpenCode, or another Agent Skills host) and want chains without installing or running Skill Loom. If you want the visual chain editor, managed automatic runs, or the CLI owner, use the [user guide](user-guide.md) instead.

## What You Get and What You Do Not

| Skill | Purpose | Needs Skill Loom? |
|---|---|---|
| `scenario-discovery` | Inventories project-local skills, proposes workflows, and writes a reviewed `.loom.json` bundle. | No |
| `loom-run-bundle` | Inspects, installs, and runs a bundle in the **current** host session through a Node.js helper. | No |
| `loom-chain-workflow` | Coordinates the two skills above and, when Skill Loom's CLI owner is running, optional workspace tests and reviewed import. | Only for the CLI phases |

Limits of the skill-only path:

- The helper never launches a harness, runs package scripts, changes trust, or grants tool permissions. Your host does the work and reports each outcome, so completion is **agent-reported**, not a verified process exit, and it does not prove a named skill fired.
- Progression is supervised by default: you confirm every step.
- A bundle that selects a native agent (bundle version 2) can be inspected but not prepared; import it into Skill Loom to run it with that agent.
- There is no terminal runner, automatic OSC/exit advancement, or live-test workspace without Skill Loom.
- Windows control of the Skill Loom owner is separate; the portable helper itself is Node.js only.

## Requirements

- Node.js 24 or newer.
- A host that can discover project skills, invoke Node with an argument array, pass JSON on stdin, and ask you for confirmation. If it cannot, stop rather than guessing paths.
- Exclusive use of the project while a run is in progress. A status check is not a lock; see [Concurrency](#concurrency-and-recovery).

## Install the Skills

1. From a checkout, run `npm run build:portable-skill` and use `dist/skills/loom-run-bundle/`, `dist/skills/scenario-discovery/`, and `dist/skills/loom-chain-workflow/` (ZIP archives sit beside them), or copy the checked-in `skill/` directories.
2. Copy each directory into the target project's `.agents/skills/`. Do not merge over an existing package.
3. Refresh or restart the host so it discovers them.

## Workflow

### 1. Discover and package (optional)

Ask the host: **"Use scenario-discovery to propose a workflow for <outcome>."** The skill asks for the outcome and whether remote repositories matter, expands the outcome into bounded capability queries, and reranks the shortlist before inspection. It can narrow candidates by project source, enabled state, declared tag, tool, input, or output, and reads `metadataCoverage` to explain a weak shortlist. It treats ranked snippets as signals only: it inspects only enabled project-local skills as untrusted data, reads every selected package in full, proposes scenarios, and shows the full chain and every package file. After you confirm, it writes a version 1 `.loom.json`. It does not import or run it. Remote repositories must already be copied into the project; the skill never clones.

You can skip this step if you already have a bundle, for example exported from Skill Loom or shared by a colleague.

### 2. Inspect

In the project session, invoke `loom-run-bundle` with the absolute bundle path. The helper's read-only `inspect` reports the chain, harness, session mode, ordered instructions, input names, every package file, executable bits, each `SKILL.md`, and conflicts with installed skills. Review all of it as untrusted content. Keep the returned `reviewDigest`.

```bash
node --disable-warning=ExperimentalWarning <skill-dir>/scripts/loom-bundle.mjs \
  inspect --bundle /abs/path/chain.loom.json --project /abs/path/project
```

Ordinary `inspect` does not read stdin. If the host's own skill catalog already reports a global package for a bundled skill, you can reuse that package instead of copying it. Resolve the exact directory from the host catalog; do not guess a global path. Repeat the inspection with `--stdin-json` and the catalog-resolved package paths on stdin:

```bash
node --disable-warning=ExperimentalWarning <skill-dir>/scripts/loom-bundle.mjs \
  inspect --bundle /abs/path/chain.loom.json --project /abs/path/project --stdin-json
```

```json
{
  "globalSkillPaths": {
    "review": "/abs/path/from/host/catalog/review"
  }
}
```

The helper fingerprints each selected package, includes its path, fingerprint, file inventory, and `SKILL.md` in the inspection output, and binds its path and fingerprint into `reviewDigest`. Review those files as untrusted content too. A symlinked, non-canonical, or name-mismatched package directory is rejected.

### 3. Prepare

Installing packages and starting the chain are separate decisions. After you confirm, the host sends JSON on stdin (never in arguments) to `prepare`:

```json
{
  "installConfirmed": true,
  "reviewDigest": "<digest from inspect with the project>",
  "actualHost": "copilot",
  "progression": "supervised",
  "sessionDecision": {
    "requested": "shared",
    "mechanism": "current-conversation",
    "description": "Continue in the current host conversation.",
    "confirmed": true
  },
  "inputs": { "task": "the reviewed task" },
  "globalSkillPaths": {
    "review": "/abs/path/from/host/catalog/review"
  },
  "reuseSkills": ["review"]
}
```

Packages not selected for global reuse are installed under `<project>/.agents/skills/` without overwriting. A package passed in `globalSkillPaths` is referenced in place and is not copied; add every such name to `reuseSkills`. Supply the same `globalSkillPaths` map used for inspection, plus `differingReuseConfirmed: true` if the reviewed global contents differ from the bundle. The helper rechecks the reviewed path and fingerprint at `prepare` and re-fingerprints each reused package before every step, so a later edit blocks the run rather than mixing unreviewed content into it.

Reusing a project package also needs `reuseSkills`, and differing contents also need `differingReuseConfirmed: true`. A host different from the authored harness needs `hostSwitchConfirmed: true`. `prepare` returns a `runId` and `revision`.

Input values are stored locally under `<project>/.loom/portable-runs/` (ignored by Git). Do not put secrets in inputs unless you accept that.

### 4. Step and record

Repeat until the run completes:

1. `step` with `{"revision": N, "confirmed": true}` starts one attempt and returns the resolved instruction and the project or global skill path, if any.
2. The host performs the work with its own tools.
3. `record` with `{"revision": N+1, "outcome": "done", "confirmed": true, "summary": "..."}`. Use `"failed"`, or `"skipped"` with a `reason`. Between steps, `action: "pause"`, `"abort"`, or (after a failure) `"retry"` are available.

`status` shows run state without frozen inputs. A fresh session mode needs a verified isolated worker or your explicit acceptance of a shared-conversation approximation; fork needs a verified native fork or an accepted handoff. A shared conversation is never called fresh.

### 5. Recover

After an interruption, run `status` first. A still-`running` attempt is uncertain: confirm the earlier host work has stopped and send `stoppedConfirmed: true` with the current `revision` to `resume`, then choose `retry`, `done`, `failed`, or `continue`. Nothing is replayed automatically, and retry does not undo side effects.

## Combining With the Skill Loom CLI

When a Skill Loom owner is running (`skill-loom service start`), `loom-chain-workflow` can add CLI phases between discovery and execution: create a retained test workspace, inspect or evaluate its output with explicit checks, and review then import the bundle with a `reviewDigest`. Each of these needs its own approval; none approves a run. Current CLI-managed starts reject skill-bearing chains and native agents, and OpenCode automatic starts remain blocked, so execution of such chains still goes through `loom-run-bundle`. See the [administrator guide](admin-guide.md#cli-flags) for payloads.

## Concurrency and Recovery

- The helper rejects preparation or a step when another unfinished portable run exists in the project. This does not protect against managed runs from another profile or older helpers. Ensure no other run uses the project until this one completes or is aborted.
- Mutations create a project-local SQLite coordination database and ignore rule. Claims persist after failure, completion, and abort. Never delete the database to bypass an error; clearing a claim needs reviewed confirmation that earlier work, descendants, and older clients have stopped.
- Older helpers cannot read run records written by current ones. Update every participating helper before touching the same project.

## Troubleshooting

| Symptom | Action |
|---|---|
| The host cannot find the helper | Ask the host for the installed `loom-run-bundle` directory; do not guess a global path. |
| `inspect` rejects the bundle | It may be invalid, oversized, a symlink, or contain unsafe paths. Obtain a clean export. |
| A global path is rejected | Use the exact canonical directory the host catalog reports. Symlinked, relative, or non-matching package directories are not accepted. |
| Preparation reports a stale digest | The bundle, project, existing package, or selected global package changed. Inspect and review again. |
| A step reports `PACKAGE_CHANGED` | A reused global package was edited after review. Inspect it again and prepare a new run; do not restore the old fingerprint. |
| A skill is not visible after installation | Refresh or restart the host before starting a step. |
| Run from an older helper cannot continue | Reconcile any unresolved attempt, abort it, then inspect and prepare a new run. |

## Related Documents

- [User guide: Run an exported chain inside your harness](user-guide.md#run-an-exported-chain-inside-your-harness)
- [ADR-0014: Execute exported chains through a standalone agent skill](adr/0014-portable-agent-skill-execution.md)
- [Administrator guide: Portable bundle administration](admin-guide.md#portable-bundle-administration)
- [Changelog](../CHANGELOG.md)
