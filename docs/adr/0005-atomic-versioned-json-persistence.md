---
id: ADR-0005
applies_to:
  - "src/server/config/schema.ts"
  - "src/server/config/store.ts"
  - "src/server/chains/store.ts"
  - "src/server/chains/library.ts"
  - "src/server/runs/store.ts"
  - "src/portable/runtime.ts"
status: Accepted
---

# ADR-0005: Persist versioned JSON with atomic replacement

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** NFR-REL-01 and the CHAIN/RUN storage tasks required durable records that a crash or concurrent request cannot truncate.

## Agent Rules

- **MUST:** Write JSON through a temporary file in the same directory, flush it, then rename it over the target.
- **MUST:** Attempt to flush the containing directory after rename, but tolerate documented unsupported-directory-fsync errors, including `EPERM`; propagate other errors.
- **MUST:** Include an explicit integer `version` in every persisted config, chain, and run document and reject an unknown version with a typed error.
- **MUST:** Serialize read-modify-write cycles for the same target within the server process.
- **MUST NOT:** Delete, rewrite, or silently reset a corrupt record; report it and leave the original bytes intact so the user can inspect or remove it deliberately.

## Verify

- **Check:** `npx vitest run tests/unit/config.test.ts tests/unit/chain-store.test.ts tests/unit/run-store.test.ts tests/unit/portable-runtime.test.ts`
- **Expected:** The storage suites pass, including atomic-write failure, concurrent update, corrupt-file, and unsupported-version cases. Portable state writes must also complete when directory fsync returns a documented unsupported-operation error. A failed write must leave the previous target contents unchanged.

## Context and Problem Statement

Skill Loom persists global configuration, project chains, global templates, and run records as files. A direct in-place write can leave a truncated document after a crash, and an unversioned format lets an older binary misinterpret a newer file. What storage contract keeps these records trustworthy?

## Decision Drivers

- Records are small JSON documents with a known schema.
- The application is single-user but requests and process exits can interleave.
- A corrupt file must not be confused with an empty collection.
- Users must be able to back up and inspect records without a database tool.

## Considered Options

- Versioned JSON with same-directory temporary-file rename and typed validation.
- Direct `writeFile` to the target path.
- SQLite or another embedded database.

## Decision Outcome

Chosen option: "Versioned JSON with same-directory temporary-file rename and typed validation", because it gives crash-safe replacement and inspectable records without adding a database dependency.

### Positive Consequences

- A crash during a write leaves either the old document or the new one, not a partial mix.
- Schema validation catches malformed updates before they reach disk.
- Users can copy, review, and delete records with ordinary file tools.

### Negative Consequences

- Every schema change needs a deliberate version decision and migration path.
- JSON files are not a transactional multi-record store; cross-file consistency needs application logic.
- Directory fsync behavior varies by platform and must tolerate documented errno values.

## Pros and Cons of the Options

### Versioned JSON with atomic rename

- Good, because it is simple, inspectable, and crash-resistant for one document at a time.
- Bad, because it does not provide cross-document transactions or queryable history.

### Direct in-place writes

- Good, because it is the least code.
- Bad, because a crash can truncate the only copy of a record.

### Embedded database

- Good, because it provides transactions and queries.
- Bad, because it adds a native dependency and hides user data behind a schema migration tool.

## Links

- Implemented by `atomicWriteJson` in `src/server/config/store.ts`, reused by chain and run stores, and by the portable helper's atomic writer in `src/portable/runtime.ts`.
- Schemas: `src/server/config/schema.ts`, `src/server/chains/model.ts`, `src/server/runs/model.ts`.
- Related: [ADR-0004](0004-frozen-run-snapshots-and-bounded-tails.md) and [ADR-0010](0010-global-chain-library-snapshots.md).
