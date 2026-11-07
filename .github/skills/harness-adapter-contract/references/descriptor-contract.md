# Descriptor Contract

> Load when defining the adapter interface, adding a capability field, or reviewing harness isolation.

## Interface

```ts
export interface HarnessDescriptor {
  id: "opencode" | "copilot";
  displayName: string;
  executable: string;
  discovery: "filesystem" | "cli-json";
  supportedSessionModes: Array<"shared" | "fresh" | "fork">;
  nativeAgentSelection: { interactive: boolean; headless: boolean };
  nativeFork: boolean;
  trust: "none" | "folder-dialog";
  automaticAdvancement: "osc-working-idle" | "process-exit";
  automaticPermissions: string[];
  buildInteractive(input: StepInvocation): SpawnSpec;
  buildHeadless(input: StepInvocation): SpawnSpec;
}

export interface SpawnSpec {
  executable: string;
  args: string[];
  cwd: string;
}
```

`StepInvocation` carries the assembled prompt, session id, project directory, session mode, the per-chain permission opt-in, and an optional selected native-agent name. It never carries a shell string.

## Field rules

| Field | Rule |
|-------|------|
| `executable` | Absolute path resolved from config override then `PATH`; never a bare command at spawn time |
| `discovery` | `filesystem` for OpenCode, `cli-json` for Copilot |
| `supportedSessionModes` | Modes the descriptor can actually honor; preflight blocks anything else |
| `nativeAgentSelection` | Whether each command surface can explicitly select a project-native agent; preflight blocks unsupported surfaces |
| `nativeFork` | True only when the CLI exposes a real fork flag |
| `trust` | `folder-dialog` means preflight must resolve or block |
| `automaticAdvancement` | The only signal the automatic runner may consume |
| `automaticPermissions` | Exact flags, shown at preflight and run start, default empty |

## Resolution order

1. Skill Loom config `harnessCommands[id]` when present.
2. `PATH` entries in order.
3. Typed `HARNESS_UNAVAILABLE` with the install command and the attempted override.

Do not fall back to a different harness, a bundled binary, or a shell lookup.

## Capability reporting

Preflight reports the resolved path, version, supported modes, fork mechanism, native-agent command-surface support, trust state, and permission flags. Route and UI code receive these values as data; they must not import a harness module or compare `harness === "copilot"`.

## Version handling

The v1 target is OpenCode 2.2.5 and Copilot CLI 1.0.105. If a probe reports a different version, keep the descriptor in one place and add a version note to the block or warning. Never silently drop an unsupported flag. Native-agent `--agent` argument support must be verified against both target versions before release; local binaries with different versions are not sufficient evidence.
