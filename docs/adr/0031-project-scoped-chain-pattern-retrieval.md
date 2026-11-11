---
id: ADR-0031
applies_to:
  - "src/server/chains/**"
  - "src/shared/chain.ts"
  - "src/server/config/**"
  - "src/server/catalog/**"
  - "tests/unit/chain-*.test.ts"
  - "tests/unit/presets.test.ts"
status: Accepted
---

# ADR-0031: Keep chain-pattern retrieval project-scoped and opt-in

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-11

**Technical Story:** Discovery can propose better workflows if it can see how similar outcomes were previously chained, but chains are project-owned and the removed global chain library must not return as an accidental side effect of search.

## Agent Rules

- **MUST:** Index curated scenario presets and profile-owned drafts in the profile scope.
- **MUST:** Keep project chains inside that project's `.loom` scope. A query from one project must not read another project's chains.
- **MUST:** Require explicit pattern metadata (`summary`, `tags`, optional `intent` and `outcome`) before a chain becomes retrievable. Do not synthesize pattern metadata from private instruction text alone.
- **MUST:** Exclude resolved inputs, run output tails, credentials, and private filesystem paths from every pattern record and snippet.
- **MUST:** Make any cross-project pattern aggregation explicit, opt-in, redacted, revocable, and documented. The default is off.
- **MUST NOT:** Recreate the removed global chain library or make cross-project sharing implicit ([ADR-0027](0027-cli-and-skill-driven-workflow.md), [ADR-0028](0028-single-purpose-chain-editor.md)).
- **SHOULD:** Rank patterns by structure (skill sequence, step shape, declared inputs and outputs) in addition to text.
- **SHOULD:** Treat the pattern index as derived and disposable; chain files remain the source of truth.

## Verify

- **Check:** `npx vitest run tests/unit/chain-model.test.ts tests/unit/chain-store.test.ts tests/unit/presets.test.ts` after Phase 4 adds the scope and opt-in suites.
- **Expected:** Curated presets and drafts are retrievable in the profile scope, a project query cannot see another project's chains, the default has no cross-project results, and opt-in aggregation excludes inputs and run tails.
- **Manual check:** Review the [capability retrieval plan](../design/capability-retrieval.md#phase-4-chain-pattern-retrieval) and confirm the default and opt-in boundaries before enabling the feature.

## Context and Problem Statement

Skill retrieval answers "what can do this?" Chain retrieval answers "what sequence solved something like this?" The current chain document stores steps, instructions, inputs, harness, session mode, and optional native-agent selection, but no summary, tags, intent, or outcome. Project chains live under `<project>/.loom/chains/`; drafts live under the profile. The global chain-template and shared-bundle libraries were removed by ADR-0027 and ADR-0028.

Indexing every project's chains into one profile database would create a new cross-project store and a privacy boundary that the current architecture does not have. How should chain patterns be retrieved without recreating that library?

## Decision Drivers

- Make useful pattern recommendations from the user's own curated and previous work.
- Preserve the single-project ownership model and loopback-only privacy posture.
- Avoid leaking resolved inputs, run output, credentials, or private paths.
- Require explicit consent before any cross-project aggregation.
- Reuse curated scenario presets as reviewed, first-class patterns.
- Keep chain files authoritative and any index disposable.

## Considered Options

- Build one global index of every project's chains.
- Index only curated scenario presets.
- Index only the current project's chains.
- Index curated presets, profile drafts, and the current project's chains by default, with explicit opt-in for cross-project aggregation.

## Decision Outcome

Chosen option: "Index curated presets, profile drafts, and the current project's chains by default, with explicit opt-in for cross-project aggregation", because it provides useful pattern recall while preserving project ownership and the removal of the global library.

### Positive Consequences

- Discovery can recommend reviewed presets and the user's own drafts without crossing a project boundary.
- A project's chains can inform later work in the same project.
- Cross-project recommendations become a deliberate, redactable choice instead of an implicit data flow.
- Structural similarity can outrank text similarity for chains.

### Negative Consequences

- Cross-project pattern suggestions are unavailable until the user opts in and maintains that choice.
- Chain authors must supply summary and tags; without them, a chain is not retrievable.
- Adds a second lifecycle decision for chain metadata and, if the strict chain schema cannot accept optional fields, a new chain version.
- Opt-in aggregation still requires a redaction and retention policy.

## Pros and Cons of the Options

### One global chain index

- Good, because it produces the widest recommendation corpus.
- Bad, because it creates a new cross-project store, leaks project boundaries, and reverses the removal of the global library.

### Curated presets only

- Good, because the corpus is reviewed, versioned, and safe.
- Bad, because it cannot learn from the user's own work or project-specific patterns.

### Current project only

- Good, because it preserves project ownership with no new consent surface.
- Bad, because drafts and curated presets are excluded, and a new project starts with no patterns.

### Project + drafts + curated, opt-in aggregation

- Good, because it balances recall, ownership, and explicit consent.
- Bad, because it requires metadata upkeep, a redaction policy, and an opt-in lifecycle.

## Links

- Related: [ADR-0027](0027-cli-and-skill-driven-workflow.md), [ADR-0028](0028-single-purpose-chain-editor.md), [ADR-0030](0030-capability-index-and-model-reranking.md).
- Implemented in the phased plan at [capability retrieval plan](../design/capability-retrieval.md#phase-4-chain-pattern-retrieval).
- Baseline: `src/server/chains/model.ts`, `src/server/chains/store.ts`, `src/server/chains/presets.ts`.
