# Standalone CLI and agent-driven chains: end-to-end plan

## Problem and outcome

Skill Loom needs a CLI-first companion to the existing UI: users and agents can configure local and remote catalogs, discover and review skills, author chains, validate and optionally live-test them in a retained temporary workspace, import reviewed bundles into a repository, and run and recover them without opening a browser. The UI remains supported and shares the same behavior and data.

Deliver both managed harness execution and execution in the calling agent's session. Use an explicitly started shared local service as the single owner of mutable state and managed processes. Static validation is the default; live test execution, installation, and execution are distinct, explicit approvals. Remote catalog budgets are configurable with bounded safe defaults and actionable failures. Support a configured acceptance fixture of at least 1,000 skills and 20,000 package files per Git source.

## User decisions and boundaries

- Both execution modes are in scope. Managed mode uses the existing orchestrator and harness adapters; in-session mode uses the portable helper and the current host's tools, without launching another harness.
- Managed runs survive individual client commands via a shared local service started explicitly; no browser is required. Existing `skill-loom` launcher behavior and flags remain compatible.
- Catalog refresh and static validation are distinct from executing untrusted content. Live tests require explicit execution approval; a separate managed workspace is not an OS security sandbox.
- A user may explicitly choose supervised or automatic/agent-driven progression. Supervised is the default. Neither selection broadens harness or tool permissions.
- Preserve existing bundle v1/v2 readers and their independent, smaller size caps unless a specific compatibility review justifies a format change. A large catalog does not mean a large bundle.
- Preserve one active managed run per config profile, exact source pinning, explicit recovery, non-overwriting imports, and documented harness capability restrictions. No telemetry or hosted backend.
- Linux, macOS, and Windows are required targets for the standalone managed
  workflow. Prefer native harness execution when it can meet the reviewed
  content and descendant-cleanup guarantees; a Linux VM fallback is acceptable
  when native execution cannot. Disclose the backend and its prerequisites and
  obtain any additional approvals before provisioning or execution.
- This document tracks the approved scope, milestone status, and acceptance gates. Update it alongside implementation.

## Existing implementation and important constraints

- `src/server/cli.ts` is currently a server/browser launcher; `src/server/app.ts` and `src/server/routes/` compose services through Fastify. `src/server/runs/orchestrator.ts` owns managed execution, PTYs, preflight, frozen snapshots and run actions.
- Config and active-run update queues in `src/server/config/store.ts` and `src/server/runs/store.ts` are in-process, not cross-process locks. Merely invoking services directly from multiple short-lived CLI processes can lose updates, race active-run ownership, or incorrectly recover a live run as interrupted.
- Before this work, `src/server/catalog/remote.ts` capped each snapshot at 100 packages, 100 native agents, 2,000 files, and 20 MiB combined snapshot contents; it also capped Git output at 2 MiB, staging at 128 MiB / 10,000 entries, with clone and command timeouts. Its snapshot schema embedded some caps. It buffered the tree and ran `git cat-file` per file, so raising a single constant was insufficient.
- `src/shared/discovery-handoff.ts` caps selected candidates independently at 100 packages, 2,000 files and 20 MiB decoded; `src/portable/bundle.ts` has corresponding bundle caps. Large catalog discovery must let users select a smaller set, and explain when an individual selection cannot fit.
- `skill/scenario-discovery/SKILL.md` and its mirrors create reviewable v1 bundles and currently require UI-mediated remote setup. `.github/skills/loom-run-bundle/SKILL.md` and `src/portable/` already coordinate v1 bundle runs in the current host; selected native-agent v2 bundles can be inspected but cannot currently be prepared by that portable runner.
- The product OSC parser in `src/server/runs/osc.ts` and ADR-0007 document a mismatch with recorded live OpenCode output. Resolve and live-verify it before representing OpenCode automatic mode as supported end to end; otherwise fail closed and describe the limitation.

## Target architecture and contracts

### Single owner and transport

1. Extract a reusable composition root from the route/server construction, exposing config, project registry, catalogs, chain/draft/library services, bundle operations, preflight, managed workspaces, terminal manager, and one orchestrator. UI routes and CLI control handlers call the same service methods and validation; no HTTP-to-self or duplicated business rules.
2. Provide explicit `service start`, `service status`, and `service stop` commands (names finalized with CLI contract). A service started without UI owns a profile until stopped; the current web launch starts or uses that same owner and preserves its loopback-only browser behavior. Start does not silently start a browser for headless commands. Reject an incompatible or differently configured owner with a clear error.
3. Use a user-private local IPC endpoint (Unix socket / Windows named pipe or equivalent), protected by directory and endpoint permissions and authenticated client/owner handshake appropriate to the platform. Define startup handshake, protocol and application version negotiation, endpoint discovery, ownership metadata, stale-owner recovery and cleanup. Do not trust a stale PID alone; handle PID reuse, crashes, races, unsupported platforms and permissions failures explicitly. Keep the existing browser attack surface and origin protections intact; do not expose an unauthenticated remote listener.
4. Take an exclusive cross-process profile ownership lock before startup recovery or any mutable service access, including the web server; reject a second owner without disturbing the live run. Ensure commands that mutate config, snapshots, projects, chains or managed runs route through the owner; read-only offline artifact inspection can run without it. Atomic JSON renames alone are not a lock. Test simultaneous UI/CLI startup and updates from real separate processes.
5. Managed processes belong to the service, not a short-lived client. Client disconnect does not imply completion or a retry. Specify stop behavior: refuse normal stop with an active run; an explicit abort/stop path terminates and reaps children, persists the honest result, then releases ownership. On service crash/startup only the verified new owner performs interruption recovery; never assume an interrupted attempt succeeded or replay it.

### Cross-platform managed execution gates

These are requirements to implement and verify, not current guarantees:

1. Define a backend-neutral contract for reviewed content, process containment,
   terminal attachment, shutdown and crash recovery. Bind exact chain and
   package contents, destination, inputs and intended action to review. Before
   each start or execution action, provide a protected view of the reviewed
   packages and verify that the harness resolves from it, including native
   agents where supported. Prevent substitution through writable project,
   personal or other skill locations within the documented threat model.
   Availability of content does not prove that the model invoked a skill.
