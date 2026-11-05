---
name: playwright-harness-fixtures
description: "Playwright fixture procedure for isolated Skill Loom configuration, temporary projects and skill packages, and fake harness executables that emit OSC working-to-idle or hold for supervised confirmation."
---

# Skill: Playwright Harness Fixtures

Use when writing or repairing Skill Loom browser tests that touch catalog discovery, preflight, chain authoring, or run execution. Every test must run against a temporary project and an isolated `LOOM_CONFIG_DIR`, with a fake harness executable whose signals are accurate enough to catch real advancement bugs.

Load `references/fixture-layout.md` when creating the global setup, temp directories, config file, and skill packages.
Load `references/fake-harness.md` when writing the fake OpenCode/Copilot executable.
Load `references/spec-patterns.md` when writing a spec for catalog, preflight, supervised run, automatic run, or reconnect.

---

## Process

### Step 1: Create one isolated run root

Create a root under the OS temp directory in Playwright global setup and export it to the app and tests:

```ts
const root = await mkdtemp(join(tmpdir(), "loom-e2e-"));
process.env.LOOM_E2E_ROOT = root;
process.env.LOOM_CONFIG_DIR = join(root, "config");
```

Playwright's `webServer` inherits the environment. Set `reuseExistingServer: false` so a developer's running server cannot answer the test. If tests run in parallel, then give each test its own project directory under the root; the server config remains shared.

**Output:** a unique root, isolated config, and a server that starts against it.

### Step 2: Seed the config and harness path

Write the global config before the app starts so discovery and preflight resolve the fake harness:

```json
{
  "version": 1,
  "harnessCommands": {
    "opencode": "/tmp/loom-e2e-XXXX/bin/fake-opencode",
    "copilot": "/tmp/loom-e2e-XXXX/bin/fake-copilot"
  },
  "extraSkillDirectories": [],
  "recentProjects": [],
  "uiPreferences": {}
}
```

Use absolute paths. If the app resolves from `PATH` instead, then prepend the fake `bin` directory to `PATH` as a fallback, but keep the explicit config override for determinism.

**Output:** a valid config with executable fake harness paths.

### Step 3: Seed project-local skills

Create real `SKILL.md` packages in the temporary project:

```text
$ROOT/project-alpha/.opencode/skills/loom-e2e-alpha/SKILL.md
$ROOT/project-alpha/.agents/skills/loom-e2e-alpha/SKILL.md
```

Frontmatter `name` must equal the parent directory. Add a second package with a duplicate name under a different source when testing duplicate badges, and a deliberately malformed package when testing warnings. Include a `.loom/chains` fixture only when the spec needs a pre-saved chain.

**Output:** a project whose catalog is deterministic and whose warnings are intentional.

### Step 4: Write the fake harness

Create an executable Node script with a shebang, `chmod 0o755`, and modes selected by an argument or environment variable:

```js
#!/usr/bin/env node
const mode = process.env.LOOM_FAKE_MODE ?? "auto";
process.stdout.write(`prompt: ${process.argv.slice(2).join(" ")}\r\n`);
if (mode === "fail") process.exit(1);
if (mode === "supervised") { setInterval(() => {}, 1 << 30); }
if (mode === "auto") {
  process.stdout.write("\x1b]7501;state=working\x07");
  setTimeout(() => {
    process.stdout.write("\x1b]7501;state=idle\x07");
    setTimeout(() => process.exit(0), 50);
  }, 150);
}
```

Write OSC bytes directly, not through `console.log`, and keep the process alive in supervised mode so the test must use Done/Next. Load `references/fake-harness.md` for the full script, a Copilot-style exit mode, and a token-echo mode.

**Output:** an executable fake harness that emits a real signal rather than an animation.

### Step 5: Configure Playwright

Set `webServer` to start the app with the isolated environment, and make tests wait for `/api/health` before interacting. Use a project-local `baseURL` and a single browser context per test.

