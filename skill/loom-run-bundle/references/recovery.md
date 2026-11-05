# Portable run recovery

Portable run documents live in `<project>/.loom/portable-runs/`, separate from Skill Loom's native run store and global active-run pointer. They contain frozen inputs and bounded agent-reported summaries; the directory is Git-ignored.

Use `status` before taking any recovery action. A run left in `running` is uncertain. `resume` marks its active attempt interrupted and requires a separate decision:

- `retry`: start a new attempt; changes from the earlier attempt may remain.
- `done`: record the previous attempt as complete after reviewing the actual work.
- `failed`: record the previous attempt as failed and leave the run paused.

For a deliberately paused run with no interrupted attempt, choose `continue` to make the next step eligible. No resume decision dispatches work by itself. A subsequent supervised step still requires its own confirmation.

If installed files differ from their recorded fingerprints, stop and review the package before creating a new run. Do not repair a corrupt/unsupported run file by overwriting it. A stale `.lock` means another process may still be mutating state; confirm it has exited before removing the exact lock file. Never delete existing project skills as a recovery shortcut.
