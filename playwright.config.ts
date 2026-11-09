import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Browser tests must never read or write the developer's real Skill Loom state.
 * Every run gets its own throwaway config directory and home directory.
 */
const isolatedRoot = mkdtempSync(join(tmpdir(), 'loom-playwright-'));
const configDir = join(isolatedRoot, 'config');
const homeDir = join(isolatedRoot, 'home');
const fakeBinDir = join(isolatedRoot, 'bin');
const port = 7373;
const baseURL = `http://127.0.0.1:${port}`;

mkdirSync(configDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });
mkdirSync(fakeBinDir, { recursive: true });
const unavailableHarness = `#!${process.execPath}\nprocess.stderr.write('No fake harness is configured for this test.\\n');\nprocess.exitCode = 1;\n`;
for (const name of ['opencode', 'copilot']) {
  writeFileSync(join(fakeBinDir, name), unavailableHarness, { mode: 0o755 });
}
process.once('exit', () => {
  try {
    rmSync(isolatedRoot, { recursive: true, force: true });
  } catch (error) {
    console.error(`Could not remove the isolated Playwright root: ${isolatedRoot}`, error);
    process.exitCode = 1;
  }
});

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Exercise the built app behind the real single-origin Fastify server.
    command: 'npm run build && npm run start',
    url: baseURL,
    // Never attach to a developer's running instance: that would use the real
    // config directory and defeat the isolation guarantee.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      LOOM_CONFIG_DIR: configDir,
      HOME: homeDir,
      LOOM_PORT: String(port),
      // A spec may place deterministic harness executables here. The server
      // resolves the default `opencode` / `copilot` names through PATH for
      // catalog discovery, so a config-only override is not enough.
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ''}`,
    },
  },
});
