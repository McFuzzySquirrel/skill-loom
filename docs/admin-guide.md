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
  "version": 2,
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
- On Windows, PATH lookup for an extensionless name also checks for a native `.exe` in each directory. It does not search for `.cmd` or `.bat` wrappers or invoke them through a shell; configure an appropriate native executable instead. This does not imply Windows managed-run support.
- `extraSkillDirectories` is the global extra-skill search list managed from the catalog settings dialog.
- `remoteSkillSources` stores validated HTTPS/SSH Git URLs and optional refs for skill packages and supported native agents. Pinned snapshots live under `<LOOM_CONFIG_DIR>/catalog-sources/`; credentials are never stored.
- `remoteCatalogLimits` controls finite Git staging, output, timeout, snapshot,
  and per-package budgets. The **Remote skill repositories** page edits global
  defaults and optional per-source overrides. Older version 1 configs are read
  with the original default budgets and are written as version 2 on the next
  update; older Skill Loom versions cannot read version 2 configs.
- `recentProjects` stores the canonical path, display name, derived id, and last-opened time.
- `uiPreferences` is opaque to the server; the web client owns its meaning.
- Credential-like fields such as `apiKey`, `token`, or `secret` are structurally invalid and are never stored. Do not add them.

Configuration writes use an atomic same-directory temporary-file replacement. A corrupt or unsupported-version config is reported, not silently rewritten or reset.

The original default budgets remain 100 skill packages, 100 native agents,
2,000 files, 20 MiB per package and per snapshot, 128 MiB / 10,000 entries
of Git staging, and 2 MiB of Git command output. To refresh a larger catalog,
raise the appropriate budgets together on **Remote skill repositories**; for
example, a 1,000-package, 20,000-file source also needs sufficient Git output,
staging, total snapshot bytes, and timeouts. Each setting has a finite maximum.
Staging is polled during Git operations and checked again afterward, so it is
not a hard filesystem quota. Existing snapshots remain readable when budgets
are lowered. Discovery handoffs and bundles retain their independent limits.
Git tree paths must be valid UTF-8; a source containing a non-UTF-8 path is
rejected rather than silently changing its identity, and existing snapshots
remain available. Catalog Git commands override configured Git hooks, including
hooks triggered by reference updates; Git can still invoke configured
credential helpers or SSH transport programs to access a remote.
Disconnecting a refresh client requests cancellation: Git processes are
terminated and unpublished staging is removed; a request waiting behind
another refresh stops waiting without starting Git. Cancellation is best effort
around the atomic publication rename; a snapshot whose publication has already
begun may still be retained. Disconnecting does not remove existing snapshots.
Process-group cleanup is verified on Linux; Windows process-tree cleanup remains
unverified.

### CLI flags

| Flag | Effect |
|---|---|
| `--help`, `-h` | Print usage. |
| `--version`, `-v` | Print the package version. |
| `--no-open` | Do not open a browser. |
| `--port <number>` | Set `LOOM_PORT`. |
| `--config-dir <path>` | Set `LOOM_CONFIG_DIR`; relative paths are resolved to absolute. |

Environment variables remain authoritative when a flag is omitted.

`skill-loom bundle inspect --bundle /absolute/path/to/chain.loom.json` reads
and reports a bundle as JSON without starting the server. An optional
`--project /absolute/path` includes installed-package conflict information.

`skill-loom catalog source list`, `catalog limits show`, and `catalog snapshot
list`/`page` read configured Git sources and pinned snapshot metadata without
starting the server or changing the profile. Run `skill-loom catalog --help`
for flags. Results use a JSON envelope with `protocolVersion: 1`; failures are
JSON on stderr with a nonzero exit status. New snapshots include a bounded
local page index; old snapshots and unusual Unicode search data use the
validated manifest instead. If a manifest changes after its index was created,
the response warns that it fell back to the manifest. Malformed or
structurally inconsistent indexes fail explicitly rather than omitting
candidates. Verify selected candidate content before use; index files, like
other local state, are not protected from a process running as the same user.
`catalog snapshot inspect --source <id> --revision <commit> --kind skill|agent
--path <repository-path>` verifies the selected candidate against its pinned
fingerprint and returns its local path and metadata for manual content review.
It does not execute content or freeze files against later changes; inspect all
selected files as untrusted data and revalidate before a later action.
With the owner running, `catalog project page` accepts a registered `projectId`,
`harness`, optional `query`, `offset`, `limit` (up to 100), and `warningsOffset`
as JSON on stdin. Pass the returned `snapshotId` with the same project, harness,
and query for subsequent entry and warning pages. The owner retains at most
four snapshots, with a combined 64 MiB serialized-data budget and a two-minute
expiry. An expired or evicted snapshot returns `CATALOG_PAGE_EXPIRED`; start
again. Discovery still loads and verifies the complete merged catalog for the
first page. If a result exceeds the cache budget, `snapshotId` is null and
`CATALOG_PAGE_NOT_CACHED` warns that later pages rediscover and may change;
narrow the query for stable paging. Snapshot results are observations, not
locks on project files; revalidate selections before later actions.
`discovery handoff` accepts JSON on stdin containing `goal`, `harness`, and
`candidates` with exact `sourceId`, `revision`, `repositoryPath`, and
`fingerprint` values. It returns the same handoff as the UI inside the JSON
envelope's `result` and does not write a file or run any candidate. The
response contains complete candidate content: protect stdout and any saved
artifact, review the content and redistribution rights separately, and extract
`result` rather than saving the envelope as the handoff. The handoff has its
own 100-package, 2,000-file, 20 MiB decoded, and 30 MiB JSON limits; stdin and
control requests are limited to 64 KiB.

