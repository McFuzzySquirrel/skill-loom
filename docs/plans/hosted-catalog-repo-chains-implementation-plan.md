# Hosted skill catalog and repo-first chains: implementation plan

**Status:** Proposed; the agreed operating choices are recorded. Product changes have not started.

**Overview:** [One-page implementation overview](hosted-catalog-repo-chains-overview.html)

**Purpose:** Plan the workflow discussed in the issue: maintain one skills catalog on the container host; let a remote repository agent discover and copy selected packages into that repo; author and run a chain from the repo; and explicitly publish a copy of that chain into the host's shared library.

**Scope boundary:** This is a plan, not an implementation. No sub-agents have been started. Sub-agent opportunities are proposals only.

**Evidence rule:** A phase is not complete until its exit gate is backed by an entry in the execution evidence register. Mark unrun checks as `not run`; do not infer a live result from an automated contract test.

## 1. Intended product contract

### 1.1 Agreed direction

- The container host owns a shared, read-only-to-Loom catalog rooted at its configured `LOOM_SKILLS_DIR`.
- The operator provisions and updates that catalog outside Skill Loom. The current Podman launcher bind-mounts the host directory read-only; it does not fetch another machine's repository.
- A client machine does not run the Skill Loom server or need a duplicate global skills catalog. It needs the small Loom workflow/bridge skill, Node.js 24+, Podman CLI, tailnet reachability, and an authorized SSH-backed Podman connection.
- The client agent can discover catalog entries through the bridge and copy selected packages into the current repository's `.agents/skills/` without sending the local repository path to the host.
- A repository-local chain document is the authoring source of truth. The user can run that chain in the active agent session from the repository and explicitly publish a copy to the hosted shared chain library.
- Publishing is one-way from repository to hosted library in the initial scope. It must detect stale hosted revisions and conflicts; it must not silently overwrite a newer copy.
- Existing chains and skills remain usable. Project-local skill copies are point-in-time copies and are not silently replaced when the host catalog changes.
- Keep the Skill Loom HTTP service loopback-bound. Remote access continues through SSH-backed Podman, which grants broad access to that Podman account, not per-command Skill Loom authorization.

### 1.2 Confirmed implementation choices

| Decision | Confirmed direction | Consequence |
| --- | --- | --- |
| Host catalog updates | Operator-controlled sync into the host-mounted catalog. | No Loom-managed fetcher or scheduled sync in the first scope; the operator guide documents the chosen manual procedure. |
| Repo chain source | Use a new explicit repo source directory, not the legacy `.loom/chains/` migration directory. | The exact directory name and file layout remain a Phase 0 contract detail. |
| Client package destination | Copy selected packages into the current repo only. | Do not install into a client-global catalog in the first scope. |
| Existing project package | Refuse to overwrite an existing destination. | Package replacement/update is outside this scope; conflict resolution remains explicit and manual. |
| Hosted chain copy | The repo is canonical; publication is repo-to-library only. | Host-only edits do not sync back. Divergence must be resolved explicitly; no pull/reconcile flow in the first scope. |
| Remote execution | Run the repo chain in the already-active session from local files. | Do not require a live Skill Loom connection for local execution or launch a nested harness. |

### 1.3 Current behavior and planned gaps

| Area | Current repository behavior | Planned addition |
| --- | --- | --- |
| Host catalog | `LOOM_SKILLS_DIR` is the single authoring source; catalog discovery rereads it on requests. | Operator runbook for mirroring, adding, updating, and troubleshooting its contents. |
| Remote connection | Packaged `skill-loom-podman` forwards commands over a configured Podman connection. | Continue this transport; add only the operations needed for repo-first authoring. |
| Remote skill transfer | `apply-local` exports skills referenced by an already-existing hosted chain. | Transfer a selected catalog package before a chain exists, for standalone use or local chain authoring. |
| Chain persistence | New chains are stored in the shared Loom library; project IDs are operation context. | A validated repo-local chain source plus explicit create/update publication to the shared library. |
| Local execution | `loom-chain-workflow` selects shared-library chains and performs steps in the active session. | Read and validate a repo-local chain and carry out its ordered steps in the active session without requiring the server. |
| Documentation | Admin and user guides cover Podman hosting and remote `apply-local`. | Dedicated hosted-catalog maintenance and repo-first authoring guides, linked from current guides. |

