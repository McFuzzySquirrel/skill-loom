---
id: ADR-0021
applies_to:
  - "src/shared/discovery-handoff.ts"
  - "src/server/catalog/discovery-handoff.ts"
  - "src/server/routes/discovery.ts"
  - "src/web/routes/DiscoveryPage.tsx"
  - ".github/skills/scenario-discovery/"
  - "tests/integration/discovery-routes.test.ts"
  - "tests/e2e/discovery.spec.ts"
status: Accepted; web UI superseded in part by ADR-0027 and ADR-0028
---

# ADR-0021: Prepare validated discovery handoffs from pinned snapshots

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-13

**Technical Story:** Let users review candidate skills from retained remote snapshots and continue scenario discovery in an existing compatible CLI session without opening or modifying a project.

## Handoff Rules

- **MUST:** Identify candidates by exact harness, source, revision, and repository-relative package path; resolve identities only against retained verified snapshots.
- **MUST:** Verify package bytes and fingerprints before preparing a standalone versioned handoff, and validate the complete artifact before a portable helper exposes its contents.
- **MUST:** Keep handoffs distinct from chain bundles and reject them from chain import and execution APIs.
- **MUST:** Require explicit review and download by the user; bind review to the prepared bytes and show the full selected package contents.
- **MUST:** Bound package count, file count, decoded content, and JSON request size; fail visibly rather than truncating.
- **MUST NOT:** Persist handoffs outside an explicitly reviewed managed discovery workspace, fetch repositories automatically, accept browser-supplied filesystem paths or package bytes as snapshot identities, or execute package code.
- **MUST NOT:** Treat selecting all candidates as approval to include or execute all of them in a proposed chain.
- **MUST NOT:** Install packages into a project, import a resulting chain, or imply redistribution rights have been established.

## Decision Drivers

- Separate project-independent discovery from manual goal-based draft authoring.
- Preserve the explicit network boundary and pinned identity guarantees of remote snapshots.
- Reuse strict portable-bundle validation and no-overwrite output behavior.
- Keep review and final user approval in the existing CLI host, without adding an agent runtime to the web application.

## Considered Options

- Launch an agent from the web application and manage its session.
- Let the browser provide package contents or local server paths directly.
- Create a bounded, server-prepared download from exact retained snapshot identities for an existing CLI session.

## Decision Outcome

Chosen option: "Create a bounded, server-prepared download from exact retained snapshot identities for an existing CLI session." The `skill-loom-discovery-handoff` v1 artifact contains the goal, chosen harness, exact candidate identities, bounded regular-file contents, executable flags, package fingerprints, and an overall fingerprint. It contains no repository URL, absolute path, credential, run history, or input default. Preparation re-resolves selected identities against retained snapshots, verifies contents, and rejects unavailable, ambiguous, stale, unsafe, or oversized selections. The server does not retain the resulting artifact.

The standalone `scenario-discovery` skill validates the handoff offline and treats its content as untrusted. In the original handoff flow, it proposes scenarios for user selection and revision, then creates a standard v1 `.loom.json` bundle only after explicit chain and redistribution review. The builder includes only approved referenced packages, preserves executable flags, uses the existing bundle rules, and creates output exclusively. The web application never imports or runs the resulting chain. Native-agent selection remains in the managed designer and run path.

The later managed discovery flow is an explicit exception to the original no-launch boundary: after content and redistribution review, Skill Loom may create a retained managed workspace, persist the exact validated handoff there, install only its shipped `scenario-discovery` package, and offer the existing supervised preflight/trust/interactive-run flow. It does not activate candidate packages. The user must review the exact output and mark the supervised step Done before optional draft creation. Draft creation preserves exact remote bindings and never starts the resulting chain. See [ADR-0022](0022-managed-interactive-scenario-discovery.md).

### Positive Consequences

- Candidate selection is independent of projects and does not change draft or chain data.
- The handoff can be inspected and processed without a running Skill Loom server.
- Exact pinned package identities and bounded contents make the handoff reproducible and reviewable.

### Negative Consequences

- The downloaded artifact may contain private or redistribution-restricted content and must be protected by the user.
- Users whose host lacks the updated skill must install it and refresh host discovery.
- The workflow requires a compatible existing CLI session and does not support native-agent switching.

## Links

- Related: [ADR-0015](0015-pinned-remote-skill-snapshots.md), [ADR-0019](0019-project-independent-chain-drafts.md), and [ADR-0020](0020-local-shared-bundle-library.md).
- Regression coverage: `tests/integration/discovery-routes.test.ts`, `tests/unit/scenario-discovery-handoff-helper.test.ts`, and `tests/e2e/discovery.spec.ts`.
