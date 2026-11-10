---
id: ADR-0022
applies_to:
  - "src/server/runs/discovery-workspaces.ts"
  - "src/server/routes/discovery.ts"
  - "src/server/routes/runs.ts"
  - "src/server/config/schema.ts"
  - "src/web/routes/DiscoveryPage.tsx"
  - "src/web/routes/RunPage.tsx"
  - ".github/skills/scenario-discovery/"
status: Accepted; web UI superseded in part by ADR-0027 and ADR-0028
---

# ADR-0022: Run scenario discovery in a retained managed workspace

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-08

**Technical Story:** Let users run the standalone `scenario-discovery` workflow interactively against reviewed remote skill snapshots without downloading a handoff or manually launching an external CLI.

## Rules

- **MUST:** Require explicit review of the complete pinned candidate handoff and redistribution implications before creating a workspace.
- **MUST:** Materialize a unique managed workspace under Skill Loom's configured storage root, install only the application-shipped `scenario-discovery` skill, and retain the full validated handoff as untrusted data.
- **MUST:** Reuse the normal supervised preflight, trust, run, terminal, active-run exclusion, and interruption recovery paths.
- **MUST:** Require an explicit user Start action after preflight. Workspace preparation never launches a harness.
- **MUST:** Keep result output in a fixed server-selected workspace location, bound and validate it, and display the complete chain and package contents for review.
- **MUST:** Bind review to the exact result bytes. Require separate content and redistribution acknowledgments before the user marks discovery Done.
- **MUST:** Create a new project-independent draft only after the supervised discovery run completes and the reviewed result still matches. Preserve exact pinned remote skill bindings.
- **MUST:** Retain workspaces until explicit cleanup; block cleanup while the active-run pointer identifies the project.
- **MUST NOT:** Install selected candidate packages as active skills in the discovery workspace, fetch sources automatically, trust candidate instructions, execute candidate package code, overwrite drafts or bundles, or execute the resulting chain.
- **MUST NOT:** Treat a working directory as an operating-system sandbox. The harness retains its normal access to files, network resources, and authentication.
- **MUST NOT:** Persist a full terminal transcript or store handoff/result contents in global configuration or logs.

## Decision drivers

- Preserve the validated handoff's exact snapshot provenance and offline behavior.
- Reuse existing supervised orchestration rather than creating a second PTY or execution lifecycle.
- Avoid duplicate candidate names shadowing the discovery skill or accidentally activating candidate instructions during discovery.
- Preserve the existing review and redistribution gates and require a second review of the generated chain before draft creation.
- Retain recovery state and make cleanup explicit.

## Decision outcome

Chosen option: create a retained managed project containing the shipped `scenario-discovery` package and one server-verified handoff file. Candidate packages stay inside the handoff until the standalone helper creates an approved bundle. The workspace is not an OS sandbox, and the harness may access anything permitted by its normal environment.

The bootstrap chain is supervised-only. Skill Loom does not auto-start it, does not advance because output becomes quiet or a result file appears, and does not resume a stale process after restart. Before Done, the user reviews the exact bounded v1 result and separately acknowledges package content and redistribution. The result validator rejects unsupported bundle versions, modified/ambiguous/unreferenced skills, package bytes not matching the handoff, unsafe paths, symlinks, and oversized output.

Automatic import is an explicit opt-in. It creates a new global draft only after the reviewed supervised run completes. The importer sets exact remote skill bindings and does not copy package bytes into a mutable global install, overwrite an existing draft, publish the bundle, or run the proposed chain. Imports are retryable and idempotent. Manual import follows the same validation and completion gates.

### Positive consequences

- Users can go from reviewed pinned candidates to an existing interactive CLI without copying a handoff by hand.
- The normal preflight, trust, single-active-run, terminal, and recovery safeguards remain authoritative.
- Candidate bytes remain inspectable and are not installed as additional active skills.
- Imported drafts remain bound to retained source identities and independent of workspace lifetime.

### Negative consequences

- Goals and candidate contents are persisted under the configured Skill Loom storage directory until cleanup.
- A retained workspace consumes disk and must be explicitly removed.
- This is file isolation only; it is not a security sandbox.
- Result review and import add another deliberate confirmation and validation stage.

## Links

- Related: [ADR-0015](0015-pinned-remote-skill-snapshots.md), [ADR-0017](0017-managed-disposable-test-workspaces.md), [ADR-0019](0019-project-independent-chain-drafts.md), and [ADR-0021](0021-validated-project-independent-discovery-handoff.md).
- Regression coverage: discovery workspace route/service tests, run-route supervised-only tests, and discovery Playwright flows.