### 1.4 Evidence from this branch

These paths are the baseline to recheck at Phase 0; they describe current code, not acceptance of the proposed behavior.

| Evidence | What it establishes |
| --- | --- |
| `src/server/catalog/merge.ts` (`CatalogServiceOptions`, `createCatalogService`) | The catalog resolves the configured global root and re-discovers on requests. |
| `src/server/catalog/install.ts` (`exportChainSkillsForClient`, `resolveChainSkillEntries`) | Client transfer currently resolves skills from a chain and emits a bounded manifest. |
| `.github/skills/loom-chain-workflow/scripts/skill-loom-podman.mjs` (`runPodmanCli`, `isApplyLocal`, `installTransferredSkills`) | The remote helper has a special local-install branch for `chain project apply-local`; it validates transfer data and writes on the client. |
| `src/server/control.ts` (`chain.project.export/create/update`) | Hosted chain creation/update and chain-only package export are separate control operations. |
| `src/server/services.ts` (`createGlobalChainStore`) | The active shared chain store is under the Loom config directory. |
| `src/server/chains/model.ts` (`CHAIN_VERSION`, `ChainSchema`) | Chain JSON is versioned and strict; arbitrary metadata must not be added without an explicit schema decision. |
| `scripts/podman.mjs`, `Containerfile` | Podman mounts persistent config, a read-only host skills directory, and one writable project; the app binds loopback inside the pod. |
| `docs/admin-guide.md` (Podman and remote-client sections), `docs/adr/0032-*`, `docs/adr/0033-*` | Current deployment/security contract, client prerequisites, and transfer limits. |
| `tests/unit/catalog-install.test.ts`, `tests/unit/podman-cli.test.ts`, `tests/integration/control.test.ts`, `tests/unit/chain-revisions.test.ts` | Existing regression-test seams for catalog export, client transfer, control operations, and stale revisions. |

## 2. Phase dependency map

```text
P0 Contract and decisions
 ├── P1 Host catalog operations and operator guide ─────────┐
 ├── P2 Independent selected-skill transfer ──┐             │
 └── P3 Repo chain format + publish/update ─────┴── P4 local run
                                                   │
                         P1 + P2 + P3 + P4 ────────┴── P5 remote companion workflow
                                                          │
                                                    P6 integrated validation and rollout
```

P1 and P2 may proceed in parallel after P0. P3 and P4 require the data/identity contract from P0; P4 also requires the local chain format from P3. P5 joins the completed workflows. P6 is the release gate.

## 3. Implementation phases

### P0 — Confirm contracts, source of truth, and security boundaries

**Dependencies:** None.

**Goal:** Resolve decisions that affect chain persistence, safe transfer, and remote operations before implementation. Record durable choices in an ADR before changing the contract.

**Checklist:**

- [x] Use a new explicit repo source directory rather than the legacy `.loom/chains/` migration directory.
- [ ] Choose the exact directory name and file layout; verify it cannot be confused with legacy migration or project-local run data.
- [ ] Define how the repo's canonical chain gets a stable ID and timestamps, and how its hosted counterpart is matched to it.
- [ ] Define publication semantics: create, update, conflict, and deliberate republish after a remote edit. Use revision preconditions; do not silently overwrite.
- [ ] Decide where the last-published revision lives. The current chain schema is strict; do not add an unversioned field to chain JSON.
- [ ] Select the client export identity contract. Prefer an exact catalog identity over an ambiguous display name; verify available stable identifiers and behavior when the source path changes.
- [x] Limit standalone skill copies to project `.agents/skills/`; do not install into a client-global personal directory in this scope.
- [x] Refuse to overwrite existing project packages. A package replacement/update operation is out of scope and requires a separate explicit decision.
- [x] Use operator-controlled host catalog sync. Skill Loom itself does not fetch the source repository; a scheduled sync is not included.
- [x] Preserve the trusted SSH-backed Podman boundary; do not expose a web/API port to the tailnet or add a new login system.
- [x] Keep local chain execution as active-session prompt orchestration only; do not launch a nested harness.
- [x] Record non-goals: multi-user server, public ingress, automatic repository fetching by Loom, automatic project-package replacement, and bidirectional chain sync.