2. Select a verified native backend where available: investigate Linux
   delegated cgroups with race-free initial placement, Windows job objects
   with race-free process assignment and ConPTY support, and a macOS native
   containment mechanism that demonstrably prevents descendant escape. Do not
   treat process groups, a direct child's exit, or a proposed API as evidence
   of containment. An unavailable or unverified backend must fail closed.
3. If native guarantees cannot be met, offer an explicitly approved Linux VM
   backend on macOS and Windows. Specify installation, guest provisioning,
   harness and authentication setup, project synchronization, terminal
   transport, protected package staging, network access, permissions, and
   cleanup before implementation. VM execution must not silently replace the
   user's host harness or change their project and trust semantics. It is not
   a promise of isolation from an administrator or unrelated host writers.
4. Implement Windows user-private control transport and ownership before
   claiming Windows CLI parity. Keep existing execution blocks and retained
   project claims until the selected backend proves cleanup, including after
   failure, service crash, restart, and explicit reconciliation. Neither a
   terminal status nor operator confirmation alone proves descendants exited.
5. Test actual Linux, macOS, and Windows hosts, including supported native and VM
   paths, with adversarial package replacement, alternate skill locations,
   detached descendants, failed termination, crashes, cancellation, terminal
   reattachment, and independently reviewed retries. Live harness tests require
   separate approval and cannot be replaced by fake-process tests. Document
   unsupported configurations and fail closed until each acceptance gate passes.
   The manually triggered cross-platform verification workflow runs offline
   typechecking, documentation checks, and Vitest on hosted runners; it does not
   provision a VM, run live harnesses, or by itself verify containment.
   The initial full Node 24 matrix passed on Linux but failed on macOS
   (28 of 62 test files) and Windows (38 of 62; two skipped). Failures include
   noncanonical temporary paths, PTY startup, and Windows-specific filesystem
   behavior; these are not yet all diagnosed. The workflow retains the full
   suite and permits explicit focused runs while the failures are resolved.
   A subsequent full run still failed on macOS (20 of 65 test files) and
   Windows (31 of 65; three test files skipped). The focused claim suite has
   since passed on all three platforms, including the formerly skipped
   cross-process Windows cases, but an earlier macOS race failed once and remains
   under investigation. A clean hosted macOS ARM64 install gave `node-pty`
   1.1.0's prebuilt `spawn-helper` mode `0644`. The package postinstall now
   grants owner execute permission to a private regular helper, and a clean
   macOS runner passed the focused terminal suite without a manual repair.
   The latest full hosted Windows run (`42643752970`) failed 12 of 65 test
   files (17 tests failed, 864 passed, 58 skipped); three files were skipped.
   Remaining failures include platform-specific fixtures and executable mode
   handling, and still need diagnosis before Windows suite coverage can be
   claimed.
   The preflight unit suite subsequently passed on hosted Windows after its
   synthetic paths were made platform-absolute (`42642647286`). POSIX
   `chmod(000)` permission tests do not test Windows ACLs and are skipped there;
   simulated browser permission failures remain covered, but real Windows ACL
   denial and catalog permission-warning behavior still need verification.
   The POSIX mode requested for config files is not proof of private Windows
   ACLs; administrators must verify inherited access until ACL handling is
   implemented and verified.
   The remaining focused filesystem suite passed on hosted Windows
   (`42643035508`) with those POSIX permission tests skipped.
   Shell-free harness PATH lookup also tries an `.exe` suffix on Windows for
   extensionless command names; it does not resolve `.cmd` or `.bat` wrappers
   through a shell. This lookup alone does not establish Windows harness or
   managed-run support. A focused hosted Windows test (`42643548246`) found
   and launched a native executable from a path containing spaces.
   The focused CLI unit suite also passed on hosted Windows after its expected
   paths were made platform-native (`42644457911`).
   A later full baseline after the profile-alias fixes passed Linux but failed
   12 of 65 macOS files and 25 of 65 Windows files (three Windows files
   skipped). This baseline predates the subsequent snapshot-mode changes.
   Several macOS failures compared canonical results to noncanonical temporary
   fixture paths; those fixtures now use canonical roots without weakening
   explicit alias tests. Removing a deleted extra-skill directory also now
   resolves aliases in its surviving ancestors. The focused hosted macOS suite
   covering all 12 formerly failing files passed. A subsequent full hosted
   macOS run (`42641736064`) also passed its typecheck, documentation check,
   and complete Vitest suite. This is offline suite coverage, not live harness
   or descendant-containment verification.
   Workspace storage, workspace inspection, global drafts and global templates
   now canonicalize config ancestors (including macOS `/var` aliases) while
   rejecting a symlink as the configured directory or storage child. Focused
   lifecycle and symlink-rejection tests passed on hosted Linux, macOS and
   Windows; the discovery-workspace alias test also passed on all three after
   snapshot-mode preservation was added.
   This does not establish that every profile surface supports aliases. Focused Windows
   terminal suite initially failed on resize, exit status, locked test
   directories, missing-executable expectations, and timeouts. Passing
   POSIX signals to `node-pty` on Windows caused deferred asynchronous errors;
   the transport now requests Windows termination without a POSIX signal,
   and the focused Windows terminal suite has passed, including a termination
   request before a child emits its delayed first output. A child that never
   emits output and descendant containment remain unverified.
   Catalog refresh now canonicalizes the configured directory before creating
   and reading snapshots while rejecting a symlink as the configured directory
   itself. The focused macOS catalog and discovery suite now passes with
   canonical fixtures; Windows previously had ten failures, including snapshot
   content validation and
   `EPERM` when publishing an already-existing snapshot directory. Refresh now
   accepts a Windows `EPERM` collision only if the existing manifest matches
   the newly staged manifest and its packages, agents, and usable index verify;
   mismatches fail without replacing the existing snapshot. A focused hosted
   Windows test passed for repeat publication and tampered package, agent,
   manifest and index rejection; executable-mode preservation remains separate
   and unresolved. A hosted
   filesystem probe observed `0644` to `0755` on Linux and macOS, but `0666`
   before and after `chmod(0755)` on Windows. A versioned per-package Git mode
   index is now checked against snapshot fingerprints and carried through
   handoff and bundle export; legacy snapshots gain an index only after refresh
   verifies their contents. Windows installation and reuse of executable bundle
   packages and remote executable-package copy remain explicitly blocked until
   reviewed mode metadata can also be preserved and validated after install.
   Focused hosted Linux, macOS and Windows tests passed for migration,
   tamper rejection, handoff, bundle export and the standalone handoff builder;
   the Windows test also verified that executable installation is blocked.
   The hosted Linux runner's read-only probe found cgroup v2 but no write
   access to its root or current cgroup. `/dev/kvm` was not accessible to
   the runner user and QEMU was not installed. This does not rule out a
   separately provisioned delegated cgroup or VM, and does not establish
   containment or safe privileged provisioning.

