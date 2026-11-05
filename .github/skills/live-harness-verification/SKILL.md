---
name: live-harness-verification
description: "Live OpenCode 2.2.5 and Copilot CLI 1.0.105 probe procedure using temporary projects, isolated COPILOT_HOME and LOOM_CONFIG_DIR, session-continuation token recall, and privacy-safe evidence JSON."
---

# Skill: Live Harness Verification

Use when writing, running, or repairing `scripts/live-discovery.ts`, `scripts/live-execution.ts`, or the evidence under `docs/evidence/`. The probes exist to prove real CLI behavior that mocks cannot: discovery formats, trust gates, session continuation, the OpenCode idle signal, and Copilot headless permissions.

Load `references/probe-isolation.md` when setting up the temporary project, environment, and cleanup.
Load `references/harness-probes.md` when constructing OpenCode or Copilot commands and assertions.
Load `references/evidence-schema.md` when writing or reviewing the evidence files.

---

## Process

### Step 1: Freeze the prerequisites

Record the exact versions and fail early with an actionable message:

```bash
node --version
opencode --version
copilot --version
```

Expect Node 24+, OpenCode 2.2.5, and Copilot CLI 1.0.105. If a CLI is missing, then exit non-zero with the install or upgrade command; do not skip the harness and still report a pass. If a version differs, then probe the flags before trusting them and record the observed version in evidence.

Do not make a paid model call in the discovery probe. Authentication checks use local output, environment-token presence, and config-file evidence only.

**Output:** a prerequisite record or a non-zero exit naming the missing tool.

### Step 2: Isolate state

Create one temporary root and set both environment variables before any harness call:

```bash
export LOOM_CONFIG_DIR="$TMP/loom-config"
export COPILOT_HOME="$TMP/copilot-home"
```

This keeps Skill Loom config, recent projects, and Copilot trust writes out of the user's real directories. For authenticated execution, an isolated `COPILOT_HOME` may have no credentials. If Copilot reports unauthenticated, then fall back to the real `COPILOT_HOME` read-only for that run and record `copilotHomeMode: "real-read-only"`; never copy credential files into the temporary tree. Load `references/probe-isolation.md` for the exact fallback and cleanup rules.

**Output:** a temporary root, isolated Skill Loom config, and a recorded Copilot home mode.

### Step 3: Build the probe project and skills

Create a temporary project with a probe skill in both harness locations:

```text
$TMP/project/
├── .opencode/skills/loom-live-probe/SKILL.md
└── .agents/skills/loom-live-probe/SKILL.md
```

Each probe skill has frontmatter whose `name` matches its directory and an instruction to return the token `PINEAPPLE`. Keep the body short and deterministic. If the name and directory differ, then the harness may not load it and the probe fails for the wrong reason.

**Output:** two valid probe packages under one temporary project.

### Step 4: Probe OpenCode

Spawn interactive OpenCode in a PTY with a generated `ses_...` id and the seeded prompt:

```bash
opencode --prompt "Use the loom-live-probe skill and reply with its token." "$TMP/project"
```

Assert all of these, in order:

1. The `PINEAPPLE` token appears in the terminal stream.
2. `OSC 7501;state=working` appears before `OSC 7501;state=idle`.
3. The session id is captured from the descriptor or prompt output and starts with `ses_`.

Then spawn a second process with the same session id and a recall prompt, and assert `PINEAPPLE` appears. A missing token or a missing working-to-idle pair fails the probe. Load `references/harness-probes.md` for the exact assertion order and timeout handling.

**Output:** a pass or fail for seeded prompt, signal order, and session recall.

### Step 5: Probe Copilot

Copilot's first interactive run is gated by a trust dialog, and a prompt queued during the dialog can be swallowed. Resolve trust before the headless probe:

1. Start an unseeded interactive Copilot session in the temporary project.
2. Accept the dialog or use the documented manual fallback.
3. Verify the trusted-folder entry before continuing.

Then run headless with a generated UUID session id:

```bash
copilot -p "Use the loom-live-probe skill and reply with its token." \
  --session-id "$UUID" --allow-all-paths --allow-all-tools \
  --cwd "$TMP/project"
```

