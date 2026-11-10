---
id: ADR-0026
applies_to:
  - "src/server/runs/workspace-evaluate.ts"
  - "src/server/control.ts"
status: Accepted
---

# ADR-0026: Evaluate retained workspaces only with explicit bounded checks

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-10

## Context

A retained test workspace needs objective evidence about what a chain left
behind. Running commands from workspace content would execute untrusted
material, and inferring success from output would be misleading.

## Decision

`workspace evaluate` accepts only checks the caller names: a regular-file path
with optional SHA-256, case-sensitive UTF-8 substring, or JSON Pointer scalar
comparison. It never executes workspace content, refuses links and special
files, reads at most 20 files of 1 MiB each, and reports per-file observations.
Numeric JSON values that lose their decimal value on conversion fail closed;
hash checks cover exact text. `workspace inspect` is the read-only companion.

## Consequences

- Results are sequential observations, not an atomic snapshot, and not proof of
  semantic correctness or that a skill was invoked.
- Richer evaluation (running tests, semantic grading) requires a new decision.

## Verify

- **Check:** `npx vitest run tests/integration/control.test.ts`
- **Expected:** Unsafe paths, oversize files, mismatches, and unsafe numbers fail as documented.