### Versioned CLI and process interface

- Preserve existing no-subcommand usage, `--help`, `--version`, `--no-open`, `--port`, `--config-dir`, and package entry point. Add discoverable subcommands with consistent `--help`, project/profile selection and explicit owner-unavailable diagnostics. Document any necessary compatibility changes before release.
- Define a versioned machine JSON envelope for results and typed failures, stable documented error codes and exit codes, stdout reserved for results/events, stderr for redacted diagnostics, and no banners in JSON mode. Provide human-readable output separately. Specify JSON Lines streaming vs single JSON results and ensure status/action commands are safe for concurrent callers.
- Pass prompts, input values, approvals and manifest payloads through bounded structured stdin or explicit protected files, not command-line arguments; never put credential values in config, logs, bundle manifests or error details. Explain that resolved run inputs may be stored locally under existing run contracts; do not claim they are secret storage.
- Proposed command groups and minimum operations (names illustrative, finalize with tested `--help` and schemas):
  - `catalog source list/add/remove/refresh`, `catalog list/search/inspect`, and configuration of global/per-source budgets, with exact source id, revision, repository path, fingerprint, warnings and pagination/cursors.
  - `chain draft/create/show/validate`, named inputs, harness/session choice, ordered skill/instruction steps, exact snapshot bindings, and optional supported native agent.
  - `bundle create/inspect/import` including explicit target project, package inventories, conflicts and review; no overwrite, unsafe paths, symlink escapes, ambiguous names or silently changed package reuse.
  - `test create/status/inspect/remove` for retained managed workspaces, with static validation default and separately approved live run.
  - `run preflight/start/status/events/attach/action` for supervised and automatic managed runs, including user decisions, pause, abort, retry, skip and interrupted-run recovery. Stream terminal bytes separately from structured events, enforce one subscriber, support resize/TTY teardown, and make non-TTY interactive requirements explicit.
  - In-session execution remains a distinct portable skill/helper protocol: inspect, prepare, step, record and resume; expose integration points without making the CLI pretend to control the host agent or bypass host confirmation. Explicitly block selected-agent v2 preparation until that mode has a verified supported mechanism.
- Establish explicit approvals bound to reviewed artifact fingerprint, source revisions, destination and intended action. Review/redistribution, live test, installation/conflict reuse, execution, automatic progression and broad harness permissions are separate decisions. Non-interactive commands lacking required consent stop with a machine-readable action-required result; never convert generic `--yes` into blanket approval or allow package text to grant it. Avoid claiming that a CLI flag proves a human actually reviewed content.

### Large internal and external Git catalogs

1. Extend versioned config with validated global defaults and optional per-source overrides for package/agent counts, total files, per-package bytes, total snapshot bytes, staging bytes/entries, tree/Git output and timeouts as applicable. Preserve existing config through defaults or a deliberate migration, set finite absolute hard ceilings, validate safe integer arithmetic, and show effective limits via CLI and UI. Separate per-package and aggregate bytes, which currently share one constant.
2. Keep conservative defaults compatible with existing installations; permit users to opt in to a documented higher preset or bounded custom values. The supported higher setting must allow at least 1,000 skills and 20,000 package files in one source, with matching staging, tree output and total-byte budgets. Internal and external HTTPS/SSH Git sources use the same protections; no embedded credentials or implicit trust.
3. Decouple snapshot parsing/format compatibility from current refresh policy: a previously valid snapshot remains readable after limits are lowered, subject to finite format safety ceilings. Migrate or version schema deliberately if necessary; existing pinned snapshots, chain bindings and UI selections must remain valid. Return an explicit unsupported-version or safety-budget error, never silently hide snapshots or truncate results.
4. Replace whole-tree buffering and per-file process churn where needed with bounded streaming/incremental parsing and batched Git object retrieval; enforce limits while receiving data, before materialization, with bounded memory, child cleanup, timeouts and staging quotas. Never execute repository hooks, files or scripts, follow symlinks, accept traversal, or weaken pin/fingerprint checks. Account for Git transfer/staging behavior and cancellation; preserve the last valid snapshot on any failure.
5. Add efficient stable pagination/search for large indexes, exact deterministic ordering and duplicate-name handling. Progress and typed errors identify the source, limiting dimension, configured threshold and safe corrective action without leaking remote credentials. Do not silently drop packages; keep publication atomic and clean temporary staging on failure.
6. Preserve selected-candidate handoff and bundle limits independently; users can select a subset from a large catalog. If the selection exceeds its own limit, fail clearly before installation or execution and suggest narrowing it. Do not increase portable artifact limits automatically.

### Agent discovery, review, testing and execution

