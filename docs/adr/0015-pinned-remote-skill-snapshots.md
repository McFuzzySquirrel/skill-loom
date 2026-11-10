---
id: ADR-0015
applies_to:
  - "src/server/catalog/remote.ts"
  - "src/server/catalog/merge.ts"
  - "src/server/catalog/skill-resolution.ts"
  - "src/server/chains/model.ts"
  - "src/server/preflight/engine.ts"
  - "src/server/chains/bundle.ts"
  - "src/web/api/chains.ts"
  - "src/web/hooks/useChainDraft.ts"
  - "src/web/components/StepEditor.tsx"
  - "tests/unit/catalog-remote.test.ts"
  - "tests/unit/chain-model.test.ts"
  - "tests/unit/preflight-engine.test.ts"
status: Accepted
---

# ADR-0015: Ingest remote skills as pinned immutable snapshots

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-07

**Technical Story:** Let users catalog skills from Git repositories without making mutable branches or repository-controlled execution part of the project workflow.

## Agent Rules

- **MUST:** Access a registered Git repository only after an explicit refresh action.
- **MUST:** Resolve each refresh to a commit and persist a separate snapshot for that revision; refreshing later must not rewrite earlier snapshots.
- **MUST:** Use shell-free Git invocation with validated HTTPS/SSH remotes and refs; never accept credentials embedded in remote URLs or persist Git credentials.
- **MUST:** Avoid checking out repository files, executing repository scripts, initializing submodules, or following package symlinks.
- **MUST:** Retain only validated regular files belonging to discovered skill packages, subject to explicit command, time, staging, file-count, package-count, and content-size limits.
- **MUST:** Surface authentication, network, invalid-package, and resource-limit failures as errors rather than an empty catalog.
- **MUST:** Preserve retained snapshots when a source registration is removed; removing a source must not invalidate previously saved content.
- **MUST:** Persist the source id, commit revision, and repository-relative package path on a chain step when the user selects a remote skill snapshot.
- **MUST:** Resolve a bound step to that exact retained snapshot for preflight and export; never silently substitute a same-named project package or refreshed revision.
- **MUST:** Keep legacy name-only resolution compatible, but block preflight and export when it cannot identify one package under [ADR-0013](0013-deterministic-chain-bundle-skill-resolution.md).
- **MUST:** Treat remote skill instructions as untrusted content that requires user review before use.

## Verify

- **Check:** `npx vitest run tests/unit/catalog-remote.test.ts tests/unit/catalog-merge.test.ts tests/unit/chain-model.test.ts tests/unit/preflight-engine.test.ts tests/web/runs-api.test.ts tests/integration/catalog-routes.test.ts tests/integration/chain-bundles.test.ts`
- **Expected:** Refresh stores a pinned package snapshot and cleans staging, tampered snapshots fail verification, unsafe packages and excessive package sets are rejected, both harness catalogs can inspect/copy a saved package without network access, and bound chains preflight/export the selected snapshot.

## Context and Problem Statement

The project catalog previously discovered local and harness-reported skill packages only. Users need an explicit way to source skills from Git repositories, but relying on a moving branch or checking out and running remote repository contents would create mutable identity and execution risks.

## Decision Drivers

- Make each discovered package reproducible at a concrete repository revision.
- Keep repository network access explicit and separate from catalog browsing.
- Avoid running repository-controlled code while ingesting skills.
- Bound staging and retained package resources and preserve useful error reporting.
- Keep previously ingested content usable offline after refresh or source removal.

## Considered Options

- Add a remote URL directly to each chain and resolve it whenever the chain runs.
- Keep a live clone and expose its current branch contents to the catalog.
- Resolve each explicit refresh to a commit, retain a validated local snapshot, and refer to that snapshot in the catalog.

## Decision Outcome

Chosen option: "Resolve each explicit refresh to a commit and retain a validated local snapshot", because this separates user-authorized network access from catalog reads and ensures refreshes cannot silently rewrite already-ingested package bytes.

Refresh uses a depth-one clone without checkout or a blobless filter. A
blobless clone followed by sequential blob reads caused one lazy remote fetch
per missing package file; including blobs in the initial shallow transfer
avoids those repeated network round trips. This may transfer unrelated blobs
from the fetched revision, so staging size/entry limits, monitoring and
cancellation remain mandatory. Snapshot content limits and validation are
unchanged. A regression using a filter-capable Git remote verifies that a
13-file package needs one upload-pack transfer rather than fourteen.

### Positive Consequences

- Catalog browsing and package copy can use retained snapshots without contacting the remote repository.
- A refresh records the exact commit and package fingerprint rather than relying on a branch name.
- Chains preserve the selected remote snapshot identity, so later refreshes and same-name packages cannot change which package preflight or export uses.
- Ingestion reads Git tree/blob data without checking out or running repository scripts.

### Negative Consequences

- Retained snapshots consume local storage until a future reference-aware cleanup feature is available.
- Authentication, host-key, and network failures require explicit user resolution and refresh retry.
- The bounded staging monitor is an operational resource guard, not an operating-system disk quota or a security sandbox.
- Remote packages can contain harmful instructions even though ingestion does not execute them; users must review package contents and permission implications.

## Links

- Related: [ADR-0002](0002-harness-capability-descriptors.md), [ADR-0012](0012-shared-project-skill-installation-root.md), and [ADR-0013](0013-deterministic-chain-bundle-skill-resolution.md).
- Implemented by `src/server/catalog/remote.ts`, `src/server/catalog/merge.ts`, `src/server/catalog/skill-resolution.ts`, `src/server/routes/catalog.ts`, `src/server/chains/model.ts`, `src/server/preflight/engine.ts`, `src/server/chains/bundle.ts`, and `src/web/hooks/useChainDraft.ts`.
- Regression coverage: `tests/unit/catalog-remote.test.ts`, `tests/unit/chain-model.test.ts`, `tests/unit/preflight-engine.test.ts`, `tests/integration/catalog-routes.test.ts`, and `tests/integration/chain-bundles.test.ts`.