`skill-loom service start` starts the same profile-owning
server without opening a browser; it still binds the normal loopback HTTP
listener. A UI-started server also exposes the local control endpoint. Use
`service status` and `service stop` against the same `--config-dir`; normal
stop refuses an active managed run or an in-progress run operation. Finish or
abort the run in the UI first. Catalog source add/remove/refresh and limit
updates use the shared owner and require the service to be running. Their JSON
payloads are supplied on stdin; use `skill-loom catalog --help` for shapes.
`skill-loom project --help` and `skill-loom chain --help` describe
registered project and draft commands. Draft validation checks the model only,
not source availability, conflicts, permissions, or harness readiness.
`chain project list` reads `{"projectId":"..."}` from stdin and returns the
registered project's chains and any corrupt-file warnings. `chain project show`
also requires `"chainId"` and reads the same saved chain as the UI. These and
the draft commands require the running owner. Each show/create/update result
includes a `revision`; list results include a `revisions` map keyed by chain
ID. `chain project create` accepts `{"projectId":"...","draft":{...}}`.
Project and draft `update` accept their IDs, a `draft`, and the last observed
`expectedRevision`. Their `remove` commands accept the IDs, `expectedRevision`,
and `confirmed: true`. A changed chain returns `CHAIN_STALE`; reload and review
it rather than retrying with a new revision blindly.

The UI supplies revision preconditions for its edits and deletions. Project
chain and draft HTTP update/delete requests must include the last observed
revision in `x-loom-chain-revision`; callers that previously omitted it must
load the resource first. Missing headers return `CHAIN_REVISION_REQUIRED`
(HTTP 428), and stale revisions return `CHAIN_STALE` (HTTP 409). External
filesystem writes are not coordinated by the owner.
`skill-loom bundle create --draft <id> --output /absolute/file` exports a
draft bundle without replacing an existing file. To export a saved project
chain using the same service as the UI, use `bundle create --project <id>
--chain <id> --output /absolute/file` instead.

To review an import, send `{"projectId":"...","bundlePath":"/absolute/file"}`
on stdin to `skill-loom bundle review`. Use `bundle inspect` for the chain,
inventories, `SKILL.md`, and agent definitions; separately decode and review
the other bundled files without executing them. The review result includes a
bundle fingerprint, destination identity, conflict and inventory information,
and a `reviewDigest`. To approve installation, send the same project and path,
plus `"reviewDigest":"..."` and `"confirmed":true`, on stdin to `skill-loom
bundle import`. The owner rechecks the digest and destination before import.
The digest records the caller's approval of that state; it does not prove a
human reviewed it. For a unique installed project package, review reports its
path, complete bounded inventory, file fingerprints, executable bits, and
whether it differs from the bundled contents. Inspect the installed file
contents separately before choosing `"reuseSkills":["name"]`. Differing
contents additionally require `"differingReuseConfirmed":true`. The owner
rechecks the selected package fingerprints immediately before saving the
chain. Multiple project copies, unsafe files, incomplete discovery, and
existing native-agent destinations block the corresponding import. Review of
all existing packages is bounded to 2,000 files, 20 MiB, 66,000 entries and
4 MiB of serialized inventory; larger selections must be resolved separately.
These checks do not lock external filesystem edits. Import does not launch a
harness or approve execution.

