# Paths and Schemas

> Load when you need the exact Skill Loom storage layout, identifier rules, or versioned document shape.

## Storage layout

| Document | Path | Notes |
|----------|------|-------|
| Global config | `$LOOM_CONFIG_DIR/config.json` or `~/.config/loom/config.json` | Created on first read; never stores a credential value |
| Active run pointer | `$LOOM_CONFIG_DIR/active-run.json` | At most one active run across the whole server |
| Chain | `<canonicalProject>/.loom/chains/<chainId>.json` | Project-local, reviewable in git |
| Run | `<canonicalProject>/.loom/runs/<runId>.json` | `runs/` is listed in `<project>/.loom/.gitignore` |
| `.loom` guard | `<canonicalProject>/.loom/.gitignore` | Created only when absent; contains `runs/` |

`LOOM_CONFIG_DIR` must be honored by every store operation, including the active pointer. Unit tests inject a temporary directory, and integration tests start the app with an isolated directory.

## Identifier rules

- Chain and run ids: lowercase letters, digits, `_`, and `-`; first character is a letter or digit; maximum 64 characters.
- Step ids and input names: stable, unique within the document, and safe to interpolate into a prompt.
- Project id: derived on the server from the canonical project path. Never accept a client path as an id.
- Reject `..`, `/`, `\`, NUL, absolute paths, and percent-encoded separators before constructing a filename.

## Global config schema

```ts
const ConfigSchema = z.object({
  version: z.literal(1),
  harnessCommands: z.object({
    opencode: z.string().optional(),
    copilot: z.string().optional(),
  }),
  extraSkillDirectories: z.array(z.string()).default([]),
  recentProjects: z.array(z.object({
    id: z.string(),
    canonicalPath: z.string(),
    displayName: z.string(),
    lastOpenedAt: z.string().datetime(),
  })).default([]),
  uiPreferences: z.record(z.string(), z.unknown()).default({}),
});
```

A config read-modify-write must preserve fields another feature owns. Parse the whole file, change only the target field, validate again, then write atomically.

## Chain document shape

Required fields: `version`, `id`, `name`, `harness`, `sessionMode`, ordered `steps`, `inputs`, `automaticPermissionOptIn`, `createdAt`, `updatedAt`. Each step carries a stable `id`, `skill`, required `instruction`, and optional `label`. A chain is bound to exactly one harness; never add a per-step harness field.

Validation is not only shape: nonempty name and steps, unique step ids, unique input names, known harness and session mode, and every `{{name}}` placeholder resolving to a declared input. Placeholder validation failures are 422 field errors, not corrupt-file warnings.

## Run document shape

Required fields: `version`, `id`, `projectId`, `chainId`, `harness`, `mode`, `sessionMode`, frozen `chainSnapshot`, `resolvedInputs`, `status`, `currentStepIndex`, timestamps, `sessionId`, `forkMechanism`, and per-step records. A step record holds status, timestamps, exit code, session id, observation state, and a bounded tail.

The snapshot is a deep clone taken at run creation. Editing the saved chain afterwards must not change the run, and retry uses the snapshot. Cap the tail at 200 lines or 32 KiB. There is no field for a full transcript; do not add one.

## Migration rules

- Current version is literal `1` until a deliberate migration exists.
- An unknown version returns `UNSUPPORTED_VERSION` with the path and observed version.
- A new optional field defaults in the schema; a new required field needs a migration that writes the old value before validation passes.
- Never migrate on a read that is supposed to be side-effect free. Migrate through an explicit write path or startup routine.
