# OpenCode Adapter (2.2.5)

> Load when implementing OpenCode discovery, prompt construction, session continuation, fork behavior, or terminal-state parsing.

## Discovery

Scan these roots recursively for packages containing `SKILL.md`:

1. `<project>/.agents/skills` (shared project root)
2. `<project>/.opencode/skills` (legacy OpenCode root)
3. `~/.agents/skills` (shared personal root)
4. `~/.config/opencode/skills` (OpenCode personal root)
5. Each Loom-configured extra directory

Parse YAML frontmatter with the `yaml` package. Require a nonempty `name`; if it is absent, fall back to the directory name and attach a warning. Keep `description`, `source`, `canonicalPath`, and `harness: "opencode"`. Do not execute a skill or infer a description with a model.

There is no verified stable config key for additional native OpenCode skill directories in v1. Scan only the documented roots plus Loom extras until a key is verified.

## Commands

| Purpose | Command shape |
|---------|---------------|
| Interactive step | `opencode --prompt "<text>" <projectDir>` |
| Session continuation | `opencode ... --session ses_...` |
| Native fork (run subcommand) | `opencode run --fork ...` |
| Discovery probe | filesystem scan; no CLI prompt |

Build arguments as an array. The prompt is one argument, even when it contains newlines or quotes.

## Terminal state

OpenCode emits `OSC 7501;state=working|idle|clear` with an optional `id=ses_...`. Parse across chunk boundaries and ignore unrelated ANSI. The automatic runner advances only on `idle` after `working` in the same step; `clear` resets the observation.

## Sessions

- `shared`: one `ses_...` for every step.
- `fresh`: a new session per step.
- `fork`: native `run --fork` where exposed; interactive entry has no fork flag, so report the fallback for supervised runs.

## Skill observation

Interactive OpenCode exposes no visible `skill(name)` line equivalent. Record `not-observable`; never block or fail a step on an absent observation.

## Verification

```bash
opencode --version
npm run test:live:discovery
npm run test:live:execution
```

If the version is not 2.2.5, probe the flags before changing the descriptor. If a probe fails, capture the exact command, exit code, and redacted stderr in `docs/evidence/`.
