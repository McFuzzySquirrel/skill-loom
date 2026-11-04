---
id: ADR-0008
applies_to:
  - "src/server/runs/prompts.ts"
  - "src/server/runs/handoff.ts"
  - "src/server/harness/opencode.ts"
  - "src/server/harness/copilot.ts"
status: Accepted
---

# ADR-0008: Use session modes with an explicit handoff fallback

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** EXEC-05 and the RUN-02 task required shared, fresh, and fork behavior for harnesses with different session capabilities.

## Agent Rules

- **MUST:** Implement `shared` by reusing one session id, `fresh` by creating a new id per step, and `fork` by using a native fork only where the adapter declares one.
- **MUST:** Label a non-native fork as a **handoff** and state that it is **not a native session fork** in the UI and preflight.
- **MUST:** Bound the handoff note to the previous step's position, label, skill name, instruction, recorded status, and bounded tail.
- **MUST NOT:** Describe a handoff as a byte-for-byte copy of the prior harness session.

## Verify

- **Check:** `npx vitest run tests/unit/prompts.test.ts tests/unit/harness-registry.test.ts`
- **Expected:** Both suites pass, including shared/fresh/fork session plans and handoff-note formatting. Inspect `OPENCODE_FORK_MECHANISMS`; OpenCode interactive must be `handoff` and headless `native`, while both Copilot surfaces must be `handoff`.

## Context and Problem Statement

Chains can continue one conversation, start each step clean, or derive a new session from the previous step. The two harnesses expose different session capabilities, and neither offers a native fork on every surface. How should a chain express intent without lying about what the harness did?

## Decision Drivers

- OpenCode exposes `--fork` only on its headless `run` surface.
- Copilot exposes no fork flag on either surface.
- Users still need a "continue from here" behavior for interactive chains.
- A handoff must not smuggle a full transcript into the next prompt.

## Considered Options

- Model the three modes and fall back to a bounded, labelled handoff.
- Reject fork whenever no native fork exists.
- Pretend every fork is native and copy the full prior session.

## Decision Outcome

Chosen option: "Model the three modes and fall back to a bounded, labelled handoff", because it keeps one chain vocabulary while telling the truth about the mechanism used.

### Positive Consequences

- Users can choose continuation semantics once and run the chain on either harness.
- Preflight states the actual mechanism before the run starts.
- The handoff note is deterministic and bounded.

### Negative Consequences

- Interactive OpenCode and all Copilot forks are not true session copies.
- A handoff loses context that a native fork would retain.
- The UI must explain a subtle distinction that users may overlook.

## Pros and Cons of the Options

### Three modes with handoff fallback

- Good, because the chain model stays portable and the mechanism is explicit.
- Bad, because handoff quality depends on a summarized note.

### Reject non-native fork

- Good, because every accepted fork is a real fork.
- Bad, because interactive chains lose a useful continuation behavior on both harnesses.

### Pretend all forks are native

- Good, because the UI is simpler.
- Bad, because it is false and would silently change the meaning of a chain.

## Links

- Implemented by `planRunSessions` in `src/server/runs/prompts.ts`, `src/server/runs/handoff.ts`, and the adapter `forkMechanisms` descriptors.
- User-facing statement: [OPERATIONS.md](../OPERATIONS.md#fork-handoff-behavior).