1. Update `scenario-discovery` and the mirrored/package build paths so the host can use the installed CLI to list configured catalogs, refresh only when explicitly requested, inspect pinned candidates and propose up to three evidence-based chains from the goal. Treat goal, remote files and helper output as untrusted data; inspect complete selected package files without executing them.
2. Produce a complete chain draft and review display: goal, harness/session semantics, step instructions and inputs, exact selected identities and fingerprints, full inventories, executable bits, native-agent definition if selected, permissions, risks, source and destination conflicts, and redistribution implications. No fabricated skill capabilities or guarantee of model invocation.
3. Validate schema, input placeholders, source availability, exact fingerprints, conflicts, harness capabilities and portable bundle limits before any live action. Generate the same bundle through shared services as the UI; v1/v2 compatibility and native-agent limitations must be truthful. If exact source provenance cannot fit an existing bundle format, retain it as separately validated local review evidence rather than claiming the bundle contains it; introduce a new version only with an explicit compatibility/migration decision.
4. Reuse managed test workspaces under the configured Loom root: create unique registered ownership, materialize only selected chain/packages, retain outputs until explicit removal, refuse active-workspace removal, and offer status, inspection and safe cleanup. Describe their isolation honestly. An optional live test must pass normal preflight and have separate execution/permission consent; its artifacts and observed outcomes are evidence, not proof of semantic correctness.
5. Re-validate the exact approved bundle fingerprint and destination immediately before import and before starting a run; report changed source/target, existing package differences and stale approval. Install into the existing shared skill location with existing conflict rules. Importing the bundle/chain and running it are separate operations.
6. Managed mode freezes chain, inputs, session plan, permissions and source-dependent material; uses adapter-provided shell-free spawn specs and existing preflight/trust restrictions; exposes supervised confirmation or explicit automatic mode. OpenCode advancement requires a working-to-idle signal per step; Copilot uses process exit. Never advance on silence. Non-zero exit, missing signal or timeout pauses; no implicit retries.
7. In-session mode preserves the portable helper's independent state, one-attempt-at-a-time/revision checks, explicit outcome records, session-mechanism and host compatibility disclosure. Agent-reported completion is not a harness signal or independently verified result; changed packages, interrupted attempts and retries require explicit reconciliation. Current portable and managed locks/state are not interchangeable; prevent accidental simultaneous writes to the same target or document and enforce a clear coordination rule.
8. Provide a structured optional test/evaluation specification for expected artifacts and safe, explicitly selected checks, with evidence and failure reporting. Reuse existing validation/check execution mechanisms if available; do not execute arbitrary catalog-provided scripts by default. This is separate from semantic model evaluation and does not guarantee a skill fired.

## Implementation milestones / tracking todos

| Milestone | Status | Acceptance gate |
|---|---|---|
| Track and baseline | Done | Plan, baseline, and architecture decisions recorded |
| Shared core and owner | In progress | Cross-process ownership and lifecycle verified |
| CLI protocol and catalog scale | In progress | Machine protocol and 1,000-skill / 20,000-file fixture pass |
| Headless authoring and bundles | In progress | CLI and UI share validated authoring and import behavior |
| Managed workspaces and execution | In progress | CLI run lifecycle and recovery verified |
| In-session and discovery skills | In progress | Both skills work through documented headless contracts |
| Evaluation, end-to-end and release | In progress | End-to-end acceptance and documentation complete |

1. **Track and baseline:** Maintain the approved plan as `docs/standalone-cli-plan.md`, add relevant documentation links, record baseline CLI/UI behavior, limits, and regression tests; write ADRs for single-owner IPC and command/approval contracts.
2. **Shared core and owner:** Extract composition, introduce profile ownership, authenticated local control and explicit service lifecycle, preserve web launcher and UI behavior, implement startup/crash/stop handling and cross-process tests.
3. **CLI protocol and catalog scale:** Add versioned output/input/error conventions, source configuration/refresh, bounded scalable snapshots and pagination, budget UI/config and old-snapshot compatibility. Verify the 1,000-skill/20,000-file fixture and all boundary failures.
4. **Headless authoring and bundles:** Expose project/catalog/chain/draft, validation, handoff, bundle create/review/import and conflict flows via shared services; retain versioned compatibility and explicit approvals.
5. **Managed workspaces and execution:** Expose workspace lifecycle, preflight, managed run actions, events and interactive terminal; address OpenCode signal gap with regression and live verification before enabling the relevant automatic path.
6. **In-session and discovery skills:** Update scenario-discovery, mirrors and generated skill packaging; integrate current-host portable flow with honest host/session/v2 limits, user review and consistent headless CLI contracts.
7. **Evaluation, end-to-end and release:** Implement bounded opt-in test checks, run integrated UI/CLI/agent and packaged journeys, document limitations and security model, update ADRs/readme/guides/changelog/release notes as appropriate, and update the tracked plan's milestone status and remaining gaps.

Dependencies: 2 follows 1; 3 follows 2; 4 follows 2 and 3; 5 follows 2 and 4; 6 follows 3, 4 and 5 for full end-to-end workflow; 7 follows 3–6. Individual independent tests/docs can proceed alongside their implementation milestone. Preserve usable behavior at each milestone.