`skill-loom run preflight` accepts the same preflight fields as the UI,
including `projectId` and `chainId`, as JSON on stdin. It returns the shared
preflight report; it does not start a run. Preflight can invoke local harness
authentication/version and Git checks without sending a model prompt.
`run list` reads `{"projectId":"..."}` on stdin and returns bounded managed
and portable run-record summaries, ordered by kind and ID, without initializing
the run owner or project coordination. The scan fails if any record is corrupt,
unsafe, or exceeds its shared 1,000-record / 64 MiB limit; it does not omit
bad records. It observes files sequentially, not as an atomic snapshot, and
neither a terminal status nor `unresolved: false` proves processes stopped or
that a retained claim was released. Use `project coordination-review` for claim
state. Managed IDs can be inspected with `run show`; portable IDs use the
portable helper's status command.
`run active` reports the shared active run, and `run show` reads a `runId`
from JSON on stdin to inspect a run. `run abort` accepts a `runId`,
`confirmed: true`, and an optional `reason` in JSON on stdin; it aborts the
shared managed run rather than creating a second runner.
Before advancing or recording an abort, the runner waits for the current
process to exit and escalates termination if necessary. A termination failure
blocks the action; an automatic signal-driven step pauses with
`PROCESS_TERMINATION_FAILED`. Inspect and resolve the still-running process
before retrying or stopping the service. This does not establish that unrelated
or detached descendants have exited.

If a run pauses with `PERSIST_FAILED`, no new step is spawned after the failed
write. Restore storage before an explicit retry or continuation. The pause is
reported by the live service but may not have been written to disk; inspect the
record and reconcile the interrupted work before restarting or replaying.

If service shutdown fails while cleaning up an owned run, `service status`
reports `failed` and the local control endpoint remains available. Resolve the
process or storage failure, then run `service stop` again to retry cleanup. The
service rejects new run operations during this state. Failures after the control
endpoint itself closes may require manual intervention instead.
`run review-start` accepts `{"projectId":"...","chainId":"...","mode":"supervised",
"inputs":{...},"acknowledgements":{...}}` on stdin and returns the chain,
destination identity, preflight report, and `reviewDigest`. Supply the same
request plus `"reviewDigest":"..."` and `"confirmed":true` to `run start`
to approve execution. A retained test workspace additionally requires
`"liveTestConfirmed":true`. The owner rechecks the reviewed chain, destination,
and preflight evidence; the running chain and inputs are frozen. CLI starts
are limited to instruction-only chains without a selected native agent and
exclude discovery workspaces. Automatic starts additionally require
`"automaticConfirmed":true` and, when preflight reports broad permissions,
`"broadPermissionsConfirmed":true`; the chain's own permission opt-in remains
mandatory. Only adapters with process-exit advancement currently qualify;
OpenCode automatic CLI starts remain blocked pending live signal verification.
Skill-bearing starts are not yet available through the CLI. This is not a
sandbox or a lock against external filesystem changes. Review output and run
records can contain sensitive inputs. Confirmation records caller intent, not
proof that a human reviewed it.
To review a non-spawning action, send `{"runId":"...","action":"done"}` to
`skill-loom run review-action`. The response contains the run view, the exact
action evidence and a `reviewDigest`. To apply it, send the same fields plus
`"reviewDigest":"..."` and `"confirmed":true` to `skill-loom run action`.
Available non-spawning actions include supervised `done`, `failed`, and `skip`,
and automatic `pause` and `skip`; `skip` requires a nonempty `reason` and
`failed` may include one. For instruction-only runs outside discovery
workspaces, `next` and `retry` are available; automatic process-exit runs also
offer `resume` and `run-next` when eligible. Interrupted runs offer `continue`
and `restart` as well as `retry`.
Each execution action requires `"executionConfirmed":true`; retry and restart additionally
require `"replayConfirmed":true`. For a retained test workspace, these actions
also require `"liveTestConfirmed":true`. Automatic execution actions also
require `"automaticConfirmed":true` and, when preflight reports broad
permissions, `"broadPermissionsConfirmed":true`. Optional preflight
`acknowledgements` must be supplied identically during review and action.
Review binds run state, project identity and a freshly checked preflight.
Continue leaves the interrupted step interrupted and starts the next pending
step; retry replays the interrupted step, while restart creates a new run from
the frozen snapshot. No action approval proves a human review, and external
filesystem changes are not locked.
The owner rejects changed run state or action evidence. A digest records caller
intent, not proof of human review; discovery-workspace Done also requires the
separate result review. The non-spawning actions do not launch the next step.
CLI skill-bearing recovery actions and OSC-based automatic execution actions
are not yet available.
`run events` accepts `{"runId":"..."}` on stdin and streams versioned JSON
Lines until interrupted or disconnected. It starts with a snapshot and then
state events, omitting raw terminal-output events. Run records can still contain
resolved inputs and bounded output tails, so treat the stream as sensitive.
The stream does not attach to the terminal. If a reader cannot keep up, it
fails explicitly; reconnect to obtain a new snapshot. Interrupting the client
only unsubscribes and does not stop or retry the run.
`run attach --run <id>` requires interactive TTYs for stdin and stdout and
attaches to the existing live run terminal. Press Ctrl-] to detach without
stopping the run; Ctrl-C is forwarded to the harness. Only one browser or CLI
terminal subscriber is allowed at a time. Terminal output is untrusted and may
contain terminal control sequences.

