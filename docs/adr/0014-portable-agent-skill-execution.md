---
id: ADR-0014
applies_to:
  - "src/portable/**"
  - ".github/skills/loom-run-bundle/**"
status: Accepted
---

# ADR-0014: Execute exported chains through a standalone agent skill

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-05

Exported v1 and v2 bundles can be inspected inside an existing Agent Skills-compatible host using a bundled Node.js helper, without starting Skill Loom or a second harness CLI. Portable runs use their own project-local state because the host executes tools directly and reports outcomes itself; they must not be represented as native PTY runs or advance on claimed harness process signals. Supervised per-step confirmation is the default, and any host/session mismatch or non-native fresh/fork approximation requires explicit consent. A v2 chain that selects a native agent cannot be prepared by the portable helper because the current conversation cannot switch agents; import it into Skill Loom for execution with that selection.

The skill-only workflow is documented in the [standalone skill guide](../standalone-skill-guide.md). The `loom-chain-workflow` skill composes this runner with `scenario-discovery` and optional CLI phases, and it keeps each approval (bundle creation, live test, installation or reuse, execution, automatic progression) separate.

Packages are installed into the target project by default. A host-global package may be reused instead only under the reviewed, fingerprint-bound rules in [ADR-0029](0029-catalog-resolved-global-skill-reuse.md).
