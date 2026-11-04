import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser tests must never read or write the developer's real Slan state.
 * Every run gets its own throwaway config directory and home directory.
 */
const isolatedRoot = join(tmpdir(), `slan-playwright-${process.pid}`);
const configDir = join(isolatedRoot, 'config');
const homeDir = join(isolatedRoot, 'home');
const port = 7373;
const baseURL = `http://127.0.0.1:${port}`;

mkdirSync(configDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });

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
      SLAN_CONFIG_DIR: configDir,
      HOME: homeDir,
      SLAN_PORT: String(port),
    },
  },
});