`skill-loom workspace list` lists retained test workspaces. `workspace create`
accepts either `{"sourceDraftId":"..."}` or
`{"sourceProjectId":"...","sourceChainId":"..."}` on stdin and materializes
an isolated working directory without running a harness. `workspace remove`
requires `{"workspaceId":"...","confirmed":true}` on stdin and refuses to
remove a workspace with an active run, unresolved run record, or retained
project claim. Before confirming removal, stop all work and descendants as well
as older Skill Loom services and helpers using the workspace; nonparticipating
clients are not protected by coordination. Workspace retirement blocks new
participating run operations before the directory is moved and removed. Verified
retirement evidence is saved in the profile before deletion, so removal can be
retried if the final profile update fails. A missing workspace without that
evidence, or a partially deleted retired workspace whose retirement database is
missing, fails closed and needs operator investigation. Older Skill Loom
versions may not understand a profile containing this in-progress evidence;
stop or update them before resuming removal.
These directories are not OS sandboxes.
`workspace inspect` accepts `{"workspaceId":"...","path":"relative/path"}`
on stdin, pages directory entries, and returns regular files up to 1 MiB as
base64. It refuses symbolic links and special files; output is untrusted data.
`workspace evaluate` accepts `{"workspaceId":"...","checks":[{"path":"output.txt",
"sha256":"<64 lowercase hex characters>","contains":"expected text"}]}` on
stdin. Each explicitly selected check requires a regular file and may specify an
expected SHA-256, a case-sensitive UTF-8 substring, or a JSON scalar check.
For example, `"json":{"pointer":"/tests/0/passed","equals":true}` selects a
value using JSON Pointer and compares it with a string, finite number, boolean,
or null; the empty pointer selects the root. Numbers use JavaScript's
IEEE 754 comparison. Observed non-finite values, unsafe integers, and numeric
tokens that change their decimal value when converted to JavaScript's shortest
number representation fail as `json-number-unsafe`. Expected numeric values
are also parsed as JavaScript numbers; use a hash check when exact numeric
text matters. Pointers and expected strings are limited to 4,096 characters. Omit all expectations to check file
presence only. Substrings must be nonempty and at most 4,096 characters.
Invalid UTF-8 or JSON fails the applicable check, and all supplied expectations
must match. Up to 20 files of at most 1 MiB each are read without running commands.
Results include per-file outcomes, observed hashes, and match status;
missing files and mismatches fail their checks, while unsafe paths and unreadable
files return errors. Checks are sequential observations, not an atomic snapshot,
and do not establish semantic correctness or prove a skill was invoked.

Control uses a private Unix socket or mutually authenticated loopback TLS on
Windows. Both support draft editing, terminal attachment, and restricted reviewed managed
starts and actions as described above; skill-bearing CLI starts remain blocked.
Current portable helpers block preparation and step execution if another
unfinished portable run is recorded in the project. The bounded conflict scan
fails closed on unsafe or corrupt records and at more than 1,000 other records
or 64 MiB of records. Archive completed records only while no helper can access
them; do not overwrite or delete corrupt records to bypass the check.
Without the opt-in protocol, portable runs and managed runs from different
profiles do not coordinate project ownership; older helpers never participate.
Arrange exclusive project use manually from
before installation or execution until completion or explicit abort; status
checks do not lock the project. If exclusive use cannot be established, stop.
Portable mutations now initialize a project-local SQLite coordination database
and its ignore rule. Current clients migrate version 1 databases to version 2;
earlier participating clients reject version 2, so stop and update them before
using the same project. If the protocol is enabled, portable preparation
claims the project before installation and later mutations require that claim;
the claim persists after failures, completion, and abort. Managed starts also
claim before run creation, and managed actions and automatic transitions check
the claim. Process-tree cleanup remains unverified. Do not delete the database to
bypass an error. Initial
publication requires hard-link support on the project filesystem; an interrupted
publication can leave an extra link that must be investigated, not ignored.
Before enabling coordination, do not start a second profile that knows the
project while a managed run is active. Recovery leaves records not named by its own profile pointer unchanged
and logs `RUN_RECOVERY_AMBIGUOUS`, but a matching stale pointer is not proof of
ownership.
Recovery of a matching pointer initializes `<project>/.loom/project-claim.sqlite`
and an ignore rule for it and its SQLite sidecars. Do not remove or replace this
database while a service is running. If a claim exists or project coordination
has been enabled, recovery instead preserves the run and pointer and logs
`RUN_RECOVERY_CLAIMED`. Corrupt or unsafe coordination data blocks recovery rather than
being replaced. Managed starts, actions, automatic transitions, and shutdown
use the claim protocol when enabled; claims are retained for separate
review and release. Continue arranging manual separation from older clients
and unrelated processes.
With the service running, `skill-loom project coordination-review` accepts
`{"projectId":"..."}` on stdin and returns the project identity, protocol and
claim state, bounded run-record summaries, and a review digest. It initializes
the database and ignore rule if needed but does not change run records or
resolve ownership. Its `executionCoordinated: false` result means the review
itself is not a lock or proof that all processes participate.
In the project page, expand **Project details** and select **Review
coordination** to inspect the same evidence. Nonparticipating run writers can
change records during or after review; neither review is a lock, confirmation
that work has stopped, or an authorization to start a run.

