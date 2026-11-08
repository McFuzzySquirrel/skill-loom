import { expect, test, type Page } from '@playwright/test';

interface ShellRoute {
  path: string;
  heading: string;
}

const shellRoutes: ShellRoute[] = [
  { path: '/', heading: 'What would you like to do?' },
  { path: '/library', heading: 'Libraries and saved work' },
  { path: '/discovery', heading: 'Discover reusable workflows' },
  { path: '/projects', heading: 'Projects' },
  { path: '/chains', heading: 'Global chain library' },
  { path: '/help', heading: 'Help and user guide' },
  // The builder now loads live catalog data. Use the unsaved-draft route so the
  // shell check does not depend on a registered chain, and fulfill the catalog
  // request with an empty isolated result below.
  { path: '/projects/demo-project/chains/new', heading: 'Workflow designer' },
  { path: '/projects/demo-project/chains/demo-chain/run', heading: 'Run start' },
  { path: '/runs/demo-run/terminal', heading: 'Run terminal' },
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
      'loom-extra': 0,
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

const DEMO_RUN_RESPONSE = {
  run: {
    version: 1,
    id: 'demo-run',
    projectId: 'demo-project',
    chainId: 'demo-chain',
    harness: 'opencode',
    mode: 'supervised',
    sessionMode: 'shared',
    chainSnapshot: {
      name: 'Demo chain',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        {
          id: 'demo-step',
          skillName: 'demo-skill',
          instruction: 'Render the run view only.',
        },
      ],
    },
    resolvedInputs: {},
    status: 'completed',
    currentStepIndex: 0,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:01:00.000Z',
    startedAt: '2026-11-04T00:00:00.000Z',
    finishedAt: '2026-11-04T00:01:00.000Z',
    sessionId: null,
    forkMechanism: 'none',
    steps: [
      {
        id: 'demo-step',
        index: 0,
        skillName: 'demo-skill',
        label: null,
        status: 'done',
        startedAt: '2026-11-04T00:00:00.000Z',
        finishedAt: '2026-11-04T00:01:00.000Z',
        exitCode: 0,
        sessionId: null,
        forkMechanism: 'none',
        skillObservation: 'unknown',
        tail: '',
        reason: null,
      },
    ],
    reason: null,
  },
  projectPath: '/tmp/demo-project',
  terminalId: null,
  actions: {
    next: false,
    retry: false,
    skip: false,
    abort: false,
    pause: false,
    resume: false,
    runNext: false,
    done: false,
    failed: false,
    continue: false,
    restart: false,
  },
  recovery: null,
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

/** The run view now loads a run record; the smoke route must not 404. */
async function mockDemoRun(page: Page): Promise<void> {
  await page.route(/\/api\/runs\/demo-run$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DEMO_RUN_RESPONSE),
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

test.describe('Skill Loom shell', () => {
  test('opens the Start page at the initial route', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'What would you like to do?' })).toBeVisible();
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
      if (route.path.startsWith('/runs/demo-run')) {
        await mockDemoRun(page);
      }

      await page.goto(route.path);

      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route.path)}$`));
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
      await expect(page.getByRole('banner').getByText('Local-only')).toBeVisible();
      await expect(page.getByRole('banner').getByText(/Server connected · v/)).toBeVisible();
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
      if (route.path.startsWith('/runs/demo-run')) {
        await mockDemoRun(page);
      }
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
      await expect(page.getByRole('banner').getByText(/Server connected · v/)).toBeVisible();

      await page.keyboard.press('Tab');
      const skipLink = page.getByRole('link', { name: 'Skip to main content' });
      await expect(skipLink).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(page.getByRole('main')).toBeFocused();
    });
  }

  test('supports system and remembered appearance choices', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/projects');
    const root = page.locator('html');
    const appearance = page.getByLabel('Appearance');

    await expect(root).toHaveAttribute('data-theme', 'light');
    await appearance.selectOption('dark');
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(root).toHaveAttribute('data-theme', 'dark');

    await appearance.selectOption('system');
    await expect(root).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(root).toHaveAttribute('data-theme', 'dark');
  });

  test('opens contextual help and the full guide in a new tab', async ({ page }) => {
    await page.goto('/projects');

    await page.getByRole('banner').getByRole('button', { name: 'Help: Projects' }).click();
    const helpPanel = page.getByRole('region', { name: 'Help: Projects' });
    await expect(helpPanel).toBeVisible();
    await expect(helpPanel).toContainText('recent project');

    const popupPromise = page.waitForEvent('popup');
    await helpPanel.getByRole('link', { name: /Read the full guide/ }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/help#user-guide-register-and-open-a-project$/);
    await expect(page).toHaveURL(/\/projects$/);
  });

  test('renders the user guide and workflow skill instructions offline', async ({ page }) => {
    await page.goto('/help');

    await expect(page.getByRole('heading', { level: 1, name: 'Help and user guide' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Discover and package project workflows' })).toBeVisible();
    await expect(page.getByText('scenario-discovery', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('loom-run-bundle', { exact: true }).last()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Administrator guide' }).first()).toHaveAttribute(
      'href',
      '#article-administrator-guide',
    );
  });

  test('keeps catalog and steps aligned and opens the step editor as a dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1720, height: 1100 });
    await mockEmptyCatalog(page);
    await page.goto('/projects/demo-project/chains/new');

    const stepsPanel = page.locator('.step-panel');
    await expect(stepsPanel.getByTestId('chain-add-instruction')).toBeVisible();
    await expect(page.getByTestId('chain-add-instruction')).toHaveCount(1);

    const boxes = await Promise.all([
      page.getByTestId('skill-catalog').boundingBox(),
      stepsPanel.boundingBox(),
    ]);
    expect(boxes.every((box) => box !== null)).toBe(true);
    const topEdges = boxes.map((box) => box?.y ?? 0);
    expect(Math.max(...topEdges) - Math.min(...topEdges)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('step-editor-dialog')).toBeHidden();

    await stepsPanel.getByTestId('chain-add-instruction').click();
    await expect(page.getByTestId('step-instruction')).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Step editor' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('step-editor-dialog')).toBeHidden();
    await expect(stepsPanel.getByTestId('chain-add-instruction')).toBeFocused();
  });

  test('requires explicit draft-discard consent and verifies server shutdown', async ({ page }) => {
    await mockEmptyCatalog(page);
    await page.route('**/api/runs/active', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          active: false,
          runId: null,
          status: null,
          run: null,
          terminalId: null,
          actions: null,
          recovery: null,
        }),
      });
    });

    let shutdownAccepted = false;
    let postShutdownReads = 0;
    await page.route('**/api/server/lifecycle', async (route) => {
      if (!shutdownAccepted) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ state: 'running', token: 'test-token-'.padEnd(43, 'x') }),
        });
        return;
      }
      postShutdownReads += 1;
      if (postShutdownReads === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ state: 'stopping', token: 'test-token-'.padEnd(43, 'x') }),
        });
        return;
      }
      await route.abort('failed');
    });
    await page.route('**/api/server/shutdown', async (route) => {
      shutdownAccepted = true;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'stopping' }),
      });
    });

    await page.goto('/projects/demo-project/chains/new');
    await page.getByTestId('chain-add-instruction').click();
    const instruction = page.getByTestId('step-instruction');
    await instruction.fill('Keep this draft unless I confirm discard.');
    await page.getByRole('dialog', { name: 'Step editor' })
      .getByRole('button', { name: 'Done editing' })
      .click();
    await page.getByRole('button', { name: 'Stop server' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Stop Skill Loom server' });
    const confirmStop = dialog.getByRole('button', { name: 'Stop server', exact: true });
    const discardLabel = 'I understand that stopping will discard this unsaved chain draft.';
    await expect(confirmStop).toBeDisabled();
    await dialog.getByLabel(discardLabel).check();
    await expect(confirmStop).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(instruction).toHaveValue('Keep this draft unless I confirm discard.');

    await page.getByRole('button', { name: 'Stop server' }).first().click();
    const reopenedDialog = page.getByRole('dialog', { name: 'Stop Skill Loom server' });
    await reopenedDialog.getByLabel(discardLabel).check();
    await reopenedDialog.getByRole('button', { name: 'Stop server', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Skill Loom server stopped' }),
    ).toBeVisible();
  });

  test('announces when the browser cannot remember an appearance choice', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage is blocked.', 'SecurityError');
      };
    });
    await page.goto('/projects');
    await page.getByLabel('Appearance').selectOption('light');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('status')).toHaveText(
      'Appearance changed, but this browser cannot save your preference.',
    );
    await expect(page.getByText('This browser cannot remember the appearance choice.')).toBeVisible();
  });

  test('uses compact keyboard-accessible navigation on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/projects');

    const menu = page.getByRole('button', { name: 'Menu' });
    const navigation = page.getByRole('navigation', { name: 'Primary' });
    await expect(menu).toBeVisible();
    await expect(navigation).toBeHidden();
    await expect(page.getByText('Local-only')).toBeVisible();

    await menu.click();
    const closeMenu = page.getByRole('button', { name: 'Close navigation' });
    await expect(closeMenu).toHaveAttribute('aria-expanded', 'true');
    await expect(navigation).toBeVisible();
    for (const width of [320, 360, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width > 1440 ? 1080 : 800 });
      const horizontalOverflow = await page.locator('body').evaluate((body) => {
        const viewport = document.documentElement.clientWidth;
        return [...body.querySelectorAll('*')]
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.right > viewport + 1)
          .map(({ element, rect }) => ({
            tag: element.tagName,
            className: element.getAttribute('class'),
            right: Math.round(rect.right),
          }));
      });
      expect(horizontalOverflow, `horizontal overflow at ${width}px`).toEqual([]);
    }

    await expect(page.locator('main').evaluate((element) => element.clientWidth)).resolves.toBeGreaterThan(1216);
  });

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
      /Server connection restored\. Skill Loom .* is responding\./,
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
