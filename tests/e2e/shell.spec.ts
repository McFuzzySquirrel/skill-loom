import { expect, test, type Page } from '@playwright/test';

interface ShellRoute {
  path: string;
  heading: string;
}

const shellRoutes: ShellRoute[] = [
  { path: '/projects', heading: 'Projects' },
  // The builder now loads live catalog data. Use the unsaved-draft route so the
  // shell check does not depend on a registered chain, and fulfill the catalog
  // request with an empty isolated result below.
  { path: '/projects/demo-project/chains/new', heading: 'Chain authoring' },
  { path: '/projects/demo-project/chains/demo-chain/run', heading: 'Run start' },
  { path: '/runs/demo-run', heading: 'Run view' },
];

const EMPTY_CATALOG = {
  harness: 'opencode',
  query: '',
  total: 0,
  counts: {
    total: 0,
    bySource: {
      project: 0,
      personal: 0,
      custom: 0,
      plugin: 0,
      builtin: 0,
      'slan-extra': 0,
    },
  },
  groups: [],
  warnings: [],
  elapsedMs: 1,
};

const DEMO_CHAIN_RESPONSE = {
  chain: {
    version: 1,
    id: 'demo-chain',
    name: 'Demo chain',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      {
        id: 'demo-step',
        skillName: 'demo-skill',
        instruction: 'Render the run-start screen only.',
      },
    ],
    inputs: [],
    automaticPermissionOptIn: false,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
  },
};

/** Keep the shell smoke route independent of a real registered project. */
async function mockEmptyCatalog(page: Page): Promise<void> {
  await page.route(/\/api\/projects\/demo-project\/catalog(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPTY_CATALOG),
    });
  });
}

/** The run-start screen now loads its chain; the smoke route must not 404. */
async function mockDemoChain(page: Page): Promise<void> {
  await page.route(/\/api\/projects\/demo-project\/chains\/demo-chain$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DEMO_CHAIN_RESPONSE),
    });
  });
}

/** Collect browser console errors and uncaught exceptions for a page. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  return errors;
}

test.describe('Slan shell', () => {
  test('redirects the initial route to /projects', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  });

  for (const route of shellRoutes) {
    test(`renders ${route.path} directly without console errors`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);

      if (route.path.includes('/chains/new')) {
        await mockEmptyCatalog(page);
      }
      if (route.path.endsWith('/demo-chain/run')) {
        await mockDemoChain(page);
      }

      await page.goto(route.path);

      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route.path)}$`));
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
      await expect(page.getByText(/Local-only/)).toBeVisible();
      await expect(page.getByText(/Server connected · v/)).toBeVisible();
      expect(consoleErrors).toEqual([]);
    });
  }

  const skipLinkRoutes: ShellRoute[] = [
    ...shellRoutes,
    { path: '/no-such-screen', heading: 'Page not found' },
  ];

  for (const route of skipLinkRoutes) {
    test(`the skip link moves focus to the main landmark on ${route.path}`, async ({ page }) => {
      if (route.path.includes('/chains/new')) {
        await mockEmptyCatalog(page);
      }
      if (route.path.endsWith('/demo-chain/run')) {
        await mockDemoChain(page);
      }
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
      await expect(page.getByText(/Server connected · v/)).toBeVisible();

      await page.keyboard.press('Tab');
      const skipLink = page.getByRole('link', { name: 'Skip to main content' });
      await expect(skipLink).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(page.getByRole('main')).toBeFocused();
    });
  }

  test('an API failure renders inline and is announced', async ({ page }) => {
    // Fail only the first health request; Retry must reach the real server.
    let healthRequests = 0;
    await page.route('**/api/health', async (route) => {
      healthRequests += 1;
      if (healthRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Health check failed on purpose.',
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/projects');

    const panel = page.getByRole('group', { name: 'Server connection error' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Health check failed on purpose.');
    await expect(panel).toContainText('HTTP 503');

    // The polite aria-live region carries the same failure for screen readers.
    await expect(page.getByRole('status')).toHaveText(
      'API request failed: Health check failed on purpose.',
    );

    await panel.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByText(/Server connected · v/)).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText(
      /Server connection restored\. Slan .* is responding\./,
    );
    expect(healthRequests).toBe(2);
  });

  test('unknown routes render a not-found panel with a keyboard path back', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto('/no-such-screen');

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('/no-such-screen')).toBeVisible();
    await expect(page.getByText(/Local-only/)).toBeVisible();

    const backLink = page.getByRole('link', { name: 'Back to projects' });
    await backLink.focus();
    await expect(backLink).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