Read-only offline bundle inspection is an independent early slice of milestone 4;
it uses the existing portable inspector and does not access or modify shared state.
The production server now takes an OS-backed SQLite profile ownership lock
before startup recovery. The lock must not be deleted while a service is running,
and the profile filesystem must support SQLite locking. Failed recovery retains
its orchestrator until shutdown succeeds; cleanup failure prevents the service
from releasing profile ownership. A retry cleans the failed internally-created
orchestrator first; an injected instance is not reused after recovery fails.
Configurable global and per-source catalog budgets, version 1 config migration,
bounded batched blob retrieval, and the 1,000-skill / 20,000-file Git fixture
are implemented. Refresh indexes each tree file under its containing packages
instead of rescanning the entire tree per package; nested files still count
against the file budget once for each containing package. The staging monitor tolerates Git's transient files or
subdirectories disappearing during a scan while surfacing other I/O failures;
it remains a polling guard, not a filesystem quota. Snapshot integrity checks
bound file reads by the recorded package size and reject unexpected files or
changed content. Real child-process tests exercise stdout and stderr output
limits below, at, and above the threshold and verify staging cleanup. A real Git
fixture also checks mixed skill and native-agent file counts, per-item bytes,
and aggregate snapshot bytes below, at, and above their limits, preserving the
previous snapshot after rejection. The same real-Git fixture now exercises
package and native-agent count limits at those boundaries as well. A real Git
fixture also verifies distinct same-name packages through indexed and fallback
pagination, exact-identity handoff, and mismatched-fingerprint rejection. The
standalone bundle helper rejects selecting both ambiguous names and accepts one
explicitly selected identity. Read-only CLI
source and snapshot listing, verified candidate paths for content review, deterministic
snapshot and project-catalog search pages, a shared lazy run owner, and authenticated Unix local
control for source and limit mutations are available. Project registration,
project chain listing and inspection, draft creation and model validation, draft and project-chain bundle export, reviewed
reviewed bundle import, run preflight/status/abort/event streaming and TTY
terminal attachment, reviewed non-spawning run outcomes and pause, and restricted
reviewed supervised starts for instruction-only chains, and test-workspace
create/list/inspect/remove use the same owner. Import approval binds the bundle
fingerprint, destination identity, inventory, and conflict state. UI and CLI
imports now bind reuse to installed-package fingerprints, require separate
confirmation for differing contents, and recheck selected packages before
saving. Review evidence neither locks external changes nor establishes human
review. HTTP import callers must send the preview's digest. Normal service stop
refuses active or changing runs. New snapshots have a local page index; old or
stale indexes and unusual Unicode use validated-manifest fallback. Project
catalog paging uses bounded, expiring owner-side snapshots to keep later pages
stable without rediscovery; oversized results explicitly fall back to uncached
paging. The first page still loads and verifies the complete merged catalog.
Windows control, full CLI authoring and execution, and remaining acceptance
coverage are still required. Project coordination has since been integrated as
described below.
Project-chain and draft create/update/remove are available through the owner.
The UI, CLI, and project-chain/draft HTTP update and delete endpoints require
content-bound revision preconditions and reject stale changes. Legacy HTTP
clients must load and send the revision. External filesystem writes remain
uncoordinated, so this is not an unconditional concurrency guarantee.
The OSC parser now recognizes the observed colon-separated format in tests,
but prior live evidence also includes `clear` before `idle`; automatic OpenCode
advancement remains unverified until the signal contract and live gate pass.
The discovery skill documents the partial CLI catalog and draft workflow;
skill-bearing CLI starts and recovery are not yet integrated. Restricted instruction-only start supports supervised
mode and automatic process-exit mode; automatic progression and reported broad
permissions each need separate confirmation. OSC-based automatic CLI starts
and execution actions remain blocked pending live verification. The start binds the chain,
project identity, inputs, and preflight evidence and requires execution
confirmation plus separate live-test confirmation for a test workspace.
Fake process-exit CLI tests cover completion, nonzero-exit pause, reviewed
resume, replay-approved retry, skip followed by approved next, and independent
live-test and broad-permission confirmation; these are not live harness evidence.
An explicitly approved isolated live probe on 2026-11-09 recorded Copilot
1.0.105 trust resolution but could not verify execution or session recall because
the Copilot model API hostname did not resolve. OpenCode was unavailable on
PATH. The probe removed its temporary root and processes; the current evidence
records these failures, not a harness pass. The earlier probe is retained in
`docs/evidence/live-execution-2026-11-04.json`; its OpenCode signal observation
does not establish that the current advancement state machine can advance.
An OpenCode-only execution probe now writes separately scoped evidence, without
invoking Copilot, and fails if the captured signal does not advance the product
state machine. Its operator procedure is in `docs/OPERATIONS.md`. Fake PTY
coverage includes alternate terminators, clear-before-idle, clear after a
qualifying transition, and token text before the working signal; no new live
verification is implied. Session cleanup fails if a successful delete cannot
be followed by a list that verifies the session is absent.
Live supervised instruction-only runs also support reviewed next and retry
actions, with distinct execution, replay (for retry), and live-test approvals.
Interrupted instruction-only runs support reviewed retry, continue, and restart;
the owner serializes competing actions and rechecks current preflight.
Supervised transitions and automatic OSC advancement now wait for the prior
process to exit, escalating termination before dispatching another step.
Termination failures prevent advancement; automatic runs pause with an explicit
failure reason. Supervised steps now persist their running snapshot before
spawning. A failed pre-spawn write pauses the live runner without spawning;
signal-driven automatic persistence failures also pause instead of silently
leaving a completed or unspawned step running. These pauses are reported in
memory and may not be durable until storage is repaired. If shutdown or
post-spawn startup cleanup cannot terminate the
managed process, the owner retains the runner and active pointer rather than
recording a terminal state. If run-owner cleanup fails during service shutdown,
the service reports `failed` and retains its control endpoint so `service stop`
can retry. Failures later in transport or server teardown may not be retryable
through that endpoint.
Finalization also awaits runner shutdown and retains a failed terminal cleanup
instead of allowing a new run to begin. Shutdown drains in-flight run mutations
and automatic transitions and prevents a later step from spawning during that
drain. This does not guarantee that detached
descendants have exited. Cross-process project ownership was subsequently
added as described below, but it does not prove descendant cleanup.
An opt-in `workspace evaluate` command checks explicitly named regular files,
optional SHA-256 values, and case-sensitive UTF-8 substrings without executing
workspace content. JSON Pointer checks can also compare a selected JSON value
with an explicitly supplied scalar. Checks are bounded and report observations,
not semantic correctness. Numeric observations fail closed when conversion
loses the original JSON token's decimal value; expected numbers are still
parsed as JavaScript numbers, so hash checks are needed for exact numeric text.
Broader evaluation and
end-to-end acceptance remain open.
CLI discovery handoff preparation now uses the same pinned-candidate validation
as the UI; it returns complete content to the caller but does not approve
redistribution, installation, or execution. It rejects selections exceeding
the independent handoff budgets before reading package contents and enforces
the remaining budgets while collecting files. The large-catalog fixture also
prepares a two-package handoff from the first and last indexed entries.
Preparation reads only the selected source/revision manifests, verifies their
identities and reuses them within the request; an unrelated corrupt revision
does not prevent reviewing an otherwise valid pinned selection.
An HTTP or control client disconnect now requests cancellation of its catalog
refresh. A queued refresh does not start Git after cancellation; active Git
process groups are terminated and unpublished staging is removed. Linux tests
cover cancellation and timeouts during clone and blob retrieval, including
unresponsive descendants, and preserve the previous snapshot. A publication
rename already in progress may still complete; Windows process-tree cleanup
remains unverified.
Real Git-command fixtures exercise staging entry and byte limits immediately
below, at, and above their thresholds while preserving the previous snapshot.
Git command-output and batched blob diagnostic limits also report the exact
`maxCommandOutputBytes` dimension, threshold, and source without disclosing
Git output. Both streams and the batched reader have boundary coverage.
Refresh rejects non-UTF-8 Git tree paths rather than changing their identities;
a real Git fixture confirms that valid replacement characters remain supported
and that rejection preserves the preceding snapshot.
A real Git fixture also checks that refresh and handoff preserve adversarial
instructions, an executable script, and a package postinstall declaration as
data without running the script. Refresh overrides Git hooks using an absent
path inside its private temporary root; the fixture verifies a configured
reference-transaction hook runs during an ordinary clone but not refresh.
Git may still invoke configured credential helpers or SSH transport programs.
This does not establish how an agent will interpret untrusted instructions
after receiving them.
The 1,000-package/20,000-file local Git fixture measures the test process's RSS
high-water mark and samples the temporary clone staging tree every 100 ms.
On Linux it also samples RSS for Git and other descendants. One isolated run
observed 159,649,792 bytes process RSS, a 161,349,632-byte sampled process-tree
peak, 241,745 staged file bytes and 47 staging entries. The fixture asserts
ceilings of 768 MiB RSS, 128 MiB staged bytes and 30,001 entries (including its
wrapper directory). Tree and staging samples can miss brief peaks and exclude
filesystem metadata overhead; staging monitoring is not a filesystem quota.
Portable preparation requires a digest from inspecting the bundle and target;
it rechecks the bundle, project identity, and existing package fingerprints.
This is point-in-time evidence, not proof of review or a lock against external
changes. Portable and managed runs still require coordination.
Current portable helpers serialize mutations with their existing per-project
lock and check bounded, validated portable run records before package
installation or step dispatch. Another unfinished portable run blocks those
operations; unsafe or corrupt records and scans exceeding 1,000 other records or
64 MiB fail closed. In legacy mode, completion and explicit abort permit a later
run; in internally enabled protocol mode, the retained claim requires separate
reviewed clearing. This does not coordinate with managed runs, earlier helper
versions, external edits, or, in legacy mode, the gap between a crashed
installation and the first run record.
Portable setup now preserves the existing `.loom/.gitignore` as plain text and
ensures both `runs/` and `portable-runs/` are ignored, including when it creates
the file. Earlier helpers could have written a quoted JSON string; affected
projects need manual ignore-file and Git-index review.
An integration journey now exports the same project skill bundle through CLI
and UI, then inspects, prepares, steps, explicitly recovers an interrupted
attempt, and records its outcome in a separate project using a simulated
portable host. Its Copilot catalog uses an injected fixture scoped to the
temporary project, not the host's installed CLI or personal skills. This does
not constitute live harness evidence.
An integrated fixture now carries a pinned catalog selection through the CLI
handoff and standalone discovery bundle builder through a disposable workspace
test and artifact check before reviewed CLI import, UI chain inspection, and
the standalone portable helper's supervised step and agent-reported completion.
Remote exports use the safe skill name rather than the internal snapshot hash
as the package directory, matching the discovery bundle for reuse. After
materialization, workspace chain steps resolve the copied project packages
rather than retaining remote snapshot bindings. The fixture enables project
coordination and separately reviews and clears the retained claim. It uses
simulated approval and does not execute a real agent, package script, or live
model.
The `loom-chain-workflow` skill now composes the installed discovery and
portable runner skills with CLI workspace testing and reviewed import. It
preserves separate approvals and documents the existing managed-start and native
agent blocks; its instructions are not proof that a host follows them.
After retrying an interrupted run, the UI now reconnects its run event stream
and observes subsequent actions from other clients. One earlier Playwright run
under concurrent test load showed a blank recovered terminal; isolated repeats
passed. A later reconnect test also showed a blank terminal before reload;
subsequent isolated runs passed, but neither failure's cause has been
established. The reconnect test now attaches redacted WebSocket frame metadata
on a terminal-output assertion failure to help distinguish transport from
rendering failures without recording terminal contents.
The disk filled during a concurrent browser and unit-test stress run, which also
produced a blank terminal; this does not establish the earlier failures' cause.
Playwright now uses per-process owned temporary roots, fail-closed placeholder
harnesses, and restores placeholders between harness specs. Normal process exit
removes those roots, but forced termination can still leave them behind. After
the operator authorized removal of six inactive old roots, the full unit suite,
browser suite, and package smoke passed sequentially. A full browser run using
the 64 MiB `/run` workaround failed with `ENOSPC`; the repeat on disk passed.
Concurrent stress and the earlier intermittent failure causes remain open.
Repeated terminal attachment rejections now consume the retry budget until the
server actually accepts a subscriber; an exhausted retry is visibly reported
and announced. This fixes an independently reproduced unbounded retry loop,
but does not establish the cause of the earlier blank-terminal failures.
Separately, a reproducible stale attachment after a supervised Next is fixed:
the runners publish a process-started event only after the new process is
attached, and both run views reattach the existing xterm without clearing its
scrollback. Initial and recovered event-stream snapshots also prompt terminal
recovery when an exit was missed, without reconnecting an otherwise healthy
terminal.
Browser fixtures cover Next, Retry, automatic advancement, and a missed start
during disconnection or before the initial snapshot. In the disconnection test
xterm deferred its DOM rendering while
off-screen; the assertion brings the terminal into view before checking output.
This does not explain the earlier intermittent blank-terminal failures or
establish live harness behavior.

