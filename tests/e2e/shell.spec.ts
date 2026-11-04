import { expect, test, type Page } from '@playwright/test';

interface ShellRoute {
  path: string;
  heading: string;
}

const shellRoutes: ShellRoute[] = [
  { path: '/projects', heading: 'Projects' },
  { path: '/projects/demo-project/chains/demo-chain', heading: 'Chain authoring' },
  { path: '/projects/demo-project/chains/demo-chain/run', heading: 'Run start' },
  { path: '/runs/demo-run', heading: 'Run view' },
];

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
