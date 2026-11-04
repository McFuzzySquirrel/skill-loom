import { defineConfig } from 'vitest/config';

/**
 * Unit and integration suites run in Node. Browser coverage belongs to
 * Playwright (playwright.config.ts) and is intentionally excluded here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