### Remaining project coordination design

Portable helpers exit between commands, while a host agent may continue working
after `step` returns. A process-lifetime lock or PID cannot therefore represent
the lifetime of a portable run. Managed runs are owned by a profile rather than
a project, and distinct profiles can target the same project. The existing
profile lock, in-process action queues, portable `.lock`, and active-run pointer
do not establish mutual exclusion across those boundaries. Startup recovery now
leaves active records not named by its own profile pointer unchanged and logs
`RUN_RECOVERY_AMBIGUOUS`. This prevents a second profile with no matching pointer
from interrupting those records, but a matching stale pointer is not proof of
exclusive ownership and starts remain uncoordinated. Continue to avoid starting
another profile that knows the project while a managed run is active.
Startup now also fails without deleting a corrupt active-run pointer; the
same holds when its run record is corrupt, unreadable, or unsupported. The
operator must investigate and establish that earlier work has stopped.

The coordination implementation must use one cross-process, per-project
serialization mechanism together with a durable, validated claim. The claim
must survive helper exit and represent the full period during which a run can
modify the project, including paused and unresolved attempts. It must cover
portable package installation and preparation, managed starts and recovery
actions, subsequent transitions, and completion or explicit abort. A failed
write or crash between record and claim updates must leave a recoverable,
fail-closed state; clearing a claim solely because a PID disappeared, an active
pointer is absent, or a run is interrupted is unsafe. Reconciliation must
validate existing portable and managed records, surface corrupt or ambiguous
state without overwriting it, and require an explicit resolution where work may
still be in progress. No recovery path may automatically replay a step.

