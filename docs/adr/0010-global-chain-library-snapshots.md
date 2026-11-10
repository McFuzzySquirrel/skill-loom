---
id: ADR-0010
applies_to:
  - "src/server/chains/store.ts"
  - "src/server/config/schema.ts"
status: Superseded by ADR-0027 and ADR-0028
---

# ADR-0010: Store the global chain library as independent snapshots

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** The chain-library feature required reusable recipes without creating hidden links between projects.

## Agent Rules

- **MUST:** Store global templates under the Skill Loom config directory (`~/.config/loom/chains/` by default), outside every project.
- **MUST:** Copy a template into a project with a new chain id on import; the imported chain must be independent of the template.
- **MUST:** Treat a deleted template as affecting only the template file; existing project copies remain valid.
- **MUST NOT:** Make a project chain reference a global template by id at run time.

## Verify

- **Check:** `npx vitest run tests/integration/global-chains-routes.test.ts tests/integration/chains-routes.test.ts`
- **Expected:** Both suites pass, including save, list, import-with-new-id, and delete cases. Inspect `FileGlobalChainService.save`; it must build a new `Chain` document through `store.create`, not return the source object.

## Context and Problem Statement

Users want to reuse a chain across projects. A shared mutable template could change a recipe after a project has adopted it, and a project-local chain should not disappear when the library entry is deleted. What is the relationship between a template and a project chain?

## Decision Drivers

- Project chains must remain reproducible and independent.
- The library should be easy to browse and copy without a synchronization protocol.
- A template is a starting point, not a live dependency.
- Deleting from one location must not silently change another.

## Considered Options

- Independent snapshots copied on import.
- A live reference from each project chain to a template id.
- A shared mutable template edited in place.

## Decision Outcome

Chosen option: "Independent snapshots copied on import", because it keeps project recipes stable and avoids a cross-project consistency problem.

### Portable sharing extension

The local template library remains unchanged. Cross-installation sharing uses a separate versioned `.loom.json` bundle containing a saved chain and complete referenced skill package files. Bundle export does not include chain identity, timestamps, input defaults, run records, local catalog source paths, or permission consent. Bundle import creates an independent project chain, installs only new project-local packages, requires an explicit choice to reuse installed skills, and resets permission consent rather than copying the sender's opt-in. It never executes a package or starts a run.

Preview and import both validate the bundle, with bounded content and safe paths; existing package files are never overwritten and newly installed packages are rolled back if chain persistence fails. This boundary is implemented by `src/server/chains/bundle.ts` and `src/server/routes/chain-bundles.ts`; verify it with `npx vitest run tests/integration/chain-bundles.test.ts`. See the [user guide](../user-guide.md#share-a-chain-and-its-skills) for limits and review requirements.

### Positive Consequences

- Editing or deleting a template never changes an imported project chain.
- Project `.loom/chains/` remains the complete source of truth for that project.
- Copying a template is a simple file write with a new id.

### Negative Consequences

- Improvements to a template do not propagate automatically.
- Users can accumulate near-duplicate recipes.
- Importing a template copies its steps and inputs, including any broad permission opt-in, so the import step must be reviewed.

## Pros and Cons of the Options

### Independent snapshots

- Good, because it is simple, predictable, and safe for reproducibility.
- Bad, because there is no automatic update path.

### Live template reference

- Good, because a template change could update every adopter.
- Bad, because a template edit could silently change a project's next run and break reproducibility.

### Shared mutable template

- Good, because there is only one copy to edit.
- Bad, because it couples projects and makes deletion ambiguous.

## Links

- Implemented by `src/server/chains/library.ts` and `src/server/routes/global-chains.ts`.
- Related: [ADR-0005](0005-atomic-versioned-json-persistence.md) and [ADR-0004](0004-frozen-run-snapshots-and-bounded-tails.md).
- User-facing statement: [OPERATIONS.md](../OPERATIONS.md#data-locations).
