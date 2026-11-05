---
id: ADR-0003
applies_to:
  - "src/server/chains/model.ts"
  - "src/server/runs/prompts.ts"
  - "src/server/runs/observations.ts"
  - "src/web/**"
status: Accepted
---

# ADR-0003: Treat skills as model-invoked prompt context

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-04

**Technical Story:** EXEC-01 and the product contract required an honest boundary between prompt order and actual skill firing.

## Agent Rules

- **MUST:** Assemble each skill step as explicit skill context plus the resolved instruction text, in chain order.
- **MUST:** Assemble standalone instruction steps without a skill header, catalog requirement, or skill-observation signal. They remain ordinary prompts, not system instructions.
- **MUST:** Describe chain order as deterministic prompt order only, never as proof that a harness loaded or executed a named skill.
- **MUST NOT:** Block, fail, or advance a step because a skill observation is missing.
- **MUST NOT:** Render harness or skill output as raw HTML or treat a `SKILL.md` as an executable command.

## Verify

- **Check:** `npx vitest run tests/unit/prompts.test.ts tests/unit/chain-model.test.ts`
- **Expected:** Both suites pass, including prompt shape, placeholder resolution, and observation behavior. Review `formatStepPrompt` in `src/server/runs/prompts.ts`; skill steps must emit `Skill: <name>` followed by `Instruction:` and resolved text, while instruction steps emit only `Instruction:` and resolved text.

## Context and Problem Statement

Installed agent skills are instructions the model may choose to load; they are not command-line programs. Should Skill Loom claim that a chain deterministically fires each named skill, or should it guarantee only the prompt text and order it controls?

## Decision Drivers

- Harnesses and models can decline to load a skill even when it exists and preflight resolved it.
- OpenCode exposes no reliable interactive skill-load line; Copilot's evidence is best effort.
- Users still need deterministic ordering and repeatable instructions.
- Overstating execution would make run results and support claims misleading.

## Considered Options

- Guarantee prompt order and label skill firing as model-invoked and best effort.
- Treat a resolved catalog entry as proof the skill will fire.
- Attempt to invoke skill packages as commands.

## Decision Outcome

Chosen option: "Guarantee prompt order and label skill firing as model-invoked and best effort", because it is the strongest claim the harness interaction can support.

Standalone `kind: "instruction"` steps extend this contract without inventing a generic catalog skill: the same harness receives a resolved prompt in the saved position and session mode, but there is no skill to resolve or observe. Legacy skill steps without `kind` remain valid.

### Positive Consequences

- The product promise matches observable behavior.
- Skill observations remain informational without destabilizing run state.
- Chains stay portable across harnesses that interpret prompts differently.

### Negative Consequences

- A chain can complete without a named skill being loaded, so users must inspect the terminal and outcome.
- Skill observations are incomplete for OpenCode and cannot be used as a hard acceptance gate.
- Documentation and UI copy must repeat the limitation, which adds noise.

## Pros and Cons of the Options

### Prompt order plus best-effort observation

- Good, because it is truthful and robust to harness differences.
- Bad, because it gives weaker guarantees than users might expect from "run a skill".

### Resolved entry means the skill fires

- Good, because it would make the UI simpler.
- Bad, because it is false for both verified harnesses in at least some sessions.

### Invoke skill packages as commands

- Good, because it would be deterministic.
- Bad, because skills are not executable programs and the harness, not Skill Loom, owns loading.

## Links

- Implemented by `formatStepPrompt` and `resolveStepInstruction` in `src/server/runs/prompts.ts`.
- Observation states are defined in `src/server/runs/model.ts` and `src/server/runs/observations.ts`.
- User-facing statement: [OPERATIONS.md](../OPERATIONS.md#skill-firing-limitation) and [README.md](../../README.md#about).
