---
id: ADR-0013
applies_to:
  - "src/server/chains/bundle.ts"
  - "tests/integration/chain-bundles.test.ts"
status: Accepted
---

# ADR-0013: Resolve bundle skills with project-local precedence

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-05

**Technical Story:** Export saved chains reliably when the selected harness catalog includes same-named project and non-project packages, without hiding genuine ambiguity.

## Agent Rules

- **MUST:** Resolve each chain skill from the catalog for the chain's selected harness.
- **MUST:** Prefer one enabled project-local package over enabled non-project packages with the same exact name.
- **MUST NOT:** Silently select among multiple distinct project packages or, when no project package exists, multiple distinct non-project packages.
- **MUST:** Deduplicate repeated observations only when they resolve to the same canonical package path; never deduplicate distinct packages by name alone.
- **MUST:** Treat bundle-import conflicts as project-local package or destination-directory conflicts; a same-name non-project catalog entry does not block installing the exact bundled package into an empty project location.
- **MUST:** Report missing, disabled, ambiguous, and unavailable package sources as explicit export failures.

## Verify

- **Check:** `npm test -- tests/integration/chain-bundles.test.ts`
- **Expected:** A unique project package exports and imports despite same-named non-project copies, repeated observations of one canonical path are treated as one package, and distinct ambiguous sources fail with `BUNDLE_SOURCE_UNAVAILABLE`.

## Context and Problem Statement

The selected harness catalog may report both a project package and one or more personal or extra-directory packages with the same name. Requiring exactly one catalog entry rejects a usable project package, while choosing the first match or collapsing by name can export an unintended package. Which candidate should a portable chain bundle include?

On import, a non-project package with the same name is not installed in the target project's skill directory. The exact package carried by the bundle can therefore be installed without overwriting anything; the project-local copy takes precedence for the imported chain.

## Decision Drivers

- Prefer the package owned by the project being exported.
- Preserve the selected harness's enabled state and discovery boundaries.
- Avoid silently exporting arbitrary or ambiguous package contents.
- Keep repeated observations of the same physical package from causing false ambiguity.

## Considered Options

- Require exactly one enabled catalog entry across all sources.
- Select the first entry or deduplicate all entries by skill name.
- Prefer one unique project-local package, otherwise require one unique non-project package, distinguishing repeated canonical paths from distinct packages.
- Search arbitrary project directories when the selected harness catalog has no usable entry.

## Decision Outcome

Chosen option: "Prefer one unique enabled project-local package; otherwise require one unique enabled non-project package", because project-owned content is the most relevant source for a project bundle while strict ambiguity checks prevent accidental source selection.

### Positive Consequences

- A same-named personal or extra-directory package no longer blocks export of a unique project package.
- A same-named non-project package does not block importing the exact bundled project package when the target has no project-local package or destination directory.
- Repeated catalog observations of the same canonical package do not create false ambiguity.
- Missing, disabled, ambiguous, and unusable sources remain explicit errors with remediation guidance.

### Negative Consequences

- Multiple distinct project packages still block export and require the project owner to resolve or rename them.
- Without a project package, multiple distinct enabled non-project packages remain ambiguous.
- Importing a bundled project package makes that package take precedence over a same-named personal or remote package for the target project.
- A package not reported by the selected harness catalog cannot be exported, even if it exists in a directory used by another harness.

## Pros and Cons of the Options

### Require exactly one catalog entry

- Good, because the choice is simple and never needs source precedence.
- Bad, because a valid project package is rejected when an unrelated same-named package is also available.

### Select first or deduplicate by name

- Good, because it avoids blocking export on duplicate names.
- Bad, because catalog ordering is not ownership and distinct packages can be silently conflated.

### Project precedence with strict ambiguity checks

- Good, because the bundle uses project-owned content when it is unique and never hides distinct ambiguity.
- Bad, because some duplicate configurations still require manual cleanup before export.

### Search arbitrary directories

- Good, because it might find packages omitted by the catalog.
- Bad, because it could bypass disabled state, harness-specific discovery, and catalog warnings.

## Links

- Related: [ADR-0002](0002-harness-capability-descriptors.md) and [ADR-0012](0012-shared-project-skill-installation-root.md).
- Implemented by `src/server/chains/bundle.ts`.
- Regression coverage: `tests/integration/chain-bundles.test.ts`.
