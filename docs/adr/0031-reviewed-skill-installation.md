---
id: ADR-0031
applies_to:
  - "src/server/catalog/install.ts"
  - "src/server/catalog/copy.ts"
  - "src/server/control.ts"
  - "src/server/catalog/cli.ts"
  - ".github/skills/loom-skill-catalog/SKILL.md"
status: Accepted
---

# ADR-0031: Install one reviewed catalog skill through the CLI

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-11

**Technical Story:** The catalog could search local and pinned remote skills and
copy a package into a project, but after the catalog screen was removed the CLI
had no install command. `scenario-discovery` therefore told users to copy
snapshot packages into a project by hand. Adding a non-chain companion skill for
everyday skill installation requires a reviewed CLI path, not a new trust model.

## Decision Rules

- **MUST:** Expose installation as `catalog skill review` followed by
  `catalog skill install`, with a review digest and explicit confirmation per
  [ADR-0025](0025-reviewed-cli-approval-contract.md).
- **MUST:** Re-resolve the exact candidate from a fresh server-side catalog pass
  and reject a missing, changed, or multiply resolved candidate.
- **MUST:** Bind the digest to the complete package inventory, executable bits,
  destination path, and any existing destination conflict.
- **MUST:** Install only into the shared `<project>/.agents/skills/` root per
  [ADR-0012](0012-shared-project-skill-installation-root.md), for either harness.
- **MUST:** Stop on a destination conflict. Do not overwrite, merge, move, or
  auto-suffix a package directory.
- **MUST NOT:** Accept a client-supplied filesystem path as the package source.
  The source is always the package path from the server's catalog entry.
- **MUST NOT:** Install a package that is already a project source, execute
  package scripts, or claim that installation proves later harness invocation.
- **MUST NOT:** Search or install from sources the user has not registered. A
  public registry remains the separate `find-skills` path.

## Considered Options

- Keep manual copying of pinned snapshot packages.
- Add a general package-manager command that accepts paths or URLs.
- Add a reviewed install of one exact catalog candidate, reusing the existing
  bounded copy helper.

## Decision Outcome

Chosen option: "Reviewed install of one exact catalog candidate." Review is
read-only and returns the inventory, provenance, license files, destination, and
conflict state. Install repeats the same request with the digest, rechecks the
package and destination, copies through the existing symlink-safe bounded copy
layer, and verifies the installed tree against the reviewed inventory. The
companion skill orchestrates search, review, confirmation, installation, and a
post-install project-catalog check; it does not create chains.

### Positive Consequences

- Everyday skill installation no longer requires hand-copying files or building
  a chain, and the CLI surface matches the catalog capabilities promised by
  [ADR-0027](0027-cli-and-skill-driven-workflow.md).
- The existing copy safety work (bounds, symlink refusal, remote snapshot
  verification, Windows executable-mode records) is reused instead of duplicated.
- Package provenance and exact identity stay visible to the user before install.

### Negative Consequences

- Copilot review invokes its CLI-authoritative discovery, so a review can be
  slower than the indexed search that produced the candidate.
- Updating or removing an installed package remains a manual decision; the new
  path only adds one reviewed package and refuses conflicts.
- Remote snapshots carry no license field, so the review reports license files
  rather than asserting an SPDX identifier.

## Verify

- **Check:** `npx vitest run tests/unit/catalog-install.test.ts tests/unit/catalog-copy.test.ts tests/integration/control.test.ts tests/unit/cli.test.ts`
- **Expected:** Review is read-only, stale or changed candidates and digests are
  rejected, an existing destination is refused, and a successful install lands
  in `.agents/skills/` with a matching fingerprint.