**Exit gate:** Approved contract/ADR names the local file shape and path, publish identity/revision rules, client copy scope, collision behavior, and host catalog sync responsibility. Operator/manual sync, a new repo directory, repo-only copies, no-overwrite, repo-canonical publishing, and local active-session execution are confirmed; unresolved format details remain blockers for dependent phases.

**Sub-agent opportunities (not started):**

- `platform-engineer`: independently review the deployment/security contract and ADR fit; own no product edits until the decisions are accepted.
- `backend-engineer`: map candidate control-operation boundaries and chain-store behavior; return evidence only, not a second API design.
- `support-lead`: reconcile user/operator workflow language and identify which decisions require the product owner.

### P1 — Make host catalog provisioning and maintenance operable

**Dependencies:** P0 host-source and update policy. May run in parallel with P2.

**Goal:** Let an operator reliably populate and update the container's catalog from the skills repository on the other tailnet machine, without baking skills into the image or enabling client writes to the catalog.

**Checklist:**

- [ ] Specify the exact catalog root layout: configured root contains one directory per package and each package has a `SKILL.md`.
- [ ] Document the operator-controlled host-side source workflow and explicit sync. Do not invent hostnames, branch names, credentials, or timer schedules.
- [ ] Confirm whether the Podman host can read the mirrored path and whether UID/GID and SELinux labeling need platform-specific treatment.
- [ ] Keep the container mount read-only and outside the image; document that changing package files does not require rebuilding the application image.
- [ ] Verify and document when catalog discovery observes an external file change and how to diagnose stale/invalid package metadata.
- [ ] Explain the difference between updating the host catalog and replacing a project-local copy. Existing client copies remain unchanged unless an explicit update flow is separately approved.
- [ ] Document add, update, remove, backup/restore, source-sync failure, missing-package, duplicate-name, and permission troubleshooting.
- [ ] Link the operator guide from `docs/admin-guide.md`; update `README.md` only where its feature/guide links need to reflect the new workflow.

**Exit gate:** An operator who did not implement the feature can follow the guide on the target host to add a package, see it in a catalog query, update it, and restore the previous source state without writing into the image or exposing the service.

**Sub-agent opportunities (not started):**

- `platform-engineer`: own Containerfile/Podman mount validation and the operator guide, separate from API work.
- `integration-engineer`: validate Linux mount/read-only behavior and produce a reproducible host-side smoke procedure; do not assume macOS/Windows Podman Machine behavior is verified.

### P2 — Export chosen catalog skills to a remote project before a chain exists

**Dependencies:** P0 selection identity, destination scope, and conflict policy. May run in parallel with P1.

**Goal:** Enable the remote agent to copy only the packages it selected into the current repo, even before creating a chain, and to use those packages independently.

**Checklist:**

- [ ] Add a host control operation that resolves an explicit bounded selection against the configured global catalog and returns the existing versioned transfer-manifest family or a deliberately versioned successor.
- [ ] Bind each request to the registered host project context and an exact catalog selection; never accept a client filesystem path on the host.
- [ ] Reuse the existing package walker, path validation, file-count/content limits, regular-file rules, executable-bit handling, and safe package naming where their contracts apply.
- [ ] Extend the client bridge with a dedicated local-copy path that writes only to the client-supplied absolute project path and only under `<project>/.agents/skills/`.
- [ ] Validate the complete manifest before the first write; refuse traversal, symlinks, malformed base64, duplicate destinations, unsafe names, over-limit transfers, and existing packages.
- [ ] Define failure reporting for multiple package installs, including whether prior successful packages remain and how the output reports partial success. Existing destinations remain conflicts; replacement is excluded.
- [ ] Keep remote/local path privacy: the project path stays client-side; the request contains only host project context and selected skill identities.
- [ ] Keep writes non-executing. Treat skill contents as untrusted prompt data; do not run package scripts during discovery or transfer.
- [ ] Add tests for exact selection, ambiguous/missing identity, changed catalog entry, malformed response, size limits, unsafe paths, symlink destinations, no overwrite, partial failure, and selected SSH connection use.