After review, use **Enable coordination**, **Adopt reviewed run**, **Mark claimed
managed run interrupted**, **Abandon interrupted managed run**, or **Clear
reviewed claim** as applicable. Each action requires a fresh review digest and
explicit confirmations that older clients and prior work, including descendants,
have stopped. Abandonment requires an additional choice and never replays.
Resolve an unfinished portable run with its helper before clearing. The service
refuses actions while it owns a live run; stopped confirmations are operator
assertions and do not prove process-tree cleanup.

The equivalent `skill-loom project coordination-action` accepts structured stdin
in the shape `{"projectId":"...","request":{...}}`. Every request includes
`reviewDigest`, `stoppedConfirmed: true`, and
`oldClientsStoppedConfirmed: true`. `action` is `enable`, `adopt`, `interrupt`,
`abandon`, or `clear`; `adopt` also needs `kind` and `runId`, `interrupt` and
`abandon` need `runId`, and `abandon` additionally needs
`abandonConfirmed: true`. Review again between actions. If the response is lost,
inspect current evidence before retrying instead of assuming rollback.
If `RUN_ACTIVE_POINTER_CORRUPT` prevents startup, Skill Loom leaves the pointer
and run files unchanged. Stop and establish that no earlier work or processes
remain before inspecting the file or restoring a verified backup. Do not delete
the pointer merely to bypass the error.
The same precaution applies when the pointer references a corrupt, unreadable,
or unsupported run record: startup reports the storage error and retains the
pointer rather than treating the run as inactive.
If the pointer becomes corrupt while a run is being saved, the run record may
already have been written before pointer synchronization reports the failure;
inspect both files and the live process state rather than assuming rollback.

## Identity, Secrets, and TLS

The browser HTTP interface has **no application identity, authentication, or authorization**. It is **loopback-only** by design and refuses a non-loopback host. There is no browser HTTPS listener and no supported reverse-proxy deployment. Do not expose the port through a proxy, tunnel, container publish, or remote host.

The Unix local control endpoint uses an owner-only runtime directory and a
per-instance bearer capability in `control.json`, readable only by the profile
owner. Treat that file as a secret: do not share, commit, or back it up. It is
removed on clean shutdown and replaced after a safely checked stale endpoint.
This mechanism does not isolate processes running as the same operating-system
user and does not add authentication to the browser HTTP interface.

Windows control instead uses TLS 1.3 on an ephemeral IPv4 loopback port, pinned
per-instance server and client certificates, `loom-control-v1` ALPN and the
same bearer/protocol/application-version handshake. It does not use Node's
default named-pipe permissions. The shipped PowerShell/.NET helper creates new
profiles with a protected, inheritable current-user-only DACL and checks
ownership, ancestors and metadata/lock-file ACLs before access. Untrusted
ancestor deletion or ACL takeover, reparse points, hard-linked control files,
and broadly accessible profiles or metadata are rejected. Administrators,
SYSTEM and TrustedInstaller are privileged, trusted principals; this is not
isolation from them or from another process running as the same user.

Windows profiles require a local fixed NTFS/ReFS drive, Windows PowerShell 5.1
with .NET 4.7.2+ and permission to run the shipped script. Execution-policy or
constrained-language restrictions fail closed; Loom does not change policy,
elevate, or fall back to an unsecured listener. Existing ACLs are never silently
changed. For an older or inherited-ACL profile, stop all owners and use
`skill-loom service start --config-dir <new-unused-local-profile-path>` to
create a private profile. Review any config and durable run/claim state before
migrating it; choosing a new profile does not resolve an old active run or
prove that its descendants exited. Do not delete run records or claims to
bypass recovery safeguards.

On Windows, `control.json` also holds the temporary client PKCS#12 private key
and both public certificates. The server private key stays in process memory.
Protect this file as a secret and exclude it from backups. Certificates expire
after one year; stop the owner and restart to rotate them. A crashed owner is
recovered through the SQLite OS lock and a refused stale endpoint; an endpoint
that responds but cannot be authenticated is refused, not taken over or shut
down. Clean shutdown removes only that instance's metadata. Windows control
does not lift the protected-content or descendant-containment execution gates.

