# Corruption and Recovery

> Load when a read fails, a list contains a corrupt item, startup finds stale active records, or a repair is requested.

## Diagnose first

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `Unexpected token` from `JSON.parse` | Truncated or hand-edited file | Report `CORRUPT_*`; do not rewrite |
| Schema issue on a known field | Old version or manual edit | Report `UNSUPPORTED_VERSION` or field path; offer explicit migration |
| List endpoint returns fewer items | Corrupt sibling | Keep valid items, attach a warning |
| Every start returns 409 | Stale `active-run.json` | Mark the referenced run `interrupted`, then clear the pointer |
| Config lost harness paths | Self-healing loader overwrote it | Stop the loader from writing on read; recover from backup or user input |

## Quarantine on read

Quarantine means the item is excluded from normal use and reported, not silently deleted or renamed:

```json
{
  "code": "CORRUPT_CHAIN",
  "message": "Chain file could not be parsed",
  "details": { "path": "/repo/.slan/chains/abc.json", "issue": "Unexpected end of JSON input" }
}
```

Never move, rename, or delete the user's file automatically. A user-initiated repair may write a timestamped backup beside the original before rewriting, and only after showing the affected path.

## Startup reconciliation

1. Read the run index under `<project>/.slan/runs`.
2. For each record in `starting`, `running`, `paused`, or `awaiting-user`, set `status: "interrupted"` and write atomically.
3. Read `<configRoot>/active-run.json`.
4. If it references a run that is now `interrupted`, clear the pointer.
5. If the config or a run file is corrupt, report it and leave recovery to the user.

The run view then offers Retry interrupted step, Continue from next pending step, and Restart chain. Never auto-replay a step on startup.

## Repair checklist

- [ ] The corrupt path and parse issue are shown to the user.
- [ ] Valid sibling chains or runs remain available.
- [ ] No automatic delete, rename, or overwrite occurred.
- [ ] A backup or explicit confirmation exists before any rewrite.
- [ ] The repaired document validates against the current version.
