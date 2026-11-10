---
name: harness-adapter-contract
description: "Skill Loom harness adapter contract and OpenCode 2.2.5 / Copilot CLI 1.0.105 descriptors covering executable resolution, discovery, session and fork flags, trust behavior, permission scope, and advancement signals."
---

# Skill: Harness Adapter Contract

Use when adding or changing harness behavior for discovery, preflight, prompt assembly, session continuation, or run advancement. All harness-specific commands, flags, trust behavior, and output parsing belong behind this contract so route and UI code never branch on a harness name.

Load `references/descriptor-contract.md` when defining the adapter interface or adding a capability field.
Load `references/opencode-adapter.md` when implementing OpenCode discovery, prompts, sessions, fork, or state parsing.
Load `references/copilot-adapter.md` when implementing Copilot discovery, trust, headless permissions, sessions, or skill observation.

---

## Process

### Step 1: Resolve the executable without a shell

Read the configured override for the harness from Skill Loom config first, then walk `PATH`. Validate with `access(candidate, fs.constants.X_OK)` and return the absolute path:

```ts
function resolveExecutable(name: string, override?: string): string {
  const candidates = override ? [override] : (process.env.PATH ?? "").split(path.delimiter).map((dir) => path.join(dir, name));
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  throw new HarnessUnavailableError(name);
}
```

If an override is set but not executable, then fail with a block naming the override and the manual fix instead of falling through to `PATH`. Never use `exec`, `execSync`, `which`, or a shell string. Record the resolved path for preflight and health output.

**Output:** an absolute executable path or a typed `HARNESS_UNAVAILABLE` block.

### Step 2: Declare the capability descriptor

Every adapter exports the same shape. Load `references/descriptor-contract.md` for the full interface and field semantics.

| Field | OpenCode 2.2.5 | Copilot CLI 1.0.105 |
|-------|----------------|---------------------|
| `id` / display | `opencode` / OpenCode | `copilot` / GitHub Copilot |
| Discovery | Filesystem scan of shared `.agents/skills` and legacy `.opencode/skills` roots | `copilot skill list --json` |
| Session modes | `shared`, `fresh`, `fork` | `shared`, `fresh`, `fork` as handoff |
| Native fork | Yes on `run --fork` | No |
| Trust | None | Interactive folder-trust dialog |
| Automatic signal | `OSC 7501;state=idle` after `working` | Process exit |
| Broad permissions | None | `--allow-all-paths --allow-all-tools` |
| Native agent selection | Headless `run` only | Interactive and headless |

If a capability is unknown, then report it as unsupported and block preflight; do not guess. The descriptor is the only place a harness name may appear in command construction.

**Output:** a frozen descriptor object plus argument builders for interactive and headless modes.

### Step 3: Map discovery to the descriptor

For OpenCode, scan the shared project `.agents/skills`, legacy project `.opencode/skills`, personal `~/.config/opencode/skills`, and each Loom-configured extra directory. For Copilot, invoke `copilot skill list --json` in the project directory with a bounded timeout; keep the CLI authoritative. New Skill Loom project copies and bundle imports use `.agents/skills` for both harnesses. In both cases:

- Preserve the source label and canonical path.
- Return duplicates instead of deduplicating by name.
- Convert a command failure, timeout, invalid JSON, or missing executable into a warning entry, never an empty catalog.

If discovery fails, then return a warning with the command, exit code, and a redacted stderr excerpt; the UI shows an error state, not "no skills".

**Output:** normalized entries with `harness`, `source`, `name`, `description`, `path`, `enabled`, and a stable id.

### Step 4: Build argument arrays

Return an executable plus `string[]`; never return a command line.

```ts
// OpenCode interactive step
["--prompt", prompt, "--session", sessionId, projectDir]

// OpenCode automatic step with native fork
["run", "--fork", "--session", sessionId, "--prompt", prompt, projectDir]

// Copilot interactive step
["-i", prompt, "--session-id", uuid, projectDir]

// Copilot headless step, only with the per-chain opt-in
["-p", prompt, "--session-id", uuid, "--allow-all-paths", "--allow-all-tools", projectDir]
```

When a chain selects a native agent, pass its exact name with `--agent <name>` only on surfaces declared by the adapter. OpenCode's interactive surface has no supported selector and must block selected-agent chains; OpenCode headless and Copilot surfaces use the adapter's native selection capability.

Confirm the exact flags against the installed version before shipping; the table is the v1 contract, not a substitute for `--help`. If a flag is unavailable, then fail preflight with the installed version and the unsupported capability instead of silently dropping it.