**Exit gate:** A client can search the hosted catalog, select one or more exact entries, copy only those packages to a disposable local repo without a chain, and prove that no path or unselected package was sent to or written by the host. All transfer and conflict cases fail safely.

**Sub-agent opportunities (not started):**

- `backend-engineer`: own control schema, catalog resolution, manifest production, and focused server tests.
- `integration-engineer`: own adversarial manifest/client-write tests and a fake-remote bridge contract test; avoid changing server catalog behavior.
- `platform-engineer`: independently inspect package/CLI inclusion and the no-shell/no-host-path boundary after the API shape is stable.

### P3 — Store repo-local chains and publish them to the shared library

**Dependencies:** P0 chain-file and publication contract. P2 is recommended before the authoring workflow, but the chain transport can be prototyped independently once the schema is decided.

**Goal:** Make the repository's chain the editable source of truth while keeping a discoverable published copy in the hosted shared library.

**Checklist:**

- [ ] Implement local chain create/read/update/validate behavior using the existing strict versioned chain model where compatible; keep writes atomic and preserve unknown-version rejection.
- [ ] Choose and document a repo path that does not accidentally cause the host's legacy `.loom/chains/` importer to duplicate or reinterpret an authored source.
- [ ] Define identity mapping between a repo chain and hosted chain, including initial publish, re-publish, rename, copy, and duplicate-name handling.
- [ ] Add a client-side publish operation that reads the local file locally and sends validated structured content through the existing SSH Podman control path. Do not send the local file path to the host.
- [ ] On first publish, create the shared record and return a stable hosted ID/revision to the client. On updates, require the last observed revision and return a conflict with enough information to reload and compare.
- [ ] Preserve the repo as canonical. Do not silently pull host edits into the repo or let the editor mutate the published copy without warning about divergence.
- [ ] Resolve how publication state is retained without adding unsupported fields to the strict chain document; use the approved sidecar or explicit republish protocol from P0.
- [ ] Validate skill references against the hosted catalog at publication or define an explicit unresolved-reference behavior. Do not claim a chain is transferable if its packages are absent or ambiguous.
- [ ] Add tests for valid/invalid local files, supported chain-version migration, stable identity, first publication, update, stale revision, duplicate ID/name, missing skill, and interrupted/failed transport.

**Exit gate:** A chain authored in a repo can be validated and published. The shared library lists and reads it. A second publish updates only the matching chain with the expected revision; stale revisions and collisions preserve both copies and explain recovery.

**Sub-agent opportunities (not started):**

- `backend-engineer`: own shared-library publish/update semantics and revision enforcement.
- `platform-engineer`: own the client-side file-to-bridge packaging contract and package smoke coverage, without altering server storage.
- `integration-engineer`: independently test create/update/conflict round-trips over the control protocol using disposable state.

### P4 — Run the repo-local chain in the active session

**Dependencies:** P0 run semantics and P3 local chain format.

**Goal:** Let the user run the repo's canonical chain directly from the repo, without depending on the container after skills and chain are present locally.

**Checklist:**

- [ ] Add a companion workflow mode that locates and parses the repo chain file, validates the supported schema, and shows the selected chain before starting.
- [ ] Resolve each skill step against the target repo's `.agents/skills/`; report missing or ambiguous skill names and stop rather than substituting a global package silently.
- [ ] Collect declared inputs, substitute only declared placeholders, and preserve the saved step order and instructions.
- [ ] Execute steps in the already-active agent session only. Do not spawn a harness, imply that the chain's harness field switches the session, or persist run inputs/outcomes.
- [ ] Retain the product truth that chain order is prompt order, not a guarantee that the host loads a named skill.
- [ ] Treat chain and package text as untrusted data and retain the host's tool-approval rules.
- [ ] Define clear behavior for interrupted sessions: re-read the chain and ask the user which step to resume; do not claim persisted recovery.
- [ ] Add skill contract/manual scenarios for successful local run, missing skill, invalid chain, missing input, changed chain during run, and interrupted run.

