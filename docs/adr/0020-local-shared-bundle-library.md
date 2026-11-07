---
id: ADR-0020
applies_to:
  - "src/server/bundles/shared-library.ts"
  - "src/server/routes/shared-bundles.ts"
  - "src/web/routes/SharedBundlesPage.tsx"
  - "src/web/components/PublishSharedBundleDialog.tsx"
  - "tests/unit/shared-library.test.ts"
  - "tests/integration/shared-bundle-routes.test.ts"
status: Accepted
---

# ADR-0020: Publish reviewed bundles to a configured local library

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-13

**Technical Story:** Provide a stable location where reviewed chain bundles can be browsed and imported across Skill Loom projects or installations without adding a hosted service.

## Library Rules

- **MUST:** Store portable bundle files in an explicitly configured, existing absolute directory visible to the server.
- **MUST:** Regenerate the bundle at publication time and reject publication if the reviewed fingerprint no longer matches.
- **MUST:** Require explicit content and redistribution review confirmation.
- **MUST:** Publish atomically without replacing an existing file; fail visibly when the filesystem cannot provide the required exclusive operation.
- **MUST:** Display invalid, unsafe, and unreadable files as distinct library entries rather than treating them as available bundles.
- **MUST NOT:** Upload bundles, expose a hosted sharing endpoint, or overwrite/delete existing library files through the UI.
- **MUST NOT:** Claim that Skill Loom establishes redistribution rights or automatically collects license evidence.

## Decision Drivers

- Allow users to share bundles through storage they already control.
- Preserve the portable bundle review/import boundary.
- Prevent concurrent or accidental publication from replacing another bundle.
- Avoid turning the local-only application into a multi-user hosted service.

## Considered Options

- Add a hosted sharing backend.
- Use a configured local or mounted directory with immutable publication.
- Rely only on browser downloads and manual file movement.

## Decision Outcome

Chosen option: "Use a configured local or mounted directory with immutable publication." Skill Loom validates the configured path, scans a bounded set of bundle files, and publishes by writing and syncing a temporary file in the same directory before exclusive hard-link creation. The server regenerates the source bundle and checks the user's review fingerprint before publication. There is no overwrite or delete operation.

Publication review asks the user to confirm package contents and redistribution permission. The software does not harvest license or notice files; users remain responsible for reviewing those obligations. Storage may be a mounted share if it supports same-directory hard links, but the application itself remains single-user and loopback-only.

### Positive Consequences

- Existing filesystem permissions and backup practices govern shared bundle access.
- Exclusive publication prevents replacing a pre-existing filename.
- Review staleness and malformed library entries are reported explicitly.

### Negative Consequences

- Mounted filesystems without hard-link support cannot be used for publication.
- The library is not a hosted collaboration service and has no access controls beyond filesystem permissions.
- Redistribution rights and license evidence still require human review.

## Links

- Related: [ADR-0010](0010-global-chain-library-snapshots.md), [ADR-0015](0015-pinned-remote-skill-snapshots.md), and [ADR-0018](0018-version-portable-bundles-for-native-agents.md).
- Regression coverage: `tests/unit/shared-library.test.ts` and `tests/integration/shared-bundle-routes.test.ts`.
