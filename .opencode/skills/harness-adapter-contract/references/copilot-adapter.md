# Copilot CLI Adapter (1.0.105)

> Load when implementing Copilot discovery, trust handling, session continuation, headless permissions, or skill observation.

## Discovery

Invoke `copilot skill list --json` with the project as `cwd`, an executable-plus-array spawn, a bounded timeout, and captured stdout/stderr. Normalize project, personal, plugin, custom, and builtin source labels. Preserve `enabled` and the canonical path when present.

Missing executable, non-zero exit, invalid JSON, and timeout each become a warning entry; none may be reported as an empty catalog.

## Commands

| Purpose | Command shape |
|---------|---------------|
| Interactive step | `copilot -i "<text>"` |
| Headless step | `copilot -p "<text>"` |
| Session continuation | add `--session-id <uuid>` |
| Headless permissions | add `--allow-all-paths --allow-all-tools` only with opt-in |
| Trust | run `copilot` with no prompt in the project |

Do not combine `--trust-folder` with `--session-id`; the trust flag is for one prompt-mode session.

## Trust

The interactive first run in a folder is gated by a trust dialog. Persistent trust is recorded under `trustedFolders` in `~/.copilot/config.json`. Slan reads that file and never writes it.

Trust flow:

1. Start an unseeded interactive Copilot PTY in the project.
2. The user accepts the dialog in the embedded terminal.
3. Verify re-reads `trustedFolders` for the canonical project path.
4. On success, close the trust session. On failure, return the exact manual command and keep the folder blocked.

A prompt queued during the trust dialog can be swallowed, so preflight must resolve trust before step 1.

## Advancement and observation

Copilot emits no semantic working/idle state, and TUI animation makes output-idle unreliable. Automatic Copilot advances only on process exit. Non-zero exit fails the step.

`skill(name)` log lines are the best-effort observation signal. Record `observed` with the name when present, otherwise `unknown`; never block on it.

## Headless permissions

`--allow-all-paths --allow-all-tools` are broad. They appear only when the chain has `automaticPermissionOptIn: true`, and the exact flags must be shown at preflight and on every automatic run. Default is off.

## Verification

```bash
copilot --version
npm run test:live:discovery
npm run test:live:execution
```

If trust cannot be established, record the blocker and do not approve the Copilot criterion. Do not substitute a mock for the live probe.