**Exit gate:** A remote client can disconnect from the hosted service and run a valid repo-local chain using its local `.agents/skills/`, with correct ordering and input handling; unsupported/missing states stop clearly and do not spawn another process.

**Sub-agent opportunities (not started):**

- `general`: independently review the active-session workflow instructions against P0 semantics and create scenario cases; do not edit server APIs.
- `platform-engineer`: verify canonical skill package, mirrors, and portable package generation after the workflow is approved.
- `frontend-engineer`: no work is planned because the remote flow is CLI/skill-driven; involve only if an explicit chain-editor requirement is added.

### P5 — Integrate the remote authoring workflow and ship the client helper

**Dependencies:** P1 operator contract, P2 local skill transfer, P3 repo chain publish, and P4 local run.

**Goal:** Make the complete journey discoverable from the remote agent skill without installing the server on the client.

**Checklist:**

- [ ] Decide whether to extend `.github/skills/loom-chain-workflow`, extend `scenario-discovery`, or add a new canonical companion skill. Avoid duplicating two workflows with conflicting source-of-truth rules.
- [ ] Provide one guided path: select a host connection and project context; search the remote catalog; copy chosen skills; inspect and compose a scenario in the local repo; save/validate the repo chain; run locally; optionally publish/update the shared copy.
- [ ] Provide a separate standalone-skill path that copies selected packages without requiring chain creation.
- [ ] Make publishing optional and explicit; show the target library, chain name/ID, revision, and conflict result before accepting the mutation.
- [ ] Keep the existing shared-library workflow and chain-based `apply-local` command backwards compatible unless a migration is separately approved.
- [ ] Build portable skill artifacts and synchronize only canonical `.github/skills/**` sources to their prescribed mirrors. Run `npm run build:portable-skill` and inspect generated diffs.
- [ ] Add or update skill-level/manual tests for local versus remote mode selection and refusal to silently fall back to local Podman when a remote connection fails.

**Exit gate:** A client with no Skill Loom server or catalog installed can complete the stated workflow through its small companion skill/helper and SSH Podman connection. Existing commands retain their documented behavior.

**Sub-agent opportunities (not started):**

- `platform-engineer`: own canonical-skill build/mirror integrity and package smoke test.
- `integration-engineer`: own a real-client checklist and evidence schema; do not run live probes without a real tailnet host and authorized credentials.
- `support-lead`: review the end-to-end user journey and classify any remaining gaps as supported, deferred, or blocked.

### P6 — Documentation, acceptance, rollout, and release evidence

**Dependencies:** P1–P5 implementation contracts and test evidence.

**Goal:** Make user, operator, and support instructions agree with shipped behavior; release only after the accepted workflow is demonstrated.

**Checklist:**

- [ ] Add a hosted catalog maintenance guide covering source layout, initial population, update/sync, removal, backup, access control, and troubleshooting.
- [ ] Add a repo-first remote authoring guide covering client prerequisites, Podman SSH connection, catalog search, selected skill transfer, local chain file, local execution, publication, revision conflicts, and recovery.
- [ ] Update `docs/admin-guide.md`, `docs/user-guide.md`, `docs/standalone-skill-guide.md`, `README.md`, and `docs/current-gaps.md` where behavior or claims change.
- [ ] Update the canonical companion skill before mirrors; run the portable-skill build and integrity checks.
- [ ] Add an ADR for durable catalog/publish/local-run rules and index it in `docs/adr/README.md` if the new contract changes existing policy.
- [ ] Add a changelog entry only when user-visible behavior ships; keep release-gate evidence truthful and mark unrun live tests as unrun.
- [ ] Back up the Podman config volume and source repo before the pilot. Do not rewrite or migrate existing shared chains during rollout.
- [ ] Pilot one source repo, one container host, one trusted tailnet client, one standalone skill copy, one local chain run, and one create/update publish cycle.
- [ ] Verify rollback: stop the pod without deleting its config volume; revert the client package if needed; retain repo-local chain files; do not silently delete published records.

