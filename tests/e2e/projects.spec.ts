import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser coverage for PROJ-03.
 *
 * The Playwright config supplies an isolated SLAN_CONFIG_DIR and HOME, and this
 * spec builds every project fixture under its own temporary root. No test here
 * reads or writes the developer's real configuration or skills.
 */

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;
let existingRepo: string;
let existingPlain: string;
let createParent: string;
let emptyFolder: string;
let orderA: string;
let orderB: string;

function uniqueName(base: string): string {
  return `${base}-${runSuffix}`;
}

test.beforeAll(async () => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'slan-projects-e2e-')));

  existingRepo = join(fixtureRoot, 'existing-repo');
  existingPlain = join(fixtureRoot, 'existing-plain');
  createParent = join(fixtureRoot, 'create-sandbox');
  emptyFolder = join(fixtureRoot, 'empty-folder');
  orderA = join(fixtureRoot, 'order-a');
  orderB = join(fixtureRoot, 'order-b');

  await mkdir(join(existingRepo, '.git'), { recursive: true });
  await mkdir(join(existingRepo, 'src'), { recursive: true });
  await writeFile(join(existingRepo, 'README.md'), '# Existing repository\n', 'utf8');

  await mkdir(existingPlain, { recursive: true });
  await writeFile(join(existingPlain, 'notes.txt'), 'plain project\n', 'utf8');

  await mkdir(createParent, { recursive: true });
  await mkdir(emptyFolder, { recursive: true });
  await mkdir(orderA, { recursive: true });
  await mkdir(orderB, { recursive: true });
});

