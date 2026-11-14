# Standalone Skill Guide

*The `loom-chain-workflow` package can connect an active agent session to a hosted Skill Loom Podman service. The bundle-based runner remains a separate compatibility workflow.*

## Current Workflow

Install the `loom-chain-workflow` companion skill and use a running Skill Loom
service. It searches the host-global catalog, selects or creates a shared
chain, applies its current global skills to a chosen project, and carries out
the saved steps in the current conversation. It does not launch a nested
harness or persist run state. See [Run a Shared Chain](user-guide.md#run-a-shared-chain).

The remaining sections describe the older bundle-based workflow for existing
`.loom.json` artifacts only. They are not required for new chains.

## Who This Is For

Use this path when you already work in an agent harness (GitHub Copilot CLI, OpenCode, or another Agent Skills host) and want chains without installing or running Skill Loom. If you want the visual chain editor, managed automatic runs, or the CLI owner, use the [user guide](user-guide.md) instead.

## What You Get and What You Do Not

| Skill | Purpose | Needs Skill Loom? |
|---|---|---|
| `scenario-discovery` | Inventories project-local skills, proposes workflows, and writes a reviewed `.loom.json` bundle. | No |
| `loom-run-bundle` | Inspects, installs, and runs a bundle in the **current** host session through a Node.js helper. | No |
| `loom-chain-workflow` | Searches hosted global skills, builds or selects shared chains, applies skills, and walks ordered steps in the current session. | Yes; use a local `skill-loom` CLI or the packaged `skill-loom-podman` bridge. |

`loom-skill-catalog` searches registered sources and installs one reviewed package into a project. It requires the Skill Loom CLI and owner service, so it is not part of the skill-only path described here.

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
- For hosted Podman, Podman CLI and an SSH-backed named connection configured by the service administrator. No Skill Loom checkout or private npm package is required on the client.

## Install the Skills

1. From a checkout, run `npm run build:portable-skill` and use `dist/skills/loom-run-bundle/`, `dist/skills/scenario-discovery/`, and `dist/skills/loom-chain-workflow/` (ZIP archives sit beside them), or copy the checked-in `skill/` directories. `dist/skills/loom-skill-catalog/` is the CLI-backed catalog skill and is installed the same way, but it requires the owner service.
2. Copy each directory into the target project's `.agents/skills/`. Do not merge over an existing package.
3. Refresh or restart the host so it discovers them.

## Connect to Hosted Podman

The standalone workflow package includes
`scripts/skill-loom-podman.mjs`. It invokes the Podman CLI on the client and
forwards Skill Loom commands to the already-running `skill-loom-app` over
Podman's configured SSH connection. The client uses SSH to reach the Podman
engine; it does not connect through the editor's HTTP port or expose the
container control socket.

Ask the host administrator for the SSH account and identity to use, then
configure a named connection on the client:

```sh
podman system connection add --identity ~/.ssh/loom_host_ed25519 \
  loom-host ssh://loom@podman-host.example
export LOOM_PODMAN_CONNECTION=loom-host
node <loom-chain-workflow-skill-dir>/scripts/skill-loom-podman.mjs service status
```

In PowerShell, set `$env:LOOM_PODMAN_CONNECTION = "loom-host"`. Keep the
connection identity in the OS user's normal SSH configuration; Loom does not
store it. Podman access grants control of the host account's containers and
mounts, so this is appropriate only for trusted clients.

Use the host's registered project id to work with the shared catalog and
chains. `chain project apply` writes into the registered host project, usually
the Podman host's `/workspace`. To apply selected global packages to a project
on the client, use:

```sh
node <loom-chain-workflow-skill-dir>/scripts/skill-loom-podman.mjs \
  chain project apply-local --project /absolute/path/to/local/repo \
  --project-id <host-project-id> --chain-id <chain-id>
```

The local project path stays on the client. The bridge requests a bounded,
versioned manifest containing only the selected chain's global packages and
copies them to the local `.agents/skills/` directory without overwriting an
existing package. Remote clients cannot install or update packages in the
host-global catalog. For host setup, permissions, and troubleshooting, see
[persistent Linux host setup](admin-guide.md#persistent-linux-host-service-quadlet)
and [remote client access](admin-guide.md#remote-client-access).

## Copy Selected Host Skills to a Client Project

The bridge can copy exact host-global catalog entries before a shared chain
exists. First search using the registered host project context. Select a
`personal` catalog entry by its exact `id`; display names are not unique:

```bash
printf '%s' '{"projectId":"<host-project-id>","harness":"opencode","query":"format","sources":["personal"],"offset":0,"limit":100,"warningsOffset":0}' \
  | skill-loom-podman catalog project page
```

Review that exact entry to obtain the verified whole-package `fingerprint`:

```bash
printf '%s' '{"projectId":"<host-project-id>","harness":"opencode","candidate":{"id":"<catalog-entry-id>","source":"personal"}}' \
  | skill-loom-podman catalog skill review
```

Then copy the reviewed selection to the local repository:

```bash
skill-loom-podman catalog skills copy-local \
  --project /absolute/path/to/local/repo \
  --project-id <host-project-id> \
  --harness opencode \
  --selection <catalog-entry-id> <package-fingerprint>
```

Repeat `--selection <catalog-entry-id> <package-fingerprint>` for each selected
package. The command keeps `--project` client-side; the host request contains
only the registered project id, harness, entry ids, and package fingerprints.
It copies only verified `personal` entries into
`<local-repo>/.agents/skills/`. The helper validates the complete bounded
manifest and fingerprints before writing, rejects unsafe paths and existing
destinations, and never executes package files. Limits are 100 packages, 2,000
files, and 20 MiB decoded content.

All destinations are checked before the first package is written. If a later
filesystem failure interrupts multiple installs, earlier successful packages
remain; the error reports those packages and whether cleanup of the failing
package was incomplete. Resolve that state explicitly before retrying. Host
catalog updates do not replace these project-local copies. Existing
`chain project apply-local` remains the chain-based alternative.

## Workflow

### 1. Discover and package (optional)

Ask the host: **"Use scenario-discovery to propose a workflow for <outcome>."** The skill asks for the outcome and whether remote repositories matter, expands the outcome into bounded capability queries, and reranks the shortlist before inspection. It can narrow candidates by project source, enabled state, declared tag, tool, input, or output, or by whether one of those metadata kinds is present. It reads `metadataFacets` to discover declared values and `metadataCoverage` to explain a weak shortlist. It treats ranked snippets as signals only: it inspects only enabled project-local skills as untrusted data, reads every selected package in full, proposes scenarios, and shows the full chain and every package file. After you confirm, it writes a version 1 `.loom.json`. It does not import or run it. Remote repositories must already be copied into the project; the skill never clones.

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

## Chain Operations on a Hosted Service

`loom-chain-workflow` uses the selected CLI bridge for every hosted operation.
For local installations, use `skill-loom`; for Podman deployments, use
`skill-loom-podman` and set `LOOM_PODMAN_CONNECTION` on a remote client. The
standalone helper is included with the installed workflow skill, so clients do
not need the Skill Loom npm package. New skill packages still need to be
provisioned into the host-global directory by the host administrator or the
user's existing installer. `loom-run-bundle` remains offline and does not
connect to the hosted service.

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

- [User guide: Run an exported bundle](user-guide.md#legacy-run-an-exported-bundle)
- [ADR-0014: Execute exported chains through a standalone agent skill](adr/0014-portable-agent-skill-execution.md)
- [Administrator guide: Portable bundle administration](admin-guide.md#legacy-portable-bundle-administration)
- [Changelog](../CHANGELOG.md)
