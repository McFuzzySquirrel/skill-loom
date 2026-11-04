# Fixture Layout

> Load when creating the Playwright global setup, temp root, config, project, or skill packages.

## Directory layout

```text
$ROOT/
├── config/
│   └── config.json
├── bin/
│   ├── fake-opencode      # chmod 0755
│   └── fake-copilot
└── projects/
    ├── project-alpha/
    │   ├── .opencode/skills/slan-e2e-alpha/SKILL.md
    │   ├── .agents/skills/slan-e2e-alpha/SKILL.md
    │   └── .slan/
    └── project-bravo/
```

## Global setup

```ts
// tests/e2e/global-setup.ts
import { mkdir, mkdtemp, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default async function globalSetup() {
  const root = await mkdtemp(join(tmpdir(), "slan-e2e-"));
  process.env.SLAN_E2E_ROOT = root;
  process.env.SLAN_CONFIG_DIR = join(root, "config");
  await mkdir(process.env.SLAN_CONFIG_DIR, { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(join(root, "config", "config.json"), JSON.stringify({
    version: 1,
    harnessCommands: {
      opencode: join(root, "bin", "fake-opencode"),
      copilot: join(root, "bin", "fake-copilot"),
    },
    extraSkillDirectories: [],
    recentProjects: [],
    uiPreferences: {},
  }, null, 2));
  // write and chmod fake harnesses, then seed projects
  return root;
}
```

`globalTeardown` reads `SLAN_E2E_ROOT` and removes it. Register cleanup even when setup fails partway.

## Config rules

- Absolute fake harness paths, not bare names.
- Empty `extraSkillDirectories` unless the spec adds one.
- Empty `recentProjects` unless the spec asserts ordering.
- No credential-like fields; the schema rejects them.

## Project rules

- One project directory per spec or per worker.
- Probe skill `name` equals its parent directory.
- Include a duplicate-name package only when testing collision badges.
- Include a malformed package only when testing warnings.
- Do not pre-create `.slan/runs` unless the spec tests recovery.

## Cleanup rules

- Abort any active run before removing the root.
- Wait for the fake process to exit; kill it if it ignores the abort.
- Remove the root recursively.
- Fail teardown with the path if removal fails.