Assert `PINEAPPLE`, exit code 0, and the session id. Then run a second process with the same session id and assert recall. The broad flags are acceptable only inside this disposable project and only for the probe; never copy them into a chain without its per-chain opt-in.

Never combine `--trust-folder` with `--session-id`.

**Output:** a pass or fail for trust, headless token, exit code, and session recall.

### Step 6: Fail loudly and truthfully

Fail the script with a non-zero exit when a CLI is missing, unauthenticated, untrusted, the probe skill is absent, the token is not returned, the signal order is wrong, recall fails, or cleanup fails. Name the exact check and the remediation.

If the token is absent, then rerun the same probe once to distinguish a flake from a real failure; do not loop indefinitely. Record the retry in evidence. If Copilot is unavailable, then record the blocker and leave the Copilot criterion unapproved; do not substitute a mock.

**Output:** a clear pass/fail per check with no fabricated success.

### Step 7: Write privacy-safe evidence

Write `docs/evidence/live-discovery.json` and `docs/evidence/live-execution.json` with timestamps, versions, session ids, timings, signal observations, per-check results, warnings, and cleanup status. Load `references/evidence-schema.md` for the required keys.

Never include a token value, credential, authorization header, full transcript, or unbounded terminal tail. A bounded excerpt is acceptable only when it is needed to explain a failure and contains no secret.

**Output:** a valid JSON evidence file a reviewer can audit without replaying the run.

### Step 8: Clean up

Remove the temporary project, config directory, and Copilot home. Kill any surviving harness process. Remove the probe skills with the temporary tree. If cleanup fails, then fail the script and record the path so the user can remove it explicitly.

Run the probes and confirm:

```bash
npm run test:live:discovery
npm run test:live:execution
```

---

## Gotchas

- **Trust dialog swallows the prompt.** A first Copilot run that is still showing the trust dialog can discard the queued prompt and look like a model failure. Resolve trust before step 1.
- **`--trust-folder` conflicts with `--session-id`.** Do not combine them. Establish persistent trust, then use the session id.
- **Isolated `COPILOT_HOME` can drop authentication.** If the isolated home has no credentials, use the real home read-only and record the mode; never copy credential files into the temporary tree.
- **Copilot animation is not idle.** There is no semantic state signal. Advance only on process exit; never add an output-idle wait to the probe.
- **OpenCode idle without working.** A probe that only checks for `idle` can pass while the real runner would not advance. Assert `working` precedes `idle`.
- **Probe name mismatch.** `name` in the probe `SKILL.md` must equal `loom-live-probe`; a JSON-quoted YAML value or a different directory name makes the harness skip it.
- **Leaked transcript.** Writing full stdout to evidence or logs exposes prompts and tool output. Store only bounded, redacted excerpts and never a credential.
- **Cleanup on failure.** An early `process.exit` before `finally` leaves temporary skills and harness processes behind. Register cleanup once, at the top.

---

## Validation

After completing the process, verify:

- [ ] `opencode --version` reports 2.2.5 and `copilot --version` reports 1.0.105, or the difference is recorded with a probe result.
- [ ] The temporary project contains both `loom-live-probe` skills with matching frontmatter names.
- [ ] OpenCode returns `PINEAPPLE`, emits `working` then `idle`, and recalls the token in a second process using the same `ses_` id.
- [ ] Copilot resolves trust, returns `PINEAPPLE` headlessly with exit 0, and recalls the token in a second process using the same UUID.
- [ ] Missing CLI, auth, trust, token, signal, or recall each produce a non-zero exit with a named check.
- [ ] Evidence JSON validates and contains no token value, credential, full transcript, or unbounded tail.
- [ ] The temporary root and every harness process are gone after success and after failure.
- [ ] `npm run test:live:discovery` and `npm run test:live:execution` pass.
- [ ] Run the self-check `rg -n "PINEAPPLE|authorization|api[_-]?key|token" docs/evidence scripts/live-*` and confirm every match is an expected probe constant or a redacted field name, not a secret.

If the OpenCode probe times out while state stays `working`, an approval prompt may be open; treat it as a timeout failure, not a completion. If Copilot recall fails, verify the same UUID was actually passed to both processes before changing the probe.