test.afterAll(async () => {
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function gotoProjects(page: Page): Promise<void> {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await expect(page.getByLabel('Folder path')).toBeVisible();
}

async function browseTo(page: Page, path: string): Promise<void> {
  const input = page.getByLabel('Folder path');
  await input.fill(path);
  await input.press('Enter');
  await expect(page.getByTestId('current-folder')).toHaveText(path);
}

async function enterFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Open folder ${name}` }).click();
}

async function openCurrentFolder(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open this folder' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
}

async function tabToFocused(page: Page, target: Locator, description: string): Promise<void> {
  for (let index = 0; index < 120; index += 1) {
    await page.keyboard.press('Tab');
    const focused = await target
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    if (focused) {
      return;
    }
  }
  throw new Error(`Could not reach ${description} using only the Tab key.`);
}

/** Collect browser console errors and uncaught exceptions for one page. */
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

async function openProjectViaApi(
  request: APIRequestContext,
  path: string,
): Promise<{ id: string; canonicalPath: string; displayName: string }> {
  const response = await request.post('/api/projects', {
    data: { mode: 'open', path },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    project: { id: string; canonicalPath: string; displayName: string };
  };
  return body.project;
}

test.describe('Project selection screen', () => {
  test('browses directories with Up and opens an existing project', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await gotoProjects(page);
    await browseTo(page, fixtureRoot);

    await expect(page.getByRole('button', { name: 'Open folder existing-repo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open folder existing-plain' })).toBeVisible();

    await enterFolder(page, 'existing-repo');
    await expect(page.getByTestId('current-folder')).toHaveText(existingRepo);

    await page.getByRole('button', { name: 'Up' }).click();
    await expect(page.getByTestId('current-folder')).toHaveText(fixtureRoot);

    await enterFolder(page, 'existing-repo');
    await page.getByRole('button', { name: 'Home' }).click();
    await expect(page.getByTestId('current-folder')).toHaveText('/');

    await browseTo(page, fixtureRoot);
    await enterFolder(page, 'existing-repo');
    await openCurrentFolder(page);

    await expect(
      page.getByRole('heading', { level: 1, name: 'existing-repo' }),
    ).toBeVisible();
    await expect(page.getByTestId('project-canonical-path')).toHaveText(existingRepo);
    await expect(page.getByText('Repository initialized')).toBeVisible();
    await expect(page.getByTestId('project-slan-state')).toContainText('Initialized');
    await expect(page.getByTestId('project-slan-directory')).toHaveText(
      join(existingRepo, '.slan'),
    );

    expect(existsSync(join(existingRepo, '.slan', '.gitignore'))).toBe(true);
    const gitignore = await readFile(join(existingRepo, '.slan', '.gitignore'), 'utf8');
    expect(gitignore).toBe('runs/\n');

    // A reload reconstructs the same facts without replaying the registration.
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'existing-repo' }),
    ).toBeVisible();
    await expect(page.getByTestId('project-canonical-path')).toHaveText(existingRepo);
    await expect(page.getByTestId('project-git-state')).toContainText(
      'Repository initialized',
    );
    await expect(page.getByTestId('project-slan-state')).toContainText('Initialized');

    // The same project reopens through the recent-projects column.
    await page.getByRole('link', { name: 'Open another project' }).click();
    await expect(page).toHaveURL(/\/projects$/);

    const recent = page
      .getByTestId('recent-project')
      .filter({ hasText: 'existing-repo' })
      .first();
    await expect(recent).toBeVisible();
    await recent.getByRole('button', { name: 'Open existing-repo' }).click();

    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'existing-repo' }),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('creates a project with git init and opens it', async ({ page }) => {
    const name = uniqueName('created-with-git');
    const target = join(createParent, name);

    await gotoProjects(page);
    await browseTo(page, createParent);
    await page.getByRole('button', { name: 'New project' }).click();

    const form = page.getByRole('region', { name: 'New project' });
    await expect(form).toBeVisible();
    await expect(page.getByLabel('Parent folder')).toHaveValue(createParent);
    await expect(page.getByLabel('Folder name')).toBeFocused();

    await page.getByLabel('Folder name').fill(name);
    await page.getByLabel('Initialize git repository').check();
    await page.getByRole('button', { name: 'Create project' }).click();

    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByTestId('project-canonical-path')).toHaveText(target);
    await expect(page.getByText('Repository initialized')).toBeVisible();
    await expect(page.getByTestId('project-slan-state')).toContainText('Initialized');

    expect(existsSync(join(target, '.git'))).toBe(true);
    expect(existsSync(join(target, '.slan', '.gitignore'))).toBe(true);
  });

  test('creates a project without git init and opens it', async ({ page }) => {
    const name = uniqueName('created-plain');
    const target = join(createParent, name);

    await gotoProjects(page);
    await browseTo(page, createParent);
    await page.getByRole('button', { name: 'New project' }).click();

    await page.getByLabel('Folder name').fill(name);
    await expect(page.getByLabel('Initialize git repository')).not.toBeChecked();
    await page.getByRole('button', { name: 'Create project' }).click();

    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Not a git repository')).toBeVisible();
    await expect(page.getByTestId('project-slan-state')).toContainText('Initialized');

    expect(existsSync(join(target, '.git'))).toBe(false);
    expect(existsSync(join(target, '.slan'))).toBe(true);
  });

  test('shows loading, empty, and server-error states distinctly', async ({ page }) => {
    const failingPath = join(fixtureRoot, 'server-error-folder');
    let initialRequest = true;

    await page.route('**/api/fs?*', async (route) => {
      const url = new URL(route.request().url());
      const path = url.searchParams.get('path');

      if (path === failingPath) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Folder listing failed on purpose.',
            },
          }),
        });
        return;
      }

      if (path === '/' && initialRequest) {
        initialRequest = false;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      await route.continue();
    });

    await page.goto('/projects');
    await expect(page.getByText('Loading folders…')).toBeVisible();
    await expect(page.getByTestId('current-folder')).toHaveText('/');

    await browseTo(page, emptyFolder);
    await expect(page.getByText('This folder is empty.', { exact: false })).toBeVisible();

    const input = page.getByLabel('Folder path');
    await input.fill(failingPath);
    await input.press('Enter');

    const error = page.getByRole('alert').filter({ hasText: 'Folder could not be loaded' });
    await expect(error).toBeVisible();
    await expect(error).toContainText('Folder listing failed on purpose.');
    await expect(error).toContainText('INTERNAL_ERROR');
    await expect(page.getByText('This folder is empty.', { exact: false })).toHaveCount(0);
  });

  test('shows an invalid-path error without clearing recent projects', async ({
    page,
    request,
  }) => {
    await openProjectViaApi(request, existingPlain);
    await gotoProjects(page);

    const recent = page
      .getByTestId('recent-project')
      .filter({ hasText: 'existing-plain' })
      .first();
    await expect(recent).toBeVisible();

    const missing = join(fixtureRoot, `missing-${runSuffix}`);
    const input = page.getByLabel('Folder path');
    await input.fill(missing);
    await input.press('Enter');

    const error = page.getByRole('alert').filter({ hasText: 'Folder could not be loaded' });
    await expect(error).toBeVisible();
    await expect(error).toContainText('The folder does not exist.');
    await expect(error).toContainText('PATH_NOT_FOUND');

    await expect(recent).toBeVisible();
    await expect(page.getByText('No recent projects yet.')).toHaveCount(0);
  });

  test('orders recent projects newest first and confirms removal without deleting files', async ({
    page,
    request,
  }) => {
    const first = await openProjectViaApi(request, orderA);
    await page.waitForTimeout(20);
    const second = await openProjectViaApi(request, orderB);

    await gotoProjects(page);

    const items = page.getByTestId('recent-project');
    const ids = await items.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-project-id')),
    );
    expect(ids.indexOf(second.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(first.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));

    const secondItem = page.locator(`[data-project-id="${second.id}"]`);
    const firstItem = page.locator(`[data-project-id="${first.id}"]`);

    await secondItem.getByRole('button', { name: 'Remove order-b' }).click();
    const confirmation = page.getByRole('group', {
      name: 'Confirm removal of order-b',
    });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('not deleted');

    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(secondItem).toBeVisible();
    await expect(secondItem.getByRole('button', { name: 'Remove order-b' })).toBeFocused();

    await secondItem.getByRole('button', { name: 'Remove order-b' }).click();
    await page.getByRole('button', { name: 'Confirm remove' }).click();

    await expect(secondItem).toHaveCount(0);
    await expect(firstItem).toBeVisible();
    expect(existsSync(orderB)).toBe(true);

    await page.reload();
    await expect(page.getByTestId('current-folder')).toHaveText('/');
    await expect(page.locator(`[data-project-id="${second.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-project-id="${first.id}"]`)).toBeVisible();
  });

  test('browses and creates a project with the keyboard alone', async ({ page }) => {
    const name = uniqueName('keyboard-created');
    const target = join(createParent, name);

    await gotoProjects(page);

    const pathInput = page.getByLabel('Folder path');
    await tabToFocused(page, pathInput, 'the folder path field');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(existingPlain);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('current-folder')).toHaveText(existingPlain);

    const openButton = page.getByRole('button', { name: 'Open this folder' });
    await tabToFocused(page, openButton, 'the Open this folder action');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'existing-plain' }),
    ).toBeVisible();

    await gotoProjects(page);
    await tabToFocused(page, pathInput, 'the folder path field');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(createParent);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('current-folder')).toHaveText(createParent);

    const newProjectButton = page.getByRole('button', { name: 'New project' });
    await tabToFocused(page, newProjectButton, 'the New project action');
    await page.keyboard.press('Enter');

    const nameInput = page.getByLabel('Folder name');
    await expect(nameInput).toBeFocused();
    await page.keyboard.type(name);

    await page.keyboard.press('Tab');
    const gitCheckbox = page.getByLabel('Initialize git repository');
    await expect(gitCheckbox).toBeFocused();
    await page.keyboard.press('Space');
    await expect(gitCheckbox).toBeChecked();

    await page.keyboard.press('Tab');
    const createButton = page.getByRole('button', { name: 'Create project' });
    await expect(createButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    expect(existsSync(join(target, '.git'))).toBe(true);
  });
});