Windows installation applies a compatibility fix to the pinned `node-pty`
1.1.0 JavaScript agent: natural exit drains terminal output, destroys the input
pipe, and waits for conout-worker termination before closing the output pipe.
Closing output first can race a forwarding write and crash a later session.
Cleanup is idempotent, and killing after native exit never enumerates or kills
potentially recycled process IDs. Worker termination errors take the terminal
error path rather than being ignored. The installer checks complete upstream
agent and worker-lifecycle file hashes, upgrades the earlier cleanup fix, and
accepts only known implementations; unknown versions, linked
files and linked library directories fail explicitly. Re-run `npm install`
after rebuilding or replacing the dependency; do not disable postinstall.
Native installed-package verification now observes natural process exit
without forcing exit or killing by an exited child's PID. This releases PTY
resources, not escaped descendants; it does not lift the containment gate.

Harness credentials belong to OpenCode or Copilot and stay in their own stores or environment. Skill Loom may inspect command output, credential-file presence, or environment-variable presence as authentication evidence, but it never reads credential values into its config, logs, or API responses. Preflight reports presence only.

If you need multi-user or remote access, this project does not provide it. Treat that as a new architecture and security decision, not a configuration change.

## Storage and Backups

| Path | Contents | Notes |
|---|---|---|
| `~/.config/loom/config.json` | Global config, executable overrides, extra skill directories, remote sources, recent projects, managed-workspace ownership, and UI preferences. | Override the directory with `LOOM_CONFIG_DIR`. POSIX creation requests owner-only permissions; Windows service startup requires a verified protected private profile. |
| `~/.config/loom/drafts/*.json` | Project-independent chain drafts. | Separate from templates and project chains; back up with the config directory. |
| Browser download location (`*.loom-discovery.json`) | A user-prepared discovery handoff containing the goal and exact selected candidate packages. | Not retained by the server. It can contain private or redistribution-restricted content; protect or remove it according to your local policy. |
| `~/.config/loom/test-workspaces/<uuid>/` | Managed disposable projects created by **Test in disposable workspace**. | Retained until explicit cleanup from **Test workspaces**. Cleanup refuses the workspace holding the global active run. |
| `~/.config/loom/discovery-workspaces/<uuid>/` | Reviewed handoff, bundled `scenario-discovery` package, managed project, result file, and run state for interactive scenario discovery. | Retained until explicit cleanup from **Discover workflows**. Cleanup refuses the workspace holding the global active run. |
| `~/.config/loom/active-run.json` | Single global active-run pointer. | Holds the active run's project path, run id, and status. Do not edit while a run is live. |
| `~/.config/loom/profile-owner.sqlite` | Profile ownership lock. | One server may own a profile at a time. Do not remove or replace this file while the server is running; the operating system releases the lock on process exit. Store the profile on a filesystem that supports SQLite locking. |
| `~/.config/loom/control.json` | Temporary local control endpoint and bearer capability; Windows also includes client TLS credentials. | Private to the profile owner; do not share, commit, back up, or remove while the server is running. |
| `~/.config/loom/chains/*.json` | Global chain templates. | Independent snapshots; importing copies one into a project with a new id. |
| `<project>/.loom/chains/*.json` | Saved project chains. | Versioned JSON, atomic writes. Back up or version these recipes. |
| `<project>/.loom/runs/*.json` | Run snapshots, statuses, actions, and bounded tails. | At most 200 lines or 32 KiB per step. Never a full transcript. This repository git-ignores `.loom/runs/`. |
| `<project>/.agents/skills/` | Newly copied and bundle-imported skill packages for either harness. | Independent project files; deleting a chain does not remove them. Include these in recipe backups when needed. Existing packages are not migrated. |
| `<project>/.opencode/agents/` and `<project>/.github/agents/` | Explicitly copied remote native agent definitions for the corresponding harness. | Copy never overwrites; chain preflight verifies the selected definition fingerprint. These are harness-specific and are not translated. |
| Browser download location (`*.loom.json`) | Portable chain and skill bundles. | Version 1 contains skills; version 2 can also contain one selected native agent and its pinned identity. No run history or input defaults; review package contents and redistribution rights before sharing. Not a complete backup. |
| Configured shared bundle directory | Immutable published `.loom.json` files. | Must be an existing absolute directory visible to the server and support same-directory hard links. Publication never replaces an existing file; the directory is local or mounted storage, not a hosted service. On Windows, directory fsync can be unsupported, so a successful publication does not guarantee its directory entry survives a sudden power loss. |
| `~/.copilot/config.json` | Copilot's own folder-trust configuration. | Skill Loom only reads `trustedFolders`; it never writes this file. |

Stop the service before backing up the configuration and recipes, so the
temporary control capability is not included:

```bash
cp -a ~/.config/loom ~/loom-config-backup
```

Back up a project's recipes by copying `<project>/.loom/chains/`. Run records are optional history; because they can contain terminal output, treat backups as sensitive and keep them out of version control. This repository already ignores `.loom/runs/`.

