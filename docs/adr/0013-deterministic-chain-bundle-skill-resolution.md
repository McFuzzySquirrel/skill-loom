---
id: ADR-0013
applies_to:
  - "src/server/catalog/skill-resolution.ts"
  - "src/server/chains/model.ts"
  - "src/server/preflight/engine.ts"
  - "src/server/chains/bundle.ts"
  - "src/web/hooks/useChainDraft.ts"
  - "tests/unit/chain-model.test.ts"
  - "tests/unit/preflight-engine.test.ts"
status: Accepted
---

# ADR-0013: Resolve bundle skills with project-local precedence

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-05

**Technical Story:** Resolve the exact remote package selected by a chain while retaining deterministic project-local precedence for legacy name-only chains.

## Agent Rules

- **MUST:** Resolve each chain skill from the catalog for the chain's selected harness.
- **MUST:** Resolve a skill step with a remote snapshot binding by exact source id, commit revision, and repository-relative package path; never fall back to another package with the same name.
- **MUST:** For an unbound legacy step, prefer one enabled project-local package over enabled non-project packages with the same exact name.
- **MUST NOT:** For an unbound legacy step, silently select among multiple distinct project packages or, when no project package exists, multiple distinct non-project packages.
- **MUST:** Block an unbound legacy step when multiple non-project packages match and no unique project package takes precedence.
- **MUST:** Deduplicate repeated observations only when they resolve to the same canonical package path; never deduplicate distinct packages by name alone.
- **MUST:** Use the same resolver for preflight and export so a chain cannot pass preflight against one package and export another.
- **MUST:** Treat a missing or ambiguous bound snapshot as an explicit error; do not silently substitute a project-local or newer remote package.
- **MUST:** Treat bundle-import conflicts as project-local package or destination-directory conflicts; a same-name non-project catalog entry does not block installing the exact bundled package into an empty project location.
- **MUST:** Report missing, disabled, ambiguous, and unavailable package sources as explicit preflight and export failures.

## Verify

- **Check:** `npx vitest run tests/unit/preflight-engine.test.ts tests/integration/chain-bundles.test.ts`
- **Expected:** A bound remote step resolves and exports its exact snapshot despite same-named packages, a legacy name-only step blocks when non-project packages are ambiguous, a unique project package retains precedence for unbound steps, and distinct ambiguous export sources fail with `BUNDLE_SOURCE_UNAVAILABLE`.

## Context and Problem Statement

The selected harness catalog may report multiple packages with the same name. A newly authored step can identify the remote snapshot the user selected, while older chains contain only a skill name. Requiring exactly one catalog entry rejects a usable project package, while choosing the first match or collapsing by name can export an unintended package. Which candidate should preflight and a portable chain bundle use?

On import, a non-project package with the same name is not installed in the target project's skill directory. The exact package carried by the bundle can therefore be installed without overwriting anything; the project-local copy takes precedence for the imported chain.

## Decision Drivers

- Use an explicitly selected remote snapshot when the chain records one.
- Preserve project ownership precedence for older name-only chains.
- Preserve the selected harness's enabled state and discovery boundaries.
- Avoid silently exporting arbitrary or ambiguous package contents.
- Keep repeated observations of the same physical package from causing false ambiguity.

## Considered Options

- Require exactly one enabled catalog entry across all sources.
- Select the first entry or deduplicate all entries by skill name.
- Resolve an explicitly bound remote snapshot by exact identity; for an unbound legacy step, prefer one unique project-local package, otherwise require one unique non-project package, distinguishing repeated canonical paths from distinct packages.
- Search arbitrary project directories when the selected harness catalog has no usable entry.

## Decision Outcome

Chosen option: "Honor an exact remote binding; otherwise retain unique project-local precedence and reject ambiguity", because newly authored chains must preserve the user's explicit snapshot choice while older chains keep their established project ownership behavior.

### Positive Consequences

- A same-named personal or extra-directory package no longer blocks export of a unique project package.
- A same-named non-project package does not block importing the exact bundled project package when the target has no project-local package or destination directory.
- Repeated catalog observations of the same canonical package do not create false ambiguity.
- Missing, disabled, ambiguous, and unusable sources remain explicit errors with remediation guidance.

### Negative Consequences

- Multiple distinct project packages still block export and require the project owner to resolve or rename them.
- A selected remote snapshot remains stable when another same-named project or remote package is present.
- Without a project package, multiple distinct enabled non-project packages remain ambiguous for legacy name-only chains and block preflight as well as export.
- Importing a bundled project package makes that package take precedence over a same-named personal or remote package for the target project.
- A package not reported by the selected harness catalog cannot be exported, even if it exists in a directory used by another harness.

## Pros and Cons of the Options

### Require exactly one catalog entry

- Good, because the choice is simple and never needs source precedence.
- Bad, because a valid project package is rejected when an unrelated same-named package is also available.

### Select first or deduplicate by name

- Good, because it avoids blocking export on duplicate names.
- Bad, because catalog ordering is not ownership and distinct packages can be silently conflated.

### Exact snapshot binding with legacy project precedence

- Good, because a selected remote package stays stable while legacy chains retain project-owned content precedence.
- Good, because preflight and export share the same selection logic and ambiguity behavior.
- Bad, because legacy chains without a unique project package still require users to resolve duplicate non-project packages.

### Search arbitrary directories

- Good, because it might find packages omitted by the catalog.
- Bad, because it could bypass disabled state, harness-specific discovery, and catalog warnings.

## Links

- Related: [ADR-0002](0002-harness-capability-descriptors.md), [ADR-0012](0012-shared-project-skill-installation-root.md), and [ADR-0015](0015-pinned-remote-skill-snapshots.md).
- Implemented by `src/server/catalog/skill-resolution.ts`, `src/server/preflight/engine.ts`, and `src/server/chains/bundle.ts`.
- Regression coverage: `tests/unit/preflight-engine.test.ts`, `tests/unit/chain-model.test.ts`, and `tests/integration/chain-bundles.test.ts`.
