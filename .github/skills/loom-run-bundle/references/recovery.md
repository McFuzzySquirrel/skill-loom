# Portable run recovery

Portable run documents live in `<project>/.loom/portable-runs/`, separate from Skill Loom's native run store and global active-run pointer. They contain frozen inputs and bounded agent-reported summaries; the directory is Git-ignored.

If a previous helper left `.loom/.gitignore` as a quoted JSON string, inspect and
repair it manually so it contains separate `runs/` and `portable-runs/` lines.
Check the Git index as well: ignore rules do not untrack files already staged or
committed. Do not copy run documents or their inputs into a repair report.

Use `status` before taking any recovery action. A run left in `running` is uncertain. Confirm that the earlier host work has stopped, then call `resume` with the current revision and `stoppedConfirmed: true` to mark its active attempt interrupted. This confirmation is an operator assertion, not a process check. A separate decision is then required:

- `retry`: start a new attempt; changes from the earlier attempt may remain.
- `done`: record the previous attempt as complete after reviewing the actual work.
- `failed`: record the previous attempt as failed and leave the run paused.

For a deliberately paused run with no interrupted attempt, choose `continue` to make the next step eligible. No resume decision dispatches work by itself. A subsequent supervised step still requires its own confirmation.

Current helpers reject new preparation or step execution while another portable
run is unfinished. Finish or explicitly abort that run first; a running attempt
must be reconciled before it can be aborted. Conflict checks fail closed on
unsafe or corrupt records and are bounded to 1,000 other records and 64 MiB.
Archive completed records only after ensuring no helper can access them, and
never overwrite or delete corrupt records as a shortcut. This check does not
coordinate managed runs or older helpers.

If installed files differ from their recorded fingerprints, stop and review the package before creating a new run. A stale `.lock` means another process may still be mutating state; ensure all helpers have stopped and no new helper can start before removing the exact lock file. Never delete existing project skills as a recovery shortcut.