The implementation must define migration and compatibility with older helpers
and services that do not participate in the protocol, document unsupported
filesystem and platform semantics, and distinguish coordinated Skill Loom
operations from unrelated external filesystem edits. Exercise races between
different profiles and portable processes, installation and execution, crashes
at each persistence boundary, cleanup failure, old and corrupt records, and
terminal and recovery transitions before claiming coordination is complete.

The proposed mechanism is a single project-local SQLite database containing at
most one versioned claim. Use a short exclusive transaction to create, inspect,
or release the claim; keep the committed claim, not the database lock or a PID,
for the entire run lifetime. Include the run kind and id and the canonical
project identity in the validated claim. Serialize database access within each
process as well: opening and closing a second descriptor for an already locked
SQLite inode can undermine POSIX process-level locking. The database and its
parent must be regular, contained, and protected by the project's ignore rules;
unsupported locking or corrupt/unknown state must fail closed.

A shared SQLite claim transaction primitive now exists with cross-process
contention, validated claim records, fail-closed database checks, and Git ignore
rules. Portable mutations now participate in this transaction: when the
internal protocol is enabled, preparation commits a claim before package
installation, and step, record, and resume require the matching claim. Claims
remain after failures and terminal outcomes until separately reviewed clearing.
After committing a new claim, the initial mutation asynchronously retries for
up to one second if a competing process briefly holds the transaction. Only
lock acquisition is retried, never a callback that has started. If the wait
expires, no mutation is dispatched and the retained claim still requires review
and reconciliation.
In legacy mode portable mutations serialize with protocol enablement but do not
create a claim. Managed starts now claim before run creation or harness spawn
when the internal protocol is enabled. Explicit actions, signal-driven
automatic transitions, supervised exit updates, and shutdown verify the matching
claim under the project transaction. A managed claim survives failed starts,
completion, abort, and shutdown. An interrupted claimed run can be retried or
continued after explicit recovery, but restarting it as a new run is blocked
until the old claim is separately reconciled. Reviewed enablement and
reconciliation are available through both clients. Reconciliation holds an
exclusive owner mutation barrier, and service shutdown waits for an in-flight
action to finish. Descendant cleanup remains
unverified, so the operator must confirm prior work and older clients have
stopped; cross-mode protection is not complete for older clients or unrelated
processes. An integration fixture verifies that a separate-process portable
claim blocks a managed start, and that a managed claim blocks portable
preparation; neither conflicting operation is allowed to dispatch work.
Headless process errors after a successful spawn are now reported without
treating them as an exit; cleanup still waits for an actual exit, escalates,
and retains the process when termination cannot be confirmed. This protects
direct-child lifecycle handling but does not establish descendant containment.
The health endpoint now reports the existing run owner's current state, or its
last persisted active-run pointer if the owner has not initialized, rather
than an inactive placeholder. It does not start recovery. A corrupt pointer
fails the endpoint instead of being silently treated as inactive. Neither
source is proof of process or descendant liveness.
The CLI can also list bounded managed and portable run-record summaries for a
registered project without initializing coordination or recovery. It fails on
unsafe or corrupt records rather than silently omitting them. The scan is not
an atomic snapshot and does not report retained claims or prove process exit.
CLI group and command help now exposes the principal structured request shapes
and approval boundaries without reading stdin or starting a service; the
administrator guide remains the complete contract for conditional approvals.
Test and discovery workspace removal now rejects retained claims and unresolved
records, commits a retirement marker under the project transaction, and moves
the workspace out of its registered path before deletion. It persists verified
workspace identity in the profile before deletion, allowing retry after a failed
final profile update. A missing workspace without that evidence, a recreated
workspace, and partial deletion that destroys the retirement database fail
closed and need operator investigation. A retry also handles a completed
retirement or rename. Older versions can reject profiles containing this
in-progress evidence and must be stopped or updated. Database version 1 is
migrated under the transaction to version 2; older participating clients reject
the newer schema and must be stopped and updated. Nonparticipating clients and
descendants still require the operator's explicit attention.
Startup recovery now holds the project transaction when handling its matching
profile pointer and leaves that pointer and run unchanged when a claim exists or
the protocol is enabled; it reports `RUN_RECOVERY_CLAIMED`. It creates the
project-local claim database and ignore rule even for legacy recovery. Legacy
scanning, retained claims, and explicit reconciliation are implemented; broader
compatibility and end-to-end failure and multi-process coverage remain required.
The orchestrator's final stale-pointer cleanup also respects the claimed
recovery result, including when the referenced run is already terminal; it
rechecks project coordination under the transaction before clearing an
otherwise stale pointer.
Internal reviewed operations now cover protocol enablement, legacy adoption,
and interruption of a claimed managed run after explicit confirmation that prior
work and older clients have stopped. The interruption retains the claim and
requires the caller to own the affected profile; an interrupted run remains
unresolved. A separate reviewed abandonment can record an interrupted managed
run as aborted without replaying it; it retains the claim for another reviewed
release and can retry pointer cleanup after a crash. These confirmations are
operator assertions, not proof that descendants or older clients have stopped.
These operations are exposed through reviewed CLI and project-page actions.
The service blocks them while it owns a live project run. If pointer cleanup
fails after the run write, the error is surfaced and the claim remains. The CLI
can inspect bounded evidence with `project coordination-review` and apply a
separately confirmed `project coordination-action`; the project page exposes
the same review and actions. Review alone never enables or changes a run.
An internal claimed-mutation callback keeps the SQLite transaction held while
short run mutations or dispatches occur, so reviewed clearing cannot race
between checking a claim and initiating a change. It is used by managed and
portable paths and must not be held for the lifetime of a harness or host task.
The portable helper's minimum Node 24.0 release emits an experimental SQLite
warning on stderr without a runtime flag. The skill now specifies
`--disable-warning=ExperimentalWarning` for machine-readable errors, which also
suppresses other experimental warnings. Node 24.0 portable and claim tests have
passed with that invocation. The control integration suite, including workspace
evaluation, also passes under Node 24.0; subprocesses without the warning flag
can still emit SQLite experimental warnings. This is not live harness
verification.
One combined browser run timed out waiting for a duplicated chain to appear
after choosing another harness; fourteen isolated reruns passed. The cause was not
established, so the combined-journey failure remains an open verification issue.
Cross-harness duplication now creates the requested copy in one server mutation
instead of creating it and then issuing a separate update. A changed-harness
copy deliberately omits the native agent; a same-harness copy preserves it.
This removes a partial-copy failure window but is not proof of the earlier
browser timeout's cause. UI duplicate actions also bind the source revision;
the service serializes participating source mutations during copying and rejects
stale revisions. The HTTP duplicate endpoint still accepts a request without
that precondition for compatibility with existing clients.

