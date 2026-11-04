# Probe Isolation

> Load when creating the temporary project, setting environment variables, choosing the Copilot home, or cleaning up after a probe.

## Temporary layout

```text
$TMP/
├── project/
│   ├── .opencode/skills/slan-live-probe/SKILL.md
│   └── .agents/skills/slan-live-probe/SKILL.md
├── slan-config/
└── copilot-home/
```

Use a unique directory per run under the OS temp root. Register cleanup immediately:

```ts
const root = await mkdtemp(join(tmpdir(), "slan-live-"));
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await rm(root, { recursive: true, force: true });
}
process.on("exit", () => { /* best-effort sync removal */ });
```

## Environment

| Variable | Value | Why |
|----------|-------|-----|
| `SLAN_CONFIG_DIR` | `$TMP/slan-config` | Keeps recent projects and active-run state out of the real config |
| `COPILOT_HOME` | `$TMP/copilot-home` | Keeps trust and config writes out of `~/.copilot` |

Set both before the first harness call in the process. A child process inherits the environment; do not mutate it after spawn.

## Copilot home fallback

An isolated `COPILOT_HOME` may have no authentication. If the CLI reports unauthenticated:

1. Switch `COPILOT_HOME` to the user's real home for this probe only.
2. Treat it as read-only: do not write config, trust, or credentials.
3. Record `copilotHomeMode: "real-read-only"` and the observed auth evidence in the evidence file.
4. Never copy token files or auth caches into `$TMP`.

For discovery-only probes, keep the isolated home unless the CLI cannot start without auth.

## Probe skill

Both files use the same name and a deterministic token:

```markdown
---
name: slan-live-probe
description: "Live probe skill that returns the token PINEAPPLE when invoked."
---

When invoked, reply with exactly: PINEAPPLE
```

The directory and frontmatter `name` must both be `slan-live-probe`.

## Cleanup rules

- Kill every spawned harness process before removing the tree.
- Remove the probe skills with the tree; never install them into the user's project.
- Do not write into `~/.copilot` or the user's `.opencode/skills`.
- Fail the script if cleanup fails and print the path.
- Keep no transcript; evidence may include bounded, redacted excerpts only.