**Exit gate:** Documentation passes the docs integrity gate; the complete remote journey passes automated tests and the approved real-host pilot; rollback and support steps are recorded. Release notes distinguish automated contract tests from live second-machine evidence.

**Sub-agent opportunities (not started):**

- `platform-engineer`: own documentation consistency, release gates, and final cross-cutting checks.
- `integration-engineer`: execute the approved live Podman-over-tailnet pilot and report only observed evidence.
- `support-lead`: conduct an operator/user read-through and sign off on rollout and recovery clarity.

## 4. Acceptance criteria

| ID | Acceptance criterion | Primary evidence |
| --- | --- | --- |
| AC-01 | Operator can provision and update the host catalog from the selected source repo without putting packages in the image or granting clients catalog-write access. | Operator guide; Podman mount plan; host smoke test. |
| AC-02 | A new/updated host package appears in catalog discovery after the documented sync/refresh action. | Catalog unit/integration test and host pilot. |
| AC-03 | Client can select and copy a skill before creating a chain; copied files land only in the local repo's `.agents/skills/`. | Manifest/control tests; bridge tests; disposable repo test. |
| AC-04 | Client transfer validates the full payload before writes, rejects unsafe paths/symlinks/oversize/duplicate entries, preserves executability where supported, and refuses existing package destinations. | Adversarial unit tests and exact failure assertions. |
| AC-05 | The remote project path never enters the host request; transfer is limited to selected packages and existing documented bounds unless a new bound is approved. | Captured control payload test and bridge tests. |
| AC-06 | User can author and validate a repo-local chain and run it in the active session without a Skill Loom server connection. | Companion-skill scenarios and manual target-harness check. |
| AC-07 | Repo-local execution resolves skills from that repo, asks for required inputs, follows saved order, and does not claim named skills must fire. | Skill contract tests/read-through and acceptance run. |
| AC-08 | Explicit publish creates a hosted copy; explicit update requires the expected revision; conflict, duplicate, unavailable package, and transport failure preserve both sources. | Control/chain revision tests and remote round-trip. |
| AC-09 | Client requires no Skill Loom server or mirrored global catalog; configured Podman SSH selection never silently falls back to local Podman. | Package smoke test and bridge test. |
| AC-10 | The application remains loopback-bound; remote access uses the trusted Podman/SSH boundary and no new anonymous HTTP ingress. | `npm run podman:plan`, security regression tests, deployment review. |
| AC-11 | Existing chain-based `apply-local`, shared library records, and legacy chain migration remain compatible or have an explicit, reviewed migration. | Regression suite and migration-specific tests. |
| AC-12 | Both guides accurately explain catalog updates, local copy staleness, repo/library divergence, backup, and recovery. | Docs integrity gate and operator/user read-through. |

## 5. Risks and mitigations

| Risk | Mitigation / gate |
| --- | --- |
| Repo and published chain diverge. | Repo is canonical; publication is explicit and revision-checked. Document that host edits do not flow back automatically. |
| A remote skill name resolves to a different or ambiguous package. | Use exact catalog identities for selection and verify unique skill-name resolution for chain references. Decide rename/update policy in P0. |
| Host package changes while a client is copying. | Bind transfer to a revalidated catalog entry; return bounded manifest data; client validates all content before writing. Decide whether a fingerprint or equivalent snapshot check is needed without violating existing catalog policy. |
| Existing repo skills are overwritten or partially changed. | Preserve no-overwrite behavior; validate full transfer first; report partial installs precisely. Any update/replace feature needs a separate explicit decision and tests. |
| Malicious skill or chain instructions influence the agent. | Treat content as untrusted prompt data; do not execute package files; preserve active host approval controls. |
| Tailnet is mistaken for narrow application authorization. | Keep direct HTTP closed; document Podman account-wide authority and restrict SSH to trusted users. |
| Source repo sync is stale, unavailable, or has bad permissions. | Operator-controlled sync, visible last-sync/revision evidence, read-only mount, troubleshooting and rollback procedure. Exact mechanism is a P0 decision. |
| Local chain format collides with legacy `.loom/chains` import. | Choose a path deliberately; add tests proving no accidental import/duplication; never overwrite a local source during migration. |
| Podman Machine mount behavior differs by OS. | Verify the actual target host. Do not extrapolate Linux build results to macOS/Windows; retain known-gap status until run. |
| Package versions differ between repo copy and host catalog. | Copies are point-in-time; document refresh/replacement semantics. Do not silently rewrite project packages or claim chains pin package contents unless implemented. |
| Limits or partial-copy semantics are unclear. | Reuse current transfer bounds and failure reporting until a specific approved change; test aggregate limits before writing. |

