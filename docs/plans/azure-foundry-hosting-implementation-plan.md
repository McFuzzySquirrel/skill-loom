# Azure-hosted Skill Loom (`skill-loom-foundry`): implementation plan

**Status:** Planning only. No implementation, no sub-agents started, and no Azure resources created. The target repository [`McFuzzySquirrel/skill-loom-foundry`](https://github.com/McFuzzySquirrel/skill-loom-foundry) (private) was created empty by the owner after tool-based creation failed with `403`. See [Execution evidence](#9-execution-evidence-register) entries E-001 and E-002. Q-1 to Q-9 are answered or explicitly deferred (section 1.2).

**Purpose:** Plan a separate project that hosts Skill Loom chains on Azure so Foundry agents and Copilot CLI/SDK agents can build, pull, and run chains through an authenticated API and MCP tool layer.

**Evidence rule:** A phase is not complete until its exit gate is backed by a register entry. Mark unrun checks `not run`; do not infer a live result from a unit or contract test.

**Sub-agent rule:** Sub-agent opportunities below are proposals. None have been started.

## 1. Confirmed decisions and open questions

### 1.1 Confirmed by the requester

| ID | Decision |
| --- | --- |
| D-1 | New **private** repository `McFuzzySquirrel/skill-loom-foundry`, separate from this repo. |
| D-2 | Build **both** a container host and an MCP/API tool layer. |
| D-3 | Primary clients: Foundry Agent Service (MCP or OpenAPI tool) and Copilot CLI/SDK agents (MCP), treated equally. |
| D-4 | Compute: Azure Container Apps, with Container Apps Jobs for runs. |
| D-5 | v1 tenancy: single tenant, one shared workspace. |
| D-6 | Phased execution: **serve** chains first (the calling agent executes steps in its own session); a **hosted runner** that drives a harness CLI comes later. |
| D-7 | Reuse (supersedes the earlier "published package consumed by both repos"): the cloud repo **owns its schemas as an internal module**, with no published package. Skill Loom keeps its own schemas. Compatibility is enforced only at the exported chain/bundle interchange format via pinned golden fixtures from Skill Loom. |
| D-8 | The hosted catalog is **host-managed only**; an **admin role** can add new skills (reviewed, not anonymous). No remote-repository pulls in v1. |
| D-9 | Auth: Entra ID app registration with app roles. Callers are managed identities (Foundry project, Copilot host) and user tokens. |
| D-10 | Runner harness: Copilot CLI first, OpenCode later. |
| D-11 | Dev/PoC environment: use free or lowest-cost Azure services where possible; subscription, region, naming, and cost ceiling are chosen at execution time. |

### 1.2 Open questions (status)

| ID | Question | Status | Blocks |
| --- | --- | --- | --- |
| Q-1 | Repo creation credential | **Resolved**: owner created the empty private repo | P0 |
| Q-2 | Shared package registry | **Closed**: no published package (D-7) | none |
| Q-3 | Entra tenant, app registration, caller identities | **Partly resolved** (D-9). Tenant, app registration ownership, and app-role names are chosen in P2 | P2 |
| Q-4 | Storage backend (Azure Files, Blob, or both) | **Deferred to P2 spike** (P2-C4); retention and backup also decided there | P2 |
| Q-5 | Foundry tool registration surface | **Deferred**: verify current options from official docs at P4 start | P4 |
| Q-6 | Skill sources | **Resolved** (D-8). Open detail: the admin add-skill flow, its review rules, and the admin app role, decided in P3 | P3 |
| Q-7 | Runner harness and credentials | Harness **resolved** (D-10). Credential and licensing model for Copilot CLI in jobs **deferred to P5 start** | P5 |
| Q-8 | Subscription, region, naming, cost ceiling | **Deferred to execution** (D-11) | P2 |
| Q-9 | Skill Loom adopts the package | **Resolved**: no (D-7) | none |

## 2. Codebase grounding (verified in this repo)

| Concern | Where it lives | Implication for the new project |
| --- | --- | --- |
| Loopback-only, single-user server | [ADR-0001](../adr/0001-loopback-only-single-user-server.md), `src/server/app.ts` | The server must not be exposed. The cloud service is a new service, not a reconfiguration. |
| Remote access via SSH-backed Podman | [ADR-0033](../adr/0033-podman-ssh-remote-clients.md), [ADR-0035](../adr/0035-persistent-rootless-podman-host.md) | Existing remote model is host-account access, not authentication. Azure needs real Entra auth and must not claim to replace those ADRs. |
| Shared schemas | `src/shared/chain.ts`, `bundles.ts`, `api.ts`, `remote-catalog.ts`, `project-run-records.ts` | Candidates to copy into the cloud repo's internal module (D-7). |
| Portable bundle and run logic | `src/portable/bundle.ts`, `runtime.ts`, `run-schema.ts`, `cli.ts` | Likely reuse for "serve" mode. |
| Persistence | [ADR-0005](../adr/0005-atomic-versioned-json-persistence.md), `src/server/config`, `src/server/chains`, `src/server/runs/store.ts` | Same versioned, atomic-replace rules apply; Azure Files semantics must be verified (Phase 2). |
| Harness adapters and spawn rules | `src/server/harness/*`, [ADR-0002](../adr/0002-harness-capability-descriptors.md), [ADR-0011](../adr/0011-shell-free-process-and-pty-transport.md) | Runner must spawn executable plus argument array; no shell strings. |
| Run model | `src/server/runs/*`, [ADR-0004](../adr/0004-frozen-run-snapshots-and-bounded-tails.md), [ADR-0006](../adr/0006-single-active-run-and-interrupt-recovery.md), [ADR-0007](../adr/0007-explicit-advancement-signals.md) | Single active run, snapshots, and advancement signals must be re-decided for concurrent job runs. |
| Skill semantics | [ADR-0003](../adr/0003-model-invoked-skill-prompts.md) | Chain order is prompt order; the hosted layer must not promise a skill is loaded. |
| Catalog and install review | `src/server/catalog/*`, [ADR-0029](../adr/0029-catalog-resolved-global-skill-reuse.md), [ADR-0031](../adr/0031-reviewed-skill-installation.md), [ADR-0015](../adr/0015-pinned-remote-skill-snapshots.md) | Reviewed install and pinned snapshots are the model for any remote skill pull. |
| Existing container image | `Containerfile` (Node 24, non-root, loopback) | Reference only; the Azure image needs a different bind policy. |
| Docs/ADR gates | `AGENTS.md`, `npm run check`, `docs/adr/README.md` | New repo should adopt equivalent gates. |

## 3. Phase map and dependencies

| Phase | Name | Depends on | Primary output |
| --- | --- | --- | --- |
| P0 | Repository bootstrap and decisions | none | Initialized repo, governance, ADR set |
| P1 | Internal schema module and interchange compatibility | P0 | Internal schemas, pinned-fixture contract tests |
| P2 | Azure foundation and storage | P0 | IaC, identity, storage, logging, pilot environment |
| P3 | Authenticated API (serve mode) | P1, P2 | Entra-protected API for chains, skills, bundles |
| P4 | MCP server and Foundry/Copilot integration | P3 | MCP tools, Foundry registration, Copilot config |
| P5 | Hosted runner (Jobs) | P3, P4 | Isolated run execution with run records |
| P6 | Hardening, pilot rollout, release | P4, P5 | Threat model, pilot evidence, release notes |

P1 and P2 may proceed in parallel after P0. P4 can begin once P3 has a stable OpenAPI contract. P5 is deferred until serve mode (P3/P4) passes its gates (D-6).

## 4. Phases

Conventions: checklist items carry IDs (`P1-C2`) for traceability to exit gates (`P1-G`) and acceptance criteria (section 5).

### P0: Repository bootstrap and decisions

**Goal:** Establish the new private repo and the decisions that later phases depend on.

**Checklist**
- [ ] P0-C1: Verify the owner-created empty private repo `McFuzzySquirrel/skill-loom-foundry`; enable default branch protection and push the initial skeleton.
- [ ] P0-C2: Add `AGENTS.md` invariants (auth required, no shell-string spawning, versioned atomic JSON, harness trust rules).
- [ ] P0-C3: Add README, LICENSE, CHANGELOG (`[Unreleased]`), SECURITY, and `docs/adr/` with README index.
- [ ] P0-C4: Write ADRs: hosting model, authentication, run isolation, schema ownership and interchange compatibility (D-7), relationship to Skill Loom ADR-0001/0033/0035 (state which are not inherited).
- [ ] P0-C5: Add CI skeleton (lint, typecheck, test, docs check) and PR template.
- [ ] P0-C6: Assign owners and phases for the deferred items in section 1.2 (Q-3, Q-4, Q-5, Q-7, Q-8).

**Exit gate P0-G:** Repo exists and is private; CI runs green on an empty skeleton; ADRs accepted; deferred questions in section 1.2 have owners and target phases.

**Sub-agent opportunities (proposed, not started):** one `explore` agent to inventory reusable modules and their dependency edges in this repo; one `rubber-duck` agent to review ADR drafts against the invariants.

### P1: Internal schema module and interchange compatibility

**Goal:** The cloud repo owns an internal schema module (chain, bundle, run record, catalog) and stays compatible with Skill Loom only at the exported chain/bundle format (D-7). This repo is not changed.

**Checklist**
- [ ] P1-C1: Inventory candidates in `src/shared/*` and `src/portable/*` in this repo; list non-portable dependencies (Fastify, node-pty, filesystem); record the source commit copied from.
- [ ] P1-C2: Copy and adapt pure Zod schemas and types into the cloud repo with no server, PTY, or filesystem imports; keep persisted `version` fields unchanged unless a cloud-specific ADR changes them.
- [ ] P1-C3: Pin golden fixtures (exported bundles and chains) from Skill Loom at a recorded commit; add contract tests that import them and round-trip export.
- [ ] P1-C4: Document the compatibility policy: which format versions are supported, and the process to refresh fixtures when Skill Loom changes its interchange format.

**Exit gate P1-G:** Pinned fixtures import and re-export in the cloud repo's tests; module has no server/PTY/filesystem imports; source commit and policy documented. No change is made in this repo.

**Sub-agent opportunities:** `explore` for the import-graph inventory; `general-purpose` for the copy-and-adapt work in a branch of the cloud repo; `code-review` on the diff for persisted-format drift.

### P2: Azure foundation and storage

**Goal:** Reproducible Azure environment and storage semantics.

**Checklist**
- [ ] P2-C1: Decide Q-3 details (tenant, app registration ownership, app-role names including the admin role), Q-4 (via P2-C4), and Q-8 (free or lowest-cost services first, D-11).
- [ ] P2-C2: IaC (Bicep or equivalent, confirm choice in an ADR) for Container Apps environment, registry, managed identities, Key Vault, Log Analytics, and storage.
- [ ] P2-C3: Network posture: ingress restrictions, private endpoints decision, egress policy for future runs.
- [ ] P2-C4: Spike: verify atomic-replace and concurrent-write behavior of the chosen storage backend; record results. Do not assume Azure Files matches local rename semantics.
- [ ] P2-C5: Backup/restore procedure and retention for chain and run data.
- [ ] P2-C6: Cost guardrails (budget alert) for the pilot.

**Exit gate P2-G:** Environment deploys from IaC to a clean subscription and tears down cleanly; storage spike evidence recorded; restore tested on disposable data.

**Sub-agent opportunities:** `general-purpose` to author IaC modules; `task` to run `what-if`/lint validations; `security-review` on identity and network configuration.

### P3: Authenticated API (serve mode)

**Goal:** HTTP API exposing chain, skill, and bundle operations to authorized callers; the calling agent executes steps.

**Checklist**
- [ ] P3-C1: Define the OpenAPI contract: list/get/save chains, export bundle, search/review catalog skills, admin add-skill (admin role only, reviewed; D-8), health. Reuse the P1 internal schemas.
- [ ] P3-C2: Entra token validation (issuer, audience, signature, expiry) with deny-by-default; authorization rules for single workspace (D-5).
- [ ] P3-C3: Persistence adapter honoring ADR-0005 rules on the P2 backend; optimistic revision checks to prevent silent overwrite.
- [ ] P3-C4: Skill pull follows reviewed-install and pinned-snapshot principles; size, file-count, and path-traversal limits.
- [ ] P3-C5: Request limits, structured audit logging with no secrets or skill content leakage.
- [ ] P3-C6: Container image, non-root, health probes, deployed to the P2 environment.

**Exit gate P3-G:** Contract tests pass; unauthenticated and wrong-audience requests are rejected in a deployed environment; stale-revision write is rejected; traversal and oversize tests pass.

**Sub-agent opportunities:** `general-purpose` per endpoint group; `rubber-duck` on the API contract; `security-review` on auth and skill-pull paths.

### P4: MCP server and Foundry/Copilot integration

**Goal:** Expose the P3 operations as MCP tools and register with both client types (D-3).

**Checklist**
- [ ] P4-C1: Resolve Q-5; confirm current Foundry tool-registration options and MCP transport requirements from official documentation at execution time.
- [ ] P4-C2: MCP tools mapped 1:1 to API operations, schema-derived inputs, bounded outputs.
- [ ] P4-C3: Auth flow for each client type; document identity used by Foundry vs Copilot callers.
- [ ] P4-C4: Foundry registration and a smoke agent that lists and fetches a chain.
- [ ] P4-C5: Copilot CLI/SDK MCP configuration sample and smoke test.
- [ ] P4-C6: Treat tool output as untrusted prompt context; document prompt-injection handling given ADR-0003.
- [ ] P4-C7: User and admin docs for both clients.

**Exit gate P4-G:** One Foundry agent and one Copilot agent each list, fetch, save, and export a chain against the deployed service with evidence recorded; denial case for an unauthorized identity recorded (or marked `not run`).

**Sub-agent opportunities:** `research` agent to verify current Foundry/MCP docs; `general-purpose` for tool wiring; `task` for smoke runs.

### P5: Hosted runner (Jobs)

**Goal:** Execute chains by driving a harness CLI in an isolated job (D-6). Starts only after P3-G and P4-G.

**Checklist**
- [ ] P5-C1: Decide Copilot CLI credential and licensing model for jobs (Q-7); ADR for run isolation, concurrency, and how ADR-0006 single-active-run semantics change. OpenCode support is later.
- [ ] P5-C2: Runner image with pinned harness CLI versions; spawn via executable plus argument array only.
- [ ] P5-C3: Per-run ephemeral workspace, resource and wall-clock limits, egress allow-list.
- [ ] P5-C4: Harness credential injection from Key Vault scoped per run; never logged or persisted.
- [ ] P5-C5: Run records as versioned JSON with frozen snapshots and bounded tails (ADR-0004); explicit advancement signals (ADR-0007).
- [ ] P5-C6: Start/status/cancel API and MCP tools; orphan-free cleanup on timeout and cancel.
- [ ] P5-C7: Permission and trust defaults aligned with ADR-0009; refuse to widen without explicit approval.

**Exit gate P5-G:** A multi-step chain completes in a job; cancel and timeout leave no running job or leaked workspace; run record validates against the schema; live harness result recorded, never inferred from mocks.

**Sub-agent opportunities:** `general-purpose` for runner and job orchestration; `rubber-duck` on the isolation ADR; `security-review` on credential and egress handling.

### P6: Hardening, pilot rollout, release

**Checklist**
- [ ] P6-C1: Threat model covering token theft, malicious skills, prompt injection, tenant-boundary assumptions, and cost abuse.
- [ ] P6-C2: Pilot with named users; rollback and disable procedure rehearsed.
- [ ] P6-C3: Admin guide, user guide, operations runbook, release notes with limitations and unverified items.
- [ ] P6-C4: Dependency, container, and IaC scans with findings triaged.

**Exit gate P6-G:** Pilot completed; rollback rehearsed; all gates in the register are `passed` or explicitly `accepted exception` or `not run`; release notes list unverified combinations.

**Sub-agent opportunities:** `security-review` for the full surface; `code-review` before release; `general-purpose` for documentation drafts.

## 5. Acceptance criteria

| ID | Criterion | Verified in |
| --- | --- | --- |
| AC-1 | Every API and MCP call requires a valid Entra token for the expected audience; unauthenticated requests fail. | P3-G, P4-G |
| AC-2 | A Foundry agent and a Copilot agent can each list, fetch, save, and export a chain. | P4-G |
| AC-3 | Persisted JSON is versioned, atomically replaced, and rejects stale revisions. | P2-G, P3-G |
| AC-4 | Pinned Skill Loom bundle/chain fixtures import and re-export in the cloud service with no interchange drift. | P1-G |
| AC-5 | Skill pull enforces reviewed-install limits and path safety. | P3-G |
| AC-6 | Runs spawn without shell strings, are time-bounded, cancellable, and leave no orphans. | P5-G |
| AC-7 | Secrets are never written to logs, run records, or images. | P3-G, P5-G, P6-G |
| AC-8 | The environment deploys and tears down from IaC; data restore is demonstrated. | P2-G |
| AC-9 | Docs state that chain order is prompt order and does not guarantee skill loading. | P4-G, P6-G |

## 6. Risks

| ID | Risk | Mitigation | Phase |
| --- | --- | --- | --- |
| R-1 | Exposing a tool built around local trust invites misuse. | New service with mandatory auth; do not reuse the loopback server. | P3 |
| R-2 | Azure Files may not provide the rename/locking semantics ADR-0005 relies on. | Spike and ADR before committing to a backend. | P2 |
| R-3 | Malicious or injected skill content steers agents. | Reviewed pull, size limits, untrusted-content guidance. | P3, P4 |
| R-4 | Harness credential exposure in runner jobs. | Key Vault, per-run scope, no logging. | P5 |
| R-5 | Foundry/MCP product surfaces change. | Re-verify docs at P4 start; keep the API contract independent. | P4 |
| R-6 | Copied schemas drift from the persisted/interchange format. | Pinned golden-fixture contract tests; no version changes without an ADR. | P1 |
| R-7 | Concurrent runs break single-active-run assumptions. | Dedicated ADR and tests in P5. | P5 |
| R-8 | Cost overrun from long or looping runs. | Budgets, wall-clock limits, concurrency caps. | P2, P5 |
| R-9 | Repo creation permission was unavailable to tools. | Resolved: owner created the repo (E-002). | P0 |
| R-10 | The two repos' schemas diverge and bundles stop interchanging. | Pinned golden-fixture contract tests at the interchange boundary and a documented refresh policy (D-7). | P1 |
| R-11 | Admin add-skill flow lets a malicious skill into the shared catalog. | Admin app role only, reviewed install rules per ADR-0031, size and path limits, audit log. | P3 |

## 7. Migration and rollout

- **Existing users:** No change to this repo's behavior; Skill Loom keeps its own schemas (D-7). Interchange compatibility is checked only in the cloud repo.
- **Data migration:** None initially. Chains and bundles move between environments via the existing bundle export/import, reviewed on import.
- **Rollout order:** P0 to P2 (no users) then P3 (API pilot, read-only first) then P4 (agents) then P5 (runner, opt-in per chain) then P6 (wider use).
- **Rollback:** Disable ingress or revoke app role assignments; redeploy the previous image tag; restore storage from the P2 backup. Rehearse in P6-C2.
- **Feature gating:** Runner stays disabled by default until P5-G passes.

## 8. Validation

| Layer | Check |
| --- | --- |
| Schema | Pinned-fixture import/re-export contract tests (P1) |
| API | Contract tests from OpenAPI, auth negative tests, limits tests (P3) |
| MCP | Tool schema tests and client smoke runs (P4) |
| Infra | IaC lint, `what-if`, deploy and teardown in a clean subscription (P2) |
| Runner | Live harness run, cancel, timeout, and orphan checks (P5) |
| Security | Dependency, container, and IaC scans; `security-review` (P6) |
| Repo hygiene | In this repo: `npm run check`, `npm run typecheck`, `npm test`, `git diff --check`. In the new repo: equivalent gates defined in P0-C5. |

Live checks need real Azure credentials and harness CLIs; record them as `not run` when unavailable.

## 9. Execution evidence register

Add one row per executed gate or notable event. Do not edit past rows; append corrections.

| ID | Date | Phase/Gate | Check or event | Result | Evidence link or output | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| E-001 | 2026-11-18 | P0-C1 | Create private repo `McFuzzySquirrel/skill-loom-foundry` via `gh repo create` and GitHub MCP `create_repository` | failed | `403 Resource not accessible by integration` from both | Needs a credential with repo-creation rights or manual creation (Q-1). |
| E-002 | 2026-11-18 | Planning | Requester decisions D-1 to D-7 recorded; owner created empty private repo `McFuzzySquirrel/skill-loom-foundry` | recorded | https://github.com/McFuzzySquirrel/skill-loom-foundry (owner-reported, not independently verified) | Resolves Q-1 workaround for P0-C1 pending default-branch protection. |
| E-010 | 2026-11-18 | Planning | Q-2 to Q-9 answered; D-7 revised, D-8 to D-11 added | recorded | Section 1 | Deferred items listed in section 1.2. |
| E-003 | | P0-G | not run | not run | | |
| E-004 | | P1-G | not run | not run | | |
| E-005 | | P2-G | not run | not run | | |
| E-006 | | P3-G | not run | not run | | |
| E-007 | | P4-G | not run | not run | | |
| E-008 | | P5-G | not run | not run | | |
| E-009 | | P6-G | not run | not run | | |

## 10. Traceability

| Requirement | Decisions | Phases | Acceptance | Evidence |
| --- | --- | --- | --- | --- |
| Separate private project | D-1 | P0 | none | E-001 |
| Container host with management features | D-2, D-4 | P2, P3 | AC-3, AC-8 | E-005, E-006 |
| MCP/tool layer for Foundry and Copilot | D-2, D-3 | P3, P4 | AC-1, AC-2 | E-006, E-007 |
| Agents build, pull, and run chains | D-6 | P3 to P5 | AC-2, AC-5, AC-6 | E-006 to E-008 |
| Internal schemas with interchange compatibility | D-7 | P1 | AC-4 | E-004 |
| Admin-managed host catalog | D-8 | P3 | AC-5 | E-006 |
