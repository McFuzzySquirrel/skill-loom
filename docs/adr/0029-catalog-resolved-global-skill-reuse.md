---
id: ADR-0029
applies_to:
  - "src/portable/**"
  - ".github/skills/loom-run-bundle/**"
  - "skill/loom-run-bundle/**"
  - "tests/unit/portable-runtime.test.ts"
status: Accepted
---

# ADR-0029: Reuse catalog-resolved host-global skill packages in portable runs

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-11

**Technical Story:** A recipient host often already exposes a skill package globally. Copying the bundle's identical package into every project duplicates content and may not be the package the host actually loads.

## Agent Rules

- **MUST:** Resolve a reusable global package from the current host's skill catalog and pass its canonical absolute package directory as `globalSkillPaths`; never guess or construct a global path.
- **MUST:** Accept a `globalSkillPaths` entry only when its name is included in the bundle, its path is unique and canonical, and the directory contains a regular, non-symlink `SKILL.md` whose name matches.
- **MUST:** Require the same skill name in `reuseSkills`, and require `differingReuseConfirmed: true` when the selected global package differs from the bundled package contents.
- **MUST:** Fingerprint the selected package during `inspect`, bind its path and fingerprint into `reviewDigest`, re-verify both at `prepare`, and re-fingerprint before every `step`.
- **MUST:** Block a changed global package with `PACKAGE_CHANGED`; do not silently continue or recopy over it.
- **MUST NOT:** Copy a reused global package into `<project>/.agents/skills/`, overwrite it, execute its scripts, or accept a path outside the catalog-resolved selection.
- **SHOULD:** Record `source: "global"` and the reviewed absolute path in the run's installed-skill entries so `status` and troubleshooting show which package was used.

## Verify

- **Check:** `npx vitest run tests/unit/portable-runtime.test.ts`

- **Expected:** A selected global package is referenced without a project copy, `step` returns its path, a later content change fails with `PACKAGE_CHANGED`, differing contents require `REUSE_CONTENT_CONFIRMATION_REQUIRED`, and a skill named `__proto__` is handled safely.

## Context and Problem Statement

A portable bundle carries the complete package for every referenced skill. The recipient's host may already expose an equivalent package at a host-global location. Should the portable runner copy the bundled package into the project, reuse the host's package, or accept any path the operator supplies?

## Decision Drivers

- Avoid duplicating large or frequently updated skill packages across projects.
- Execute against the package the current host can actually discover.
- Keep the reviewed bytes boundary intact: a global package is untrusted content that can change after review.
- Avoid turning an arbitrary filesystem path into executable prompt context.
- Keep one portable run record sufficient; no new coordination store is needed.

## Considered Options

- Always install the bundled package into `<project>/.agents/skills/`, even when the host already has an identical global package.
- Reuse any installed package the operator names, including paths outside the host catalog.
- Reuse only a catalog-resolved global package, with explicit selection, name matching, canonical-path checks, review-digest binding, and per-step fingerprint verification; otherwise install a project-local copy.

## Decision Outcome

Chosen option: "Reuse only a catalog-resolved global package under explicit review and fingerprint checks", because it removes duplicate installs while keeping the reviewed content boundary and the host's own discovery authority.

### Positive Consequences

- An identical host-global package is referenced in place instead of being copied into the project.
- The run uses the same package directory the host catalog reports, reducing drift between review and execution.
- The review digest and per-step fingerprint check detect edits after approval.
- Omitted global selection keeps the existing install-into-project behavior.

### Negative Consequences

- A run record stores a machine-local absolute path, so the run is not relocatable and does not transfer to another machine.
- Any edit to the global package blocks the next step until the operator re-inspects and prepares a new run.
- Global reuse depends on the host's catalog reporting the package; Loom does not scan additional locations to compensate.
- The operator must still review the full global package inventory, not just the bundled copy.

## Pros and Cons of the Options

### Always install into the project

- Good, because the run is independent of later host-global changes and easier to relocate within the project.
- Bad, because identical packages are duplicated per project and may diverge from the package the host loads.

### Reuse any named installed package

- Good, because it is simple and works when a host catalog is unavailable.
- Bad, because it accepts paths the host does not actually discover and weakens the reviewed-content boundary.

### Reuse only a catalog-resolved, fingerprint-bound package

- Good, because it keeps host discovery authoritative, makes reuse explicit, and detects post-review changes.
- Bad, because it requires an extra inspect pass with `--stdin-json`, records an absolute path, and cannot survive package movement.

## Links

- Related: [ADR-0013](0013-deterministic-chain-bundle-skill-resolution.md), [ADR-0014](0014-portable-agent-skill-execution.md), [ADR-0012](0012-shared-project-skill-installation-root.md).
- Implemented by `src/portable/runtime.ts`, `src/portable/cli.ts`, `src/portable/run-schema.ts`, and the `loom-run-bundle` skill.
- Documented in [Standalone skill guide](../standalone-skill-guide.md#3-prepare).
