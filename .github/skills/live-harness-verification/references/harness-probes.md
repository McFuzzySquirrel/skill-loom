# Harness Probes

> Load when constructing the OpenCode or Copilot probe commands, assertions, or timeout handling.

## OpenCode 2.2.5

```bash
opencode --version
opencode --prompt "Use the loom-live-probe skill and reply with its token." "$TMP/project"
```

Use the interactive entry in a PTY so the state signal is observable. Generate a session id with the `ses_` prefix expected by the CLI, or capture the id the harness returns.

Assertions, in order:

1. Stream contains `PINEAPPLE`.
2. Stream contains `OSC 7501;state=working` before `OSC 7501;state=idle`; a `clear` resets the requirement.
3. Session id is captured and begins with `ses_`.
4. A second process with `--session ses_...` and a recall prompt contains `PINEAPPLE`.

Do not assert skill firing from a log line; OpenCode exposes no equivalent. The token proves the skill was loaded and used.

Timeout: fail after a bounded wait with the last observed state. If state stays `working`, an approval prompt may be open.

## Copilot CLI 1.0.105

Trust first:

```bash
copilot   # no prompt, cwd = $TMP/project
```

Accept the dialog or use the manual fallback, then verify the trusted-folder entry before continuing.

Headless probe:

```bash
copilot -p "Use the loom-live-probe skill and reply with its token." \
  --session-id "$UUID" --allow-all-paths --allow-all-tools \
  --cwd "$TMP/project"
```

Assertions:

1. Exit code 0.
2. Stdout contains `PINEAPPLE`.
3. The UUID passed to the process is recorded.
4. A second process with the same `--session-id` and a recall prompt contains `PINEAPPLE`.
5. `skill(loom-live-probe)` is recorded as observed when present; otherwise record `not-observable`.

Never combine `--trust-folder` with `--session-id`. Never use output-idle or animation quiescence as a completion signal; process exit is the only advancement signal.

## Failure handling

| Check | Failure means | Action |
|-------|---------------|--------|
| CLI missing | Prerequisite absent | Exit non-zero with install command |
| Version differs | Descriptor may be stale | Probe flags, record version, fail if a required flag is gone |
| Token absent | Skill not loaded or model did not follow | Retry once, then fail with bounded excerpt |
| No working→idle | Signal contract broken | Fail; do not substitute output-idle |
| Recall fails | Session id not reused or wrong id | Verify the same id was passed to both processes |
| Trust unresolved | First prompt would be swallowed | Fail with the manual fallback command |

## Evidence excerpts

If a failure needs context, keep at most the last 20 lines, strip ANSI, and redact anything matching a credential or token pattern. Never dump the whole stream.
