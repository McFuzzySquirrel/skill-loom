# Architecture Decision Records

*The durable architectural decisions for Skill Loom, one decision per record. Each record states the options considered, the choice, and the consequences accepted. This index is linked from the project README and kept accurate as records are added or superseded.*

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](0001-loopback-only-single-user-server.md) | Bind Skill Loom to loopback with no authentication | Accepted | 2026-11-04 |
| [ADR-0002](0002-harness-capability-descriptors.md) | Put harness differences behind capability descriptors | Accepted | 2026-11-04 |
| [ADR-0003](0003-model-invoked-skill-prompts.md) | Treat skills as model-invoked prompt context | Accepted | 2026-11-04 |
| [ADR-0004](0004-frozen-run-snapshots-and-bounded-tails.md) | Freeze run snapshots and store only a bounded terminal tail | Accepted | 2026-11-04 |
| [ADR-0005](0005-atomic-versioned-json-persistence.md) | Persist versioned JSON with atomic replacement | Accepted | 2026-11-04 |
| [ADR-0006](0006-single-active-run-and-interrupt-recovery.md) | Allow one active run and recover stale records as interrupted | Accepted | 2026-11-04 |
| [ADR-0007](0007-explicit-advancement-signals.md) | Advance automatic steps only on explicit harness signals | Accepted | 2026-11-10 |
| [ADR-0008](0008-session-modes-with-deterministic-handoff.md) | Use session modes with an explicit handoff fallback | Accepted | 2026-11-04 |
| [ADR-0009](0009-read-only-copilot-trust-and-explicit-permissions.md) | Read Copilot trust and require explicit automatic permissions | Accepted | 2026-11-04 |
| [ADR-0010](0010-global-chain-library-snapshots.md) | Store the global chain library as independent snapshots | Superseded by [ADR-0027](0027-cli-and-skill-driven-workflow.md) and [ADR-0028](0028-single-purpose-chain-editor.md) | 2026-11-04 |
| [ADR-0011](0011-shell-free-process-and-pty-transport.md) | Spawn harnesses without a shell and keep PTYs server-owned | Accepted | 2026-11-04 |
| [ADR-0012](0012-shared-project-skill-installation-root.md) | Use a shared project skill installation root | Accepted | 2026-11-05 |
| [ADR-0013](0013-deterministic-chain-bundle-skill-resolution.md) | Resolve bundle skills with project-local precedence | Accepted | 2026-11-05 |
| [ADR-0014](0014-portable-agent-skill-execution.md) | Execute exported chains through a standalone agent skill | Accepted | 2026-11-05 |
| [ADR-0015](0015-pinned-remote-skill-snapshots.md) | Ingest remote skills as pinned immutable snapshots | Accepted | 2026-11-07 |
| [ADR-0016](0016-pinned-native-agent-selection.md) | Select source-pinned native agents through harness capabilities | Accepted | 2026-11-07 |
| [ADR-0017](0017-managed-disposable-test-workspaces.md) | Run chain tests in managed disposable workspaces | Accepted; web UI superseded in part by [ADR-0027](0027-cli-and-skill-driven-workflow.md), [ADR-0028](0028-single-purpose-chain-editor.md) | 2026-11-07 |
| [ADR-0018](0018-version-portable-bundles-for-native-agents.md) | Version portable bundles for native-agent assets | Accepted | 2026-11-07 |
| [ADR-0019](0019-project-independent-chain-drafts.md) | Store project-independent chain drafts separately | Accepted; web UI superseded in part by [ADR-0027](0027-cli-and-skill-driven-workflow.md), [ADR-0028](0028-single-purpose-chain-editor.md) | 2026-11-07 |
| [ADR-0020](0020-local-shared-bundle-library.md) | Publish reviewed bundles to a configured local library | Superseded by [ADR-0027](0027-cli-and-skill-driven-workflow.md) and [ADR-0028](0028-single-purpose-chain-editor.md) | 2026-11-07 |
| [ADR-0021](0021-validated-project-independent-discovery-handoff.md) | Prepare validated discovery handoffs from pinned snapshots | Accepted; web UI superseded in part by [ADR-0027](0027-cli-and-skill-driven-workflow.md), [ADR-0028](0028-single-purpose-chain-editor.md) | 2026-11-08 |
| [ADR-0022](0022-managed-interactive-scenario-discovery.md) | Run scenario discovery in a retained managed workspace | Accepted; web UI superseded in part by [ADR-0027](0027-cli-and-skill-driven-workflow.md), [ADR-0028](0028-single-purpose-chain-editor.md) | 2026-11-08 |
| [ADR-0023](0023-profile-owner-lock.md) | Acquire profile ownership before server recovery | Accepted | 2026-11-08 |
| [ADR-0024](0024-local-control-transport.md) | Authenticate local control of the profile owner | Accepted | 2026-11-08 |
| [ADR-0025](0025-reviewed-cli-approval-contract.md) | Require reviewed digests and explicit confirmations for CLI mutations | Accepted | 2026-11-10 |
| [ADR-0026](0026-bounded-opt-in-workspace-evaluation.md) | Evaluate retained workspaces only with explicit bounded checks | Accepted | 2026-11-10 |
| [ADR-0027](0027-cli-and-skill-driven-workflow.md) | Drive Skill Loom from the CLI and companion skills | Accepted | 2026-11-10 |
| [ADR-0028](0028-single-purpose-chain-editor.md) | Limit the web UI to a visual chain editor | Accepted | 2026-11-10 |
| [ADR-0029](0029-authored-skill-gap-flow.md) | Author missing skills through an explicit per-gap flow | Accepted | 2026-11-10 |

## Rules

- One row per record, in identifier order, with no gaps in numbering.
- Keep each row's status and date in step with the record they point at.
- When a record is superseded, update its row to `Superseded by ADR-NNNN` and link the replacement in the same row rather than deleting the entry.
- Verify commands inside a superseded or partially superseded record may reference retired tests. Prefer the suites named in the current guides and `package.json`; the record explains the decision, not the current test layout.
- Fill a row from the record itself rather than from memory; the index is a directory, not a summary.