Restore by stopping the server, replacing the config or chain directory, and starting again. Validate the restored JSON before use; valid chain version 1 documents migrate to version 2, while unsupported versions or corrupt documents are rejected.

Managed test and discovery workspaces are working directories, not security sandboxes. They use the normal harness permissions and authentication available to the server process. Discovery workspaces persist candidate package contents and goals until explicit cleanup; protect the configured Skill Loom storage directory accordingly. Keep disk usage under review and use the UI's explicit cleanup; do not remove a directory while its run is active.

The **Shared bundles** page stores the configured server-side directory in global config. Configure it only to a directory whose access policy and backups are appropriate for the bundles it will contain. Publishing from a project chain or a locally selected `.loom.json` requires review confirmations for bundle contents and redistribution rights; local-file upload does not require a project or accept a server path from the browser. The server validates the upload, checks the reviewed fingerprint, then atomically creates a new file without clobbering another. Skill Loom does not harvest license files or independently establish redistribution rights. A mounted share that does not support hard links fails visibly rather than falling back to an overwrite-prone write.

### Portable bundle administration

Users can export saved project chains with their referenced skill packages and import them into another local installation. See the [sharing workflow](user-guide.md#share-a-chain-and-its-skills). This does not add remote access, user accounts, or a hosted sharing service.

The `skill-loom-chain` bundle is JSON with base64-encoded package files and executable flags. Version 1 remains the export for chains without a selected native agent; version 2 adds the selected native agent identity and definition. Export uses the exact remote snapshot bound to a skill step; unbound legacy steps retain project-local precedence and fail on unresolved ambiguity. The server validates both preview and import, rejects unsupported versions, unsafe paths, symlinks, special files, excluded credential/dependency directories, duplicate paths, mismatched skill metadata, and incomplete packages. Limits are 100 skill packages, 2,000 combined files, 20 MiB decoded content, and 30 MiB per import request. Existing skill and agent files are never overwritten, and permission opt-in is reset. Ordinary file contents are not secret-scanned; review remains essential.

Remote snapshots store a bounded versioned executable-mode index derived from Git and checked against the package fingerprint. A legacy snapshot without this index can be refreshed at the same revision; Loom verifies its contents before adding the index. On Windows, bundle import, portable preparation, and catalog copy preserve executable intent using paired version-1 records under the package's `.loom/installed-modes.json` and the project's `.loom/package-modes/`. Remote copies use verified snapshot modes; bundled copies use a shipped content-bound mode manifest; other filesystem copies need intact installed-mode records or a complete Git index. Contributors must regenerate the bundled manifest with `npm run update:scenario-modes` after changing those packages; upstream snapshots are checked out byte-for-byte, without Git line-ending conversion.

Back up both installed-mode records with their package. Missing, unsafe, inconsistent, or unexpected metadata blocks review and export; Windows shared packages without either record are also blocked, including legacy shared packages. Restore the complete records and files, or reinstall a reviewed bundle into a fresh directory. Ordinary rollback removes only the failing attempt's registry receipt; crashes retain evidence for operator inspection after confirming no installer is active. Existing-path edits retain mode intent but invalidate previous content approval; new or removed paths need a new reviewed installation. Only validated operational mode metadata is omitted from bundle inventories. See the [Windows mode and recovery instructions](user-guide.md#share-a-chain-and-its-skills), including explicit Git staging when `core.filemode=false`.

These are mode-preservation and point-in-time review guarantees, not authenticated package metadata, protected content, descendant containment, or proof of power-loss durability where directory fsync is unavailable. Windows private IPC is a separate control-transport guarantee. Reviewed managed-execution safeguards and durable project claims remain in place.

New remote snapshots also store a length-framed content digest derived from the fetched Git tree. Older snapshots without it are omitted from discovery until refreshed at the same revision and verified against the fetched contents; refreshing a newer branch tip does not upgrade a different historical revision. On the remote repositories page, use **Refresh this saved commit**, or run `skill-loom catalog source refresh --source <id> --revision <saved-commit>`. This requires Git access to that commit and does not change the configured ref. Alternatively, review and select the newer snapshot. The digest detects inconsistent package files or metadata, but neither it nor its writable index protects against an actor who can rewrite both.

On Windows, a remote package is unavailable if its Git executable-mode index is missing, even if its files appear non-executable. Refresh the exact saved commit to reconstruct and verify that index.

Portable bundle version 2 includes the selected agent's source id, commit, repository-relative path, native path, fingerprint, and bytes; it omits the repository URL and all local filesystem paths. The current portable helper inspects v2 agents but refuses to prepare a selected-agent chain because it cannot switch the current host conversation's agent. Use Loom's managed run path for selected native agents. Persisted chain version 3 includes exact remote skill bindings and optional pinned agent identity; valid version 1 and 2 chain records migrate on read. Older application builds that understand only chain version 2 or below will reject version 3 chains.

The **Discover workflows** page prepares a separate `skill-loom-discovery-handoff` v1 artifact from exact identities in retained pinned snapshots. Preparation is project-independent, performs no automatic fetch, and stores no handoff on the server. It is bounded to 100 packages, 2,000 files, 20 MiB decoded content, and 30 MiB JSON. The standalone `scenario-discovery-v1.zip` contains the offline handoff validator and bundle builder; the host must support Node.js 24+ and structured process arguments. It proposes scenarios for review and creates a normal v1 chain bundle only after explicit approval. It does not import, install, or execute the result. Handoff artifacts are not chain bundles and are rejected by chain import APIs.

`npm run build:portable-skill` synchronizes the canonical `.github/skills/` definitions into the checked-in `skill/` mirror and generates both versioned downloadable skill archives under `dist/skills/`. Review the generated output after changing either skill and run the package smoke test before distributing a packed application.

The same-origin API exposes `GET /api/projects/:projectId/chains/:chainId/bundle`, `POST /api/projects/:projectId/chain-bundles/preview`, and `POST /api/projects/:projectId/chain-bundles/import`. POST bodies contain `bundle`; preview is read-only and returns a `reviewDigest`. Import requires `confirmed: true` and that digest, plus optional `reuseSkills` and `differingReuseConfirmed` fields. Existing HTTP import callers must preview again and send the returned digest. Import rechecks review evidence and rolls back newly installed packages and agent definitions if chain persistence fails. A bundle does not install harness CLIs or external skill dependencies.

Standalone instruction steps use `kind: "instruction"` and contain `id`, `instruction`, and an optional `label`, with no `skillName`. Existing skill steps remain valid without a `kind`; explicit `kind: "skill"` is also supported. Both persist under versioned chain format 3. Older application builds that do not understand instruction steps or chain version 3 will reject such chains; use a compatible build on the receiving installation.

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

Use `/api/health` to confirm the process is listening, the version, the resolved config directory, and the port. `activeRun` reflects the existing run owner's current state when available and otherwise the last persisted pointer; it is not proof that a process or its descendants are alive. Persisted state may remain after a failure. The endpoint does not initiate run recovery or read the config file. A corrupt or unreadable pointer returns an error rather than an inactive result.

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

Config, chain, run, and active-run documents carry explicit versions. Unknown versions are rejected rather than reinterpreted. Config and chain documents currently use version 2 and accept supported version 1 documents through their readers; there is no general migration tool.

## Known Limitations

- **Automatic OpenCode advancement is not proven end-to-end.** The parser now accepts the observed colon-separated `OSC 7501` parameters, but OpenCode 2.2.5 also emitted `clear` between `working` and `idle`, resetting the product's observation. Supervised OpenCode runs are unaffected. Do not rely on automatic OpenCode chains until the signal contract is resolved and the live probe is rerun.
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

Use the trust panel, or run `copilot -C <absolute-project-path>` manually, and choose **Yes, and remember this folder for future sessions** in the folder-trust dialog. A session-only choice does not persist in `trustedFolders`. Exit the terminal and rerun preflight. Skill Loom reads `~/.copilot/config.json` and never writes it. Resolve trust before step 1 because a prompt queued behind the dialog can be swallowed.

### A run is interrupted or the active pointer is stale

Restart the server and let startup recovery mark active records `interrupted` and clear the stale pointer. Then use **Retry interrupted step**, **Continue from next pending step**, or **Restart chain** in the run view. Do not delete `active-run.json` while a run is live.

### A corrupt run or chain file appears

The list reports a warning and leaves the file in place; it is not deleted or rewritten. Inspect the file, restore a backup, or remove it deliberately. Do not rely on a corrupt file being silently ignored as if the record did not exist.

For the full troubleshooting contract, including the dirty Git tree, node-pty, missing CLI, authentication, trust, and interrupted-run cases, see [OPERATIONS.md](OPERATIONS.md#troubleshooting).

## Security and Privacy Checklist

- [ ] `LOOM_HOST` is loopback (or unset) and the process is not published through a proxy, tunnel, or container port.
- [ ] `~/.config/loom` is private to the intended local user. POSIX config writes request restrictive permissions; Windows service startup verifies a protected private profile and refuses unsafe existing ACLs.
- [ ] No credential, token, API key, or secret is pasted into `config.json`, a chain, a run, or a support report.
- [ ] Harness CLIs are authenticated in their own stores; Skill Loom reports presence only.
- [ ] Copilot folder trust is persisted through Copilot's **Yes, and remember this folder for future sessions** dialog choice; `~/.copilot/config.json` is not edited by hand unless you are repairing Copilot itself.
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