## 6. Migration and rollout

1. **No automatic data migration in the first release.** Existing shared chain records remain untouched; new repo-local sources use the new explicit directory approved in P0.
2. **Preserve current commands.** Existing host-project `chain project apply` and remote `chain project apply-local` remain available. New standalone copy and local publish paths are additive.
3. **Do not treat legacy migration as sync.** Valid `<project>/.loom/chains/*.json` files are currently copied to the shared library on first access and retained; that one-time behavior is not a two-way repository publishing protocol.
4. **Back up before the pilot.** Export the `skill-loom-config` volume and use normal version control for the source skills repo and target repo.
5. **Pilot one trusted path.** Start with one catalog source, one host container, and one remote client. Verify skill discovery, copy, local run, first publish, update, stale-revision conflict, and rollback.
6. **Expand only after live evidence.** Automated bridge tests do not prove a real second-machine SSH/Podman connection. Record OS, Podman version, connection method, and observed outcomes in the release evidence.
7. **Rollback without data loss.** Stop the pod and retain its volume. Revert client helper/skill artifacts through the documented install method. Keep repo chain files; reconcile or remove hosted records only through revision-checked user action.

## 7. Validation matrix

### Automated gates

- Focused catalog and manifest tests: `tests/unit/catalog-install.test.ts` plus new selected-skill export tests.
- Focused bridge tests: `tests/unit/podman-cli.test.ts` plus new local-copy and publish/update cases.
- Chain contract/revision tests: `tests/unit/chain-model.test.ts`, `tests/unit/chain-revisions.test.ts`, `tests/integration/chains-routes.test.ts`, and `tests/integration/control.test.ts` as relevant.
- Container/deployment plan: `npm run podman:plan`; Linux image build on the target engine.
- Portable companion skills: `npm run build:portable-skill`, inspect canonical/mirror/generated diffs, and run `npm run test:package` for packaging changes.
- Repository gates before completion: `npm run check`, `npm run typecheck`, `npm test`, and `git diff --check`.

### Live and manual gates

- Real second-machine connection over the intended tailnet SSH identity; do not substitute a local fake for this release claim.
- Confirm the authorized account can reach the Podman service and that an unauthorized identity cannot.
- Update the host-mounted catalog and observe the package in remote discovery without rebuilding the image.
- Copy one standalone package and one chain package set to disposable repos; inspect that no existing packages changed.
- Run a repo-local chain in the active supported host session, then disconnect from the hosted service and repeat if offline/local independence is an acceptance claim.
- Publish create/update and force a stale-revision conflict; confirm the local canonical file and hosted copy both remain recoverable.
- Record unrun OS, Podman Machine, or harness combinations as unverified. Run live harness verification only with real CLIs and credentials.

## 8. Execution evidence register

Update this section as work proceeds. Keep evidence concise but independently checkable; link larger test reports or live-probe JSON instead of pasting sensitive output. A failed or blocked attempt stays in the record when it changes the plan or exit decision.

### Evidence entry requirements

For each meaningful run, record:

- evidence ID, phase, and acceptance criteria covered;
- status: `passed`, `failed`, `blocked`, or `not run`;
- date/time and commit, or state that the worktree was uncommitted;
- relevant environment and tool versions for host-dependent checks;
- exact command or manual scenario, observed outcome, and artifact/evidence path;
- follow-up or reason for any unrun gate.

Do not record credentials, private keys, tokens, or unnecessary tailnet hostnames/IPs. Redact private paths and package contents from retained output. The operator must not claim second-machine, OS, or harness coverage unless that exact environment was exercised.

