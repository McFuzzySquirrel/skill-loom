---
id: ADR-0029
applies_to:
  - ".github/skills/scenario-discovery/SKILL.md"
  - ".github/skills/scenario-discovery/references/authored-skill-gap.md"
  - ".github/skills/scenario-discovery/scripts/authored-skill.mjs"
  - ".github/skills/scenario-discovery/scripts/build-from-handoff.mjs"
  - ".github/skills/skill-creator/SKILL.md"
  - ".github/skills/skill-review/SKILL.md"
status: Accepted
---

# ADR-0029: Author missing skills through an explicit per-gap flow

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-10

**Technical Story:** A scenario sometimes has steps that no available skill can cover. The discovery workflow needed a supported continuation that does not invent skills, silently install them, or treat a keyword-search miss as proof that a capability does not exist.

## Decision Rules

- **MUST:** Treat a capability gap as a property of a step role, not of a whole chain. A proposal may mix existing skills, instruction-only steps, and new locally authored skills.
- **MUST:** Record evidence for each gap: the outcome, the sources searched, the candidates considered, and why an instruction-only step is insufficient.
- **MUST:** Ask the user to decide each gap individually: instruction-only, search again, or author a new skill. Never infer approval from a zero-result search, a proposal, or a previous authoring decision.
- **MUST:** Prefer an instruction-only step when it can bridge the work. Authoring is for repeatable, project-specific procedure or reference material that an instruction cannot carry reliably.
- **MUST:** Stage authored packages under `<project>/.skill-loom-authored/<name>/`, outside every host-discovered skill root.
- **MUST:** Validate the staged package with a deterministic helper and audit only that package with `skill-review`. Treat the audit as advisory, never as a correctness, safety, or security gate.
- **MUST:** Obtain separate approval before installation; install without overwriting; revalidate the installed fingerprint; refresh the catalog; and re-resolve every step name.
- **MUST:** Bound authoring to at most three new skills per chain and stop on a name collision or new ambiguity.
- **MUST NOT:** Install a package automatically, install a partial package, or invalidate the existing steps when authoring, audit, or installation fails.
- **MUST NOT:** Treat `skill-review`'s score as approval to install or run anything.
- **MUST NOT:** Extend the managed discovery-workspace result model to locally authored skills until that workspace has a reachable create/preview/import surface and a reviewed local-origin binding. The project-local and handoff flows are the supported paths.

## Considered Options

- Automatically author a skill whenever the catalog search returns no match.
- Refuse the chain and tell the user to come back with a skill.
- Add an explicit per-gap authoring branch with staging, review, and install approval.

## Decision Outcome

Chosen option: "Explicit per-gap authoring branch." Discovery proposes a mixed chain and marks each step's origin. A gap is closed only after the user chooses to author that gap, the package is staged and audited, the user approves installation, and the catalog is refreshed. The final chain review shows `remote@<revision>`, `project`, `authored` with a local fingerprint, or `instruction`.

The standalone handoff builder accepts reviewed local packages through `localSkills` entries, bounded by the declared project root and a reviewed fingerprint. This keeps one bundle path for remote candidates and authored packages.

### Consequences

- The workflow can finish a greenfield or partially covered scenario without inventing capabilities or installing unreviewed prompt content.
- Authoring adds review steps: the interview, the package inventory, the advisory audit, the install approval, and the catalog refresh.
- A failed gap does not discard the resolved part of the chain; instruction-only remains available.
- Managed discovery workspaces cannot yet carry authored skills. That remains a documented gap rather than a partially enforced behavior.
- Maintainers must keep the authored-skill helper, bundle validator, mirrors, and packaged archives in sync.

## Links

- Related: [ADR-0003](0003-model-invoked-skill-prompts.md), [ADR-0012](0012-shared-project-skill-installation-root.md), [ADR-0013](0013-deterministic-chain-bundle-skill-resolution.md), [ADR-0019](0019-project-independent-chain-drafts.md), [ADR-0021](0021-validated-project-independent-discovery-handoff.md), [ADR-0022](0022-managed-interactive-scenario-discovery.md), and [ADR-0027](0027-cli-and-skill-driven-workflow.md).
