---
id: ADR-0014
applies_to:
  - "src/portable/**"
  - ".github/skills/loom-run-bundle/**"
  - "src/server/routes/portable-skill.ts"
status: Accepted
---

# ADR-0014: Execute exported chains through a standalone agent skill

Exported v1 and v2 bundles can be inspected inside an existing Agent Skills-compatible host using a bundled Node.js helper, without starting Skill Loom or a second harness CLI. Portable runs use their own project-local state because the host executes tools directly and reports outcomes itself; they must not be represented as native PTY runs or advance on claimed harness process signals. Supervised per-step confirmation is the default, and any host/session mismatch or non-native fresh/fork approximation requires explicit consent. A v2 chain that selects a native agent cannot be prepared by the portable helper because the current conversation cannot switch agents; import it into Skill Loom for execution with that selection.
