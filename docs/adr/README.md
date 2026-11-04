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
| [ADR-0007](0007-explicit-advancement-signals.md) | Advance automatic steps only on explicit harness signals | Accepted | 2026-11-04 |
| [ADR-0008](0008-session-modes-with-deterministic-handoff.md) | Use session modes with an explicit handoff fallback | Accepted | 2026-11-04 |
| [ADR-0009](0009-read-only-copilot-trust-and-explicit-permissions.md) | Read Copilot trust and require explicit automatic permissions | Accepted | 2026-11-04 |
| [ADR-0010](0010-global-chain-library-snapshots.md) | Store the global chain library as independent snapshots | Accepted | 2026-11-04 |
| [ADR-0011](0011-shell-free-process-and-pty-transport.md) | Spawn harnesses without a shell and keep PTYs server-owned | Accepted | 2026-11-04 |

## Rules

- One row per record, in identifier order, with no gaps in numbering.
- Keep each row's status and date in step with the record they point at.
- When a record is superseded, update its row to `Superseded by ADR-NNNN` and link the replacement in the same row rather than deleting the entry.
- Fill a row from the record itself rather than from memory; the index is a directory, not a summary.
