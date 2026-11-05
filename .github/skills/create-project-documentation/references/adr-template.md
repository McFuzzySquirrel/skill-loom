*One record holds one decision. Name files `NNNN-kebab-title.md` under `docs/adr/`, and use `ADR-NNNN` as its stable ID in the front matter and title so a copied record still identifies itself. Set `status` to Proposed, Rejected, Accepted, Deprecated, or `Superseded by ADR-NNNN`. Set `applies_to` to repository-relative file globs governed by the decision; use `["**/*"]` only for genuinely project-wide decisions. Write agent rules as concrete obligations, and give each rule a check that can establish whether the code complies. Keep the record concise (ideally under 200 lines) and link to supporting material rather than duplicating it. Populate every section; if one has nothing to record, say so rather than deleting the heading. Superseding is bidirectional: set the old record's status to `Superseded by ADR-NNNN` and reference both records from each other's `Links`.*

---
id: ADR-NNNN
applies_to:
  - "path/to/file-or-glob"
status: Proposed
---

# ADR-NNNN: Short Title Of The Solved Problem And Solution

- **Deciders:** Everyone involved in the decision
- **Date:** YYYY-MM-DD when the decision was last updated, not when it was first written

**Technical Story:** Originating ticket, issue, or requirement

## Agent Rules

- **MUST:** [Required implementation or design constraint.]
- **MUST NOT:** [Prohibited implementation or design choice.]
- **SHOULD:** [Recommended practice, only when there is a meaningful exception.]

Include only rules that follow from the decision. Use clear, imperative language and avoid restating the same rule in different words.

## Verify

- **Check:** `[exact command, test, lint rule, or review procedure]`
- **Expected:** [Observable result that demonstrates the rules are followed.]

Prefer an automated check. If compliance cannot be checked automatically, describe a concrete manual review procedure rather than inventing a command.

## Context and Problem Statement

The situation that forces a decision, in two or three sentences. Phrase it as the question that must be answered.

## Decision Drivers

- The forces, facing concerns, or quality attributes that constrain the choice.

## Considered Options

- The options genuinely evaluated, including the ones not selected.

## Decision Outcome

Chosen option: "[option]", because [which decision driver it satisfies, or why it comes out best].

### Positive Consequences

- What improves, and what follow-up work this creates.

### Negative Consequences

- What worsens, what quality attribute is compromised, and what risk is now carried.

## Pros and Cons of the Options

### [Option 1]

- Good, because [argument].
- Bad, because [argument].

### [Option 2]

- Good, because [argument].
- Bad, because [argument].

## Links

- Supersedes, Superseded by, Related, or Implemented by [links to source, configuration, tests, or other ADRs].
