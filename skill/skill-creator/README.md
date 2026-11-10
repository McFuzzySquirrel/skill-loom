# skill-creator

> Part of the [skill-forge](../README.md) suite - tools for forging agent skills based on [agentskills.io](https://agentskills.io) best practices.

An agent skill that guides an agent through creating a new, well-structured agent skill from a rough idea. It works in GitHub Copilot CLI, OpenCode, and other Agent Skills hosts.

The workflow is more than a scaffold. It runs a structured interview, applies the skill-review quality rubric during scaffolding, performs a pre-flight self-check, and validates the output with a formal `skill-review` audit. The audit is advisory: a passing score is not a correctness, safety, or security guarantee.

Scaffolding happens in `<project>/.skill-loom-authored/<name>/`, outside every host-discovered skill root. Installation into `<project>/.agents/skills/<name>/` needs separate, explicit approval.

---

## What it does

1. **Interviews** the user - structured question bank covering name, purpose, trigger, complexity, gotchas, validation, and calibration signals
2. **Selects** the right scaffold - flat (simple) or modular (complex) based on the interview answers
3. **Scaffolds** the skill files - each section built intentionally against the six quality axes
4. **Pre-flight checks** - works through a blocker checklist before the formal audit
5. **Validates** with `skill-review` - loops until all axes score ≥ 2.0; fails gracefully if not installed

---

## Prerequisites

- `skill-review` should be installed in a host-discovered project skill root, for example `.agents/skills/skill-review/`, for the validation phase (Step 5)
- Without `skill-review`, the skill scaffolds and pre-flight checks but cannot run the formal audit
- A `skill-review` score is advisory, not a safety or correctness gate

---

## Install

```bash
cp -r skill-creator/ /path/to/your-project/.agents/skills/skill-creator/
```

Both `skill-creator` and `skill-review` are needed for the full workflow:

```bash
cp -r skill-review/  /path/to/your-project/.agents/skills/skill-review/
cp -r skill-creator/ /path/to/your-project/.agents/skills/skill-creator/
```

---

## Usage

Ask your agent:

> "Create a new skill for [your idea]"
> "Help me build a skill that [does something]"
> "Start the skill creation workflow"

The agent will load `skill-creator` and begin the structured interview.

---

## File structure

```
skill-creator/
├── SKILL.md                        # Main skill - 5-step process with load triggers
├── README.md                       # This file
├── CHANGELOG.md
└── references/
    ├── interview-questions.md      # Full question bank (Blocks A–F)
    ├── flat-template.md            # Scaffold for simple skills (≤3 steps, no branching)
    ├── modular-template.md         # Scaffold for complex skills (≥4 steps / branching)
    ├── quality-axes.md             # Six quality axes reframed as creation guidance
    └── preflight-checklist.md      # Pre-flight self-check before formal skill-review audit
```

Staged output lives outside this package at
`<project>/.skill-loom-authored/<skill-name>/`.

---

## Quality axes

Built around - and enforces - the same six axes used by `skill-review`:

| Axis | What it checks |
|------|---------------|
| Context economy | No generic explanations; specific and project-focused |
| Gotchas coverage | Concrete, specific edge cases - not generic advice |
| Procedural clarity | *How to approach* the work, not just *what to produce* |
| Progressive disclosure | Bulk content in `references/`; specific load triggers |
| Calibration | Prescriptiveness matched to operation fragility |
| Validation | Concrete, runnable checks - not "make sure it works" |

`skill-creator` itself scores 3/3 on all six axes (verified by `skill-review`).

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