Create the claim before managed run creation or portable package installation.
When the operation succeeds, its record identifies the same claim; when it fails,
release the claim only after all side effects and owned processes are confirmed
cleaned up. Write a terminal record and finish process cleanup before releasing
the claim. A crash between those operations leaves the claim in place rather
than inferring success from a missing pointer or terminal record. Startup
recovery must not mutate a claimed run automatically; explicit reconciliation
must identify the claim, show the affected records, and require the operator to
confirm that earlier work and processes have stopped before clearing it. The
same reviewed reconciliation must be available to UI and CLI clients.

Existing active records without a claim are ambiguous and require explicit
legacy adoption or reconciliation under the same project transaction; they
cannot be silently treated as safe. Older helpers and services do not acquire
this claim and therefore cannot be protected by it. The migration and user
guidance must require those versions to be stopped or replaced before enabling
the protocol. External editors and detached or escaped descendants are not
covered by a project claim. This is a proposed design, not an implemented
guarantee.

## Acceptance and verification

- **Compatibility:** Existing CLI launch/help/flags, loopback UI, saved config/chains/runs and v1/v2 bundle reads work unchanged; corrupt/unsupported documents surface typed errors without overwriting user data. Packaging contains the right executable and updated mirrored skills.
- **Concurrency and lifecycle:** Real multi-process tests race UI/service/CLI starts, config updates and run claims; exactly one owner and one managed active run, no lost updates, no false interruption of a live run, correct stale-lock/crash recovery, no orphan PTY/child, safe stop, and no automatic replay. Verify one terminal subscriber across interfaces.
- **Scale and safety:** Refresh a generated pinned Git source with at least 1,000 skills and 20,000 package files under the configured higher budget; enumerate all identities through pagination and select/package a subset. Measure bounded memory/staging and verify every configured dimension just below/at/above its threshold, timeout, cancellation, malicious tree entries, duplicate names and old snapshots after lowering limits. Oversized artifacts fail with no partial publication and prior snapshot remains readable.
- **End-to-end, both modes:** From an isolated config and local Git fixture, configure/refresh/list/review, create chain and bundle, statically validate, explicitly approve a live managed test, inspect retained output, review/import into a separate project, run supervised and automatic with fake harnesses, interrupt/recover, and clean only owned workspaces. Repeat portable in-session inspect/prepare/step/record/resume with a fake host and exercise v2 native-agent block. Verify UI-created chains operate via CLI and CLI-created chains are visible in UI.
- **Safety and consent:** Tests cover prompt-injection content, revoked/stale approvals and changed fingerprints, redaction, invalid paths/symlinks, package conflicts, unattended missing consent, no secrets in argv/config/diagnostics, no script execution during discovery, live-test permission boundaries, and source/destination race conditions.
- **Harnesses:** Run focused unit/integration suites for CLI, catalog, config, bundles, portable runtime, workspaces, PTY, run lifecycle and adapters; package smoke, typecheck, documentation gate and relevant Playwright UI journeys. Run approved isolated live harness probes for supported OpenCode and Copilot versions when available, record privacy-safe evidence; if unavailable or a signal remains unverified, leave the affected capability blocked or explicitly marked unverified, not reported as complete.

## Risks and considerations

- Service ownership and authentication are a prerequisite, not a convenience: existing in-process queues cannot protect simultaneous processes. Recovery must happen only after ownership is established.
- CLI-driven approvals express a caller's intent; they cannot establish human identity or provide sandboxing. Existing host and harness permissions remain authoritative.
- Large source snapshots can exhaust disk or network even if bundles stay small; configure finite budgets, implement effective enforcement for actual Git behavior, and document operational trade-offs.
- A skill is model-invoked context and its invocation may be unobservable. Process exit, an agent's own report and objective artifact checks convey different evidence.
- The proposed local evaluation checks are explicitly chosen by the user and cannot guarantee outcome correctness. No implicit execution of remote content.