```ts
webServer: {
  command: "npm run dev",
  url: "http://127.0.0.1:7373/api/health",
  reuseExistingServer: false,
  env: {
    LOOM_CONFIG_DIR: process.env.LOOM_CONFIG_DIR!,
    LOOM_PORT: "7373",
  },
}
```

If the port is busy, then fail with a clear message instead of silently reusing another server. Keep the local-only badge assertion in the shell spec.

**Output:** a Playwright config that cannot touch the developer's real config or skills.

### Step 6: Drive the real UI

Open the route through `src/web/App.tsx`, use accessible roles and names, and assert persisted state through the run record or chain API when the UI alone is ambiguous. For terminal output, wait for text rendered by xterm, not for a raw WebSocket frame.

If the spec exercises automatic mode, then assert the step status changes only after the fake harness emits `working` then `idle`. If it exercises supervised mode, then assert the step stays `awaiting-user` until Done and Next. If it exercises a failure, then assert Retry, Skip, and Abort appear and no auto-retry occurs.

**Output:** a spec that proves the user-visible behavior and the underlying signal.

### Step 7: Clean up and verify

Abort any live run, close the browser, and remove the root in global teardown. Ensure the fake harness has exited and no server process remains.

```bash
npx playwright test tests/e2e/<spec>.spec.ts
```

Run the focused spec twice to catch leaked state. If the second run fails, then a fixture, config file, or fake process leaked.

---

## Gotchas

- **Missing execute bit.** A fake harness written with `writeFile` is not executable. `chmod(path, 0o755)` and assert `access(X_OK)`; otherwise the server reports a missing CLI and the test fails for the wrong reason.
- **`console.log` is not OSC.** A newline after the escape sequence or a pretty-printed object can break the parser. Use `process.stdout.write("\x1b]7501;state=working\x07")`.
- **Fake harness exits too early.** In supervised mode the process must stay alive until the test aborts or completes; otherwise the UI shows an exit signal and the test cannot exercise Done/Next.
- **Shared config across parallel tests.** Parallel specs that mutate `recentProjects`, extra directories, or the active-run pointer race each other. Use unique project directories and clear the active run between tests.
- **Reusing a developer server.** `reuseExistingServer: true` can connect to a server with real config and real CLI paths. Keep it false and assert the health response config directory.
- **Waiting on animation.** A test that waits for terminal silence passes even when the runner would hang. Assert the step status and require the fake signal.
- **Second terminal subscriber.** Opening a second terminal page or context for the same run can be rejected by design. Use one subscriber or explicitly detach the first.
- **Leaked supervised process.** A failed assertion before Abort leaves the fake harness running. Register cleanup in `finally` or a fixture teardown.

---

## Validation

After completing the process, verify:

- [ ] The app starts with `LOOM_CONFIG_DIR` under a temporary root and `reuseExistingServer: false`.
- [ ] The config points at absolute fake harness paths and `GET /api/health` reports the isolated config directory.
- [ ] Probe skills have frontmatter `name` matching their parent directory; a malformed package produces a visible warning without hiding valid entries.
- [ ] The fake harness is executable, writes raw OSC, and stays alive in supervised mode.
- [ ] An automatic spec advances only after `working` then `idle`; a supervised spec waits for Done and Next.
- [ ] A failure spec shows Retry, Skip, and Abort and does not auto-retry.
- [ ] The temporary root and all fake processes are removed after success and after failure.
- [ ] `npx playwright test tests/e2e/<spec>.spec.ts` passes twice from a clean temp root.
- [ ] Run the self-check `rg -n "snapshotDir|test-results|LOOM_CONFIG_DIR" playwright.config.ts tests/e2e` and confirm no test points at the real config or a user project.

If a spec passes only on the first run, find the leaked state before adding a retry. If the fake harness is reported missing, check the config path and the execute bit before changing the app.