### Phase status

| Phase | Status | Acceptance criteria | Evidence / next action |
| --- | --- | --- | --- |
| P0 — Contract | Partially confirmed; exit gate open | All | Operator sync, new explicit repo directory, repo-only/no-overwrite copies, repo-canonical publishing, and active-session local run are recorded above. Resolve remaining Phase 0 questions before dependent implementation. |
| P1 — Host catalog operations | Not started | AC-01, AC-02, AC-10, AC-12 | Not run. |
| P2 — Selected-skill transfer | Not started | AC-03, AC-04, AC-05, AC-09, AC-10 | Not run. |
| P3 — Repo chain and publish | Not started | AC-08, AC-11 | Not run. |
| P4 — Local execution | Not started | AC-06, AC-07 | Not run. |
| P5 — Remote workflow | Not started | AC-03, AC-06, AC-07, AC-08, AC-09 | Not run. |
| P6 — Docs and rollout | Not started | AC-01–AC-12 | Product validation not run. |

### Evidence recorded while creating this plan

| ID | Date / commit | Phase / AC | Status | Environment and exact action | Result / evidence | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| PLAN-DOC-01 | 2026-11-13T22:38+02:00; uncommitted | Planning docs; no product AC | Passed | Node v26.13.0, npm 11.20.0; `npm run check`; `git diff --check`. | Both passed. | No product tests were run; implementation phases remain not started. |
| PLAN-PAGE-01 | 2026-11-13T22:37:54+02:00; uncommitted | P6 planning artifact; no product AC | Automated checks passed; browser check not run | `node /home/mcsquirrel/.agents/skills/archify/bin/archify.mjs finalize explainer ... --repo-root /home/mcsquirrel/projects/personal/skill-loom --json`. | Validate, deliver, and check passed; no diagnostics. Finalizer HTML SHA-256 `18b15f9a804fdba85a5edba2076a084eb4a022f79d6969e861fe061b0f5b3b1f`. Local receipt: `.archify/explainer-hosted-catalog-repo-chains-20261113-222411/hosted-catalog-repo-chains.finalize-summary.json`. | Browser check and visual review not run. |
| PLAN-PAGE-02 | 2026-11-13T22:38+02:00; uncommitted | P6 tracked overview; no product AC | Passed; provenance unknown | Removed generated trailing whitespace from the tracked copy only; ran `node /home/mcsquirrel/.agents/skills/archify/bin/archify.mjs check docs/plans/hosted-catalog-repo-chains-overview.html --json`. | Structural, dependency, and native-diagram checks passed. Tracked HTML SHA-256 `e1ba595873a480f259ec3175a82c88faf6a40d79f159eed540502ae011a7ed33`. | Whitespace-only change to the finalized HTML; original finalizer artifact and receipt remain in `.archify/`. |

### Entry template for implementation runs

| ID | Phase / AC | Status | Date / commit | Environment | Command or scenario | Result / evidence path | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `E-<n>` | `P<n>` / `AC-xx` | `not run` | — | — | — | — | — |

## 9. Questions requiring confirmation before dependent implementation

These are intentionally unresolved; the phases must not guess.

1. **Exact local chain directory and format:** Which explicit repo path should hold the source chain? It must not be `.loom/chains/`, which has a legacy-import role.
2. **Publish metadata:** Should the repo store hosted chain ID/revision in a versioned sidecar, or should users supply/resolve that mapping during each publish?
3. **Target platform:** Which OS and Podman environment is the first live host target? The repo's current evidence does not establish real second-machine interoperability or all Podman Machine mount behavior.
4. **Selection identity:** Which exact catalog identity should the client transfer request carry? Confirm stability and behavior when a package path or name changes.

## 10. Delegation policy for execution

The role suggestions above are bounded opportunities, not work already assigned. If parallel work is approved later, keep ownership non-overlapping: backend owns server/control contracts; platform owns deployment, packaging, and operator documentation; integration owns end-to-end evidence; support-lead owns cross-phase decisions and rollout review. The initiating agent must integrate all work and run the complete repository gates. No agent should edit another owner's files without an explicit handoff.
