---
id: ADR-0017
applies_to:
  - "src/server/config/schema.ts"
  - "src/server/projects/registry.ts"
  - "src/server/runs/test-workspaces.ts"
  - "src/server/runs/orchestrator.ts"
status: Accepted; web UI superseded in part by ADR-0027 and ADR-0028
---

# ADR-0017: Run chain tests in managed disposable workspaces

- **Deciders:** McFuzzySquirrel and the Skill Loom agent team
- **Date:** 2026-11-07

**Technical Story:** Let users test a saved chain without running its file-producing steps in the original project, while retaining enough ownership metadata for inspection, recovery, and explicit cleanup.

## Workspace Rules

- **MUST:** Create each test in a unique directory below the configured Loom storage root and materialize only the selected chain and packages needed for that chain.
- **MUST:** Register the directory as a managed project for normal preflight, harness execution, and run recovery, while excluding it from the ordinary recent-project list.
- **MUST:** Retain completed, failed, and interrupted workspaces until the user explicitly removes them.
- **MUST:** Refuse cleanup while the global active-run pointer identifies the workspace.
- **MUST:** Keep workspace ownership in versioned global configuration and never accept a filesystem path from a client as workspace identity.
- **MUST NOT:** Treat a separate working directory as an operating-system security sandbox or silently widen harness permissions.
- **MUST NOT:** Remove the source project, chain templates, remote snapshots, or another workspace during cleanup.

## Verify

- **Check:** `npx vitest run tests/unit/test-workspaces.test.ts tests/integration/test-workspace-routes.test.ts tests/unit/config.test.ts tests/unit/project-registry.test.ts`
- **Expected:** Workspace creation materializes an independent chain project, hides it from recent projects but retains it for recovery, active-run cleanup is refused, and explicit cleanup leaves the original chain intact.
- **Check:** `npm run typecheck`
- **Expected:** The workspace lifecycle uses the existing chain, project, catalog, and run contracts without introducing a second runner or client-supplied path.

## Context and Problem Statement

Chains can write files while running. Running a test in the selected source project can pollute that project and make cleanup ambiguous. A raw temporary directory is insufficient because Skill Loom's existing run orchestration needs a registered project for preflight, persisted run records, and restart recovery.

## Decision Drivers

- Keep test outputs separate from the source project.
- Reuse the existing run lifecycle, permission checks, active-run ownership, and recovery.
- Retain outputs after completion and interruption so users can inspect them.
- Make cleanup explicit, ownership-checked, and safe for active processes.

## Considered Options

- Run tests directly in the selected project and ask users to clean up outputs.
- Use an unregistered temporary directory with a second runner.
- Create a managed project under Loom storage and reuse the normal orchestrator.

## Decision Outcome

Chosen option: "Create a managed project under Loom storage and reuse the normal orchestrator." The project registry records an ownership marker so normal recent-project UI hides these workspaces while run recovery continues to enumerate all known projects. A separate configuration record binds the workspace id to its project id and source chain. The test-workspace API accepts registered project and chain ids, never an arbitrary path.

Workspaces are retained until explicit cleanup. Cleanup validates the managed root and project ownership and refuses to remove the directory while the active-run pointer points to it. This is file isolation only; the harness still has its ordinary access to filesystem paths, network resources, and authentication available to its process.

### Positive Consequences

- Chain tests do not write into the original project's working directory.
- Existing preflight, runner, terminal, and interruption recovery remain the execution authority.
- Users can inspect retained outputs before explicitly deleting a workspace.

### Negative Consequences

- Retained workspaces consume disk until users remove them.
- A process running inside the workspace is not confined to that directory by an operating-system sandbox.
- Workspace cleanup and project registration require consistent ownership records in both global config and the project registry.

## Links

- Related: [ADR-0004](0004-frozen-run-snapshots-and-bounded-tails.md), [ADR-0006](0006-single-active-run-and-interrupt-recovery.md), and [ADR-0016](0016-pinned-native-agent-selection.md).
- Implemented by the managed workspace service, route, project registry, and workflow designer.
- Regression coverage: `tests/unit/test-workspaces.test.ts` and `tests/integration/test-workspace-routes.test.ts`.