**Output:** `{ executable, args }` for the selected mode and session plan.

### Step 5: Encode session, fork, trust, and permissions

Plan sessions from `shared`, `fresh`, and `fork`:

- `shared`: reuse one session id for every step.
- `fresh`: create a new id per step.
- `fork`: use native fork only when the descriptor says `nativeFork: true`; otherwise produce a deterministic handoff note and report the mechanism as `handoff`.

For Copilot, persistent trust is read from `~/.copilot/config.json`. The server never writes that file. A trust session starts with no prompt; verify re-reads the trusted-folder entry and closes only on success. `--trust-folder` applies to one prompt-mode session and conflicts with `--session-id`, so never combine them.

For automatic Copilot, broad flags are allowed only when `automaticPermissionOptIn` is true on the chain. Preflight and run start must display the exact flags. For OpenCode, no broad permission flag is required in v1.

**Output:** a session/fork/trust/permission plan that preflight can render and the runner can execute.

### Step 6: Expose the advancement signal

The descriptor reports what advances a step, and the runner consumes only that signal:

- OpenCode automatic: `OSC 7501;state=working` then `state=idle` in the same step. `idle` without `working` must not advance.
- Copilot automatic: process exit; non-zero exit fails.
- Supervised: never advance on process exit; wait for the user.

If the signal is missing within the configured timeout, then pause with a failure. Do not substitute output-idle, animation quiescence, or a fixed sleep.

**Output:** a signal enum (`osc-working-idle`, `process-exit`, `user-only`) consumed by the run state machine.

### Step 7: Verify the descriptor

Run the adapter unit suite, then confirm the live CLI still matches the descriptor before relying on it:

```bash
npx vitest run tests/unit/harness-registry.test.ts
opencode --version
copilot --version
```

If the installed version differs from 2.2.5 or 1.0.105, then run the live probes from the `live-harness-verification` skill before changing a flag.

---

## Gotchas

- **`--trust-folder` conflicts with `--session-id`.** Copilot applies the trust flag to one prompt-mode session and rejects the combination with a session id. Establish persistent trust first, then use the session id.
- **Interactive OpenCode has no fork flag.** Only the `run` subcommand exposes `--fork`. Do not pass `--fork` to the interactive entry point and do not claim a native fork where it is unavailable.
- **Copilot has no native fork at all.** Report `fork` as a handoff note built from the previous step's label, skill, instruction, status, and bounded tail.
- **Shell-free resolution.** `execSync("which …")` breaks when `PATH` contains spaces and shells out needlessly. Walk `PATH` and check `X_OK`.
- **Discovery failure is not an empty catalog.** A missing executable, timeout, or invalid JSON must surface a warning and an error state so the user does not mistake a broken CLI for "no skills installed".
- **Trust config is read-only to Skill Loom.** Detect `trustedFolders` in `~/.copilot/config.json`; never write it. A prompt queued during the trust dialog can be swallowed.
- **Broad permissions are opt-in only.** `--allow-all-paths --allow-all-tools` never appear without a per-chain opt-in and must be shown verbatim at preflight and run start.
- **Native agents stay harness-specific.** Bind the exact remote snapshot to the chain, copy it only to its native project directory, verify its fingerprint at preflight, and block surfaces without a verified selector. Never translate or silently omit an agent.
- **OpenCode skill firing is not observable.** Interactive OpenCode exposes no `skill(name)` equivalent; record `not-observable` rather than inventing a match.

---

## Validation

After completing the process, verify:

- [ ] Both adapters expose the same descriptor fields and return `{ executable, args }` arrays with no shell string.
- [ ] A configured override that is not executable blocks with the override path, while a missing binary blocks with the install command.
- [ ] `shared`, `fresh`, and `fork` plans select the documented session id behavior; Copilot fork reports `handoff`.
- [ ] `--trust-folder` is never emitted together with `--session-id`.
- [ ] Copilot broad flags appear only when the chain opt-in is true and are identical in preflight and run construction.
- [ ] Native-agent selection is fingerprint-verified and passed only through target-version-verified `--agent` surfaces.
- [ ] `npx vitest run tests/unit/harness-registry.test.ts` passes.
- [ ] Run the self-check `rg -n "opencode|copilot" src/server/routes src/web | rg -v "harness/|types|test"` and confirm no route or UI branches on a harness name.

If the adapter test fails on an unsupported mode, fix the descriptor rather than adding a route-level exception. If the live CLI rejects a flag, record the installed version in the block and update the descriptor in one place.
