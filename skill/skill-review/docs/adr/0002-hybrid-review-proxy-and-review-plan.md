# ADR-0002: Hybrid Review Proxy and Review Plan Workflow

**Status:** Accepted  
**Date:** 2026-08-02  
**Deciders:** McFuzzySquirrel  

---

## Context

The `skill-review` package already uses deterministic heuristics for CI and a portable agent skill for richer semantic review. As the review flow evolved, two practical requirements emerged:

1. The audit report should distinguish a deterministic reviewer-style proxy from a literal human review.
2. The agent should present a short review plan before applying any edits so the suggested changes remain reviewable and explicit.

This ADR records those workflow refinements without changing the base architecture in ADR-0001.

---

## Decision 1: Include a reviewer-style proxy score, clearly labeled as a proxy

### Decision

The audit report includes a reviewer-style proxy score derived from the skill text and on-disk structure. The score is always labeled as a proxy unless an explicit human reviewer has supplied a real semantic review.

### Rationale

- CI and local CLI runs need a stable comparison point even when no human reviewer is present.
- A proxy score preserves the usefulness of the report without implying human judgment.
- The score can reward signs of semantic quality such as concrete gotchas, stepwise process guidance, load-triggered references, fenced commands, fallback branches, and validation steps.

### Trade-offs

The proxy is not equivalent to a human review. It can identify signals that correlate with good skills, but it cannot reliably judge correctness or completeness the way an informed reviewer can.

---

## Decision 2: Require a short review plan before edits are applied

### Decision

When the agent is asked to apply improvements, it first produces a short review plan that lists the top issues, the proposed edits, and the rationale for each edit. The plan is shown to the user before any file changes are made.

### Rationale

- Keeps changes reviewable and reduces accidental over-editing.
- Makes it clear which changes come from the audit and which are inferred by the agent.
- Gives the user a chance to approve the direction before edits are applied.

### Trade-offs

This adds one extra interaction step, but it makes the workflow more explicit and easier to trust.

---

## Consequences

- Reports now carry both a mechanical score and a reviewer-style proxy score.
- The portable skill instructions should remind the agent to draft a review plan before modifications.
- The architectural split in ADR-0001 remains unchanged; this ADR only refines the review workflow on top of it.
