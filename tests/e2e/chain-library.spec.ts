import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser coverage for CHAIN-04 (project chain library).
 *
 * Playwright supplies an isolated LOOM_CONFIG_DIR and HOME. Every project,
 * chain document, and corrupt fixture used here lives under this spec's own
 * temporary root, so no test reads or writes the developer's real Skill Loom config
 * or skills. The library is driven through src/web/App.tsx and the real API.
 */

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;

interface OpenedProject {
  id: string;
  canonicalPath: string;
  displayName: string;
}

interface SeededChain {
  id: string;
  name: string;
  updatedAt: string;
}

function uniqueName(base: string): string {
  return `${base} ${runSuffix}`;
}

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

async function makeProject(prefix: string): Promise<string> {
  const path = join(fixtureRoot, `${prefix}-${runSuffix}`);
  await mkdir(join(path, '.opencode', 'skills', 'library-probe'), { recursive: true });
  await writeFile(
    join(path, '.opencode', 'skills', 'library-probe', 'SKILL.md'),
    '---\nname: library-probe\ndescription: Probe skill for the chain library screen\n---\nProbe body\n',
    'utf8',
  );
  return path;
}

async function openProject(
  request: APIRequestContext,
  path: string,
): Promise<OpenedProject> {
  const response = await request.post('/api/projects', {
    data: { mode: 'open', path },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { project: OpenedProject };
  return body.project;
}

async function createChainViaApi(
  request: APIRequestContext,
  projectId: string,
  input: {
    name: string;
    harness: 'opencode' | 'copilot';
    sessionMode: 'shared' | 'fresh' | 'fork';
    steps: Array<{ id: string; skillName: string; instruction: string; label?: string }>;
  },
): Promise<SeededChain> {
  const response = await request.post(`/api/projects/${projectId}/chains`, {
    data: input,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { chain: SeededChain };
  return body.chain;
}

async function listChains(
  request: APIRequestContext,
  projectId: string,
): Promise<{ chains: SeededChain[]; warnings: Array<{ code: string; message: string }> }> {
  const response = await request.get(`/api/projects/${projectId}/chains`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    chains: SeededChain[];
    warnings: Array<{ code: string; message: string }>;
  };
}

function cardFor(page: Page, name: string): Locator {
  return page.locator(`[data-testid="chain-card"][data-chain-name="${name}"]`);
}

async function gotoProject(page: Page, project: OpenedProject): Promise<void> {
  await page.goto(`/projects/${project.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: project.displayName }),
  ).toBeVisible();
  await expect(page.getByTestId('chain-library')).toBeVisible();
}

async function tabToFocused(page: Page, target: Locator, description: string): Promise<void> {
  for (let index = 0; index < 160; index += 1) {
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

test.beforeAll(async () => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'loom-chain-library-e2e-')));
});

test.afterAll(async () => {
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test.describe('Project chain library', () => {
  test('shows the empty state, creates a draft, and opens the builder', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const projectPath = await makeProject('chain-empty');
    const project = await openProject(request, projectPath);
    const name = uniqueName('Release train');

    await gotoProject(page, project);

    const empty = page.getByTestId('chain-library-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No chains yet.');

    await page.getByRole('link', { name: 'Project skills' }).click();
    await expect(page.getByTestId('skill-catalog')).toBeVisible();
    await page.getByRole('link', { name: 'Project chains' }).click();

    await page.getByTestId('new-chain-open').click();
    const dialog = page.getByTestId('new-chain-dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { level: 3, name: 'New chain' }),
    ).toBeFocused();

    const nameInput = page.getByLabel('Chain name');
    await nameInput.fill(name);
    await page.getByTestId('new-chain-harness-copilot').check();
    await page.getByTestId('new-chain-submit').click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(project.id)}/chains/new\\?`),
    );
    const search = new URL(page.url()).searchParams;
    expect(search.get('name')).toBe(name);
    expect(search.get('harness')).toBe('copilot');
    expect(search.get('sessionMode')).toBe('shared');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
    ).toBeVisible();
    await expect(page.getByText('new', { exact: true })).toBeVisible();

    // A New Chain draft is editor state, not a chain file. Nothing is written
    // into the project's chains directory until the builder saves.
    const chainsDirectory = join(projectPath, '.loom', 'chains');
    if (existsSync(chainsDirectory)) {
      expect(await readdir(chainsDirectory)).toEqual([]);
    }

    expect(consoleErrors).toEqual([]);
  });

  test('lists name, harness, session mode, step count, and updated time with warnings visible', async ({
    page,
    request,
  }) => {
    const projectPath = await makeProject('chain-list');
    const project = await openProject(request, projectPath);
    const openCodeName = uniqueName('OpenCode recipe');
    const copilotName = uniqueName('Copilot recipe');

    const openCodeChain = await createChainViaApi(request, project.id, {
      name: openCodeName,
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        { id: 'step-a', skillName: 'library-probe', instruction: 'Inspect the tree.' },
        { id: 'step-b', skillName: 'library-probe', instruction: 'Write the summary.' },
      ],
    });
    await createChainViaApi(request, project.id, {
      name: copilotName,
      harness: 'copilot',
      sessionMode: 'fork',
      steps: [{ id: 'step-c', skillName: 'library-probe', instruction: 'Ship it.' }],
    });

    // A corrupt sibling file must surface as a warning without hiding either
    // valid chain. This writes a fixture file directly, never through the UI.
    await writeFile(
      join(projectPath, '.loom', 'chains', 'corrupt-chain.json'),
      '{"version": 1, "id": "corrupt-chain", "name": ',
      'utf8',
    );

    await gotoProject(page, project);

    await expect(page.getByTestId('chain-card')).toHaveCount(2);

    const openCodeCard = cardFor(page, openCodeName);
    await expect(openCodeCard).toBeVisible();
    await expect(openCodeCard.getByTestId('chain-harness')).toHaveText(
      'Harness: OpenCode',
    );
    await expect(openCodeCard.getByTestId('chain-session-mode')).toHaveText(
      'Session: Shared session',
    );
    await expect(openCodeCard.getByTestId('chain-step-count')).toHaveText('2 steps');
    await expect(openCodeCard.getByTestId('chain-updated')).toContainText('Updated');
    await expect(openCodeCard.locator('time')).toHaveAttribute(
      'dateTime',
      openCodeChain.updatedAt,
    );

    const copilotCard = cardFor(page, copilotName);
    await expect(copilotCard).toBeVisible();
    await expect(copilotCard.getByTestId('chain-harness')).toHaveText(
      'Harness: Copilot',
    );
    await expect(copilotCard.getByTestId('chain-session-mode')).toHaveText(
      'Session: Forked session',
    );
    await expect(copilotCard.getByTestId('chain-step-count')).toHaveText('1 step');

    const warnings = page.getByTestId('chain-warnings');
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText('valid chains are still shown');
    await expect(page.getByTestId('chain-warning')).toContainText(
      'CHAIN_FILE_CORRUPT',
    );
    await expect(page.getByTestId('chain-card')).toHaveCount(2);
  });

  test('duplicates, opens, and deletes only the selected chain after confirmation', async ({
    page,
    request,
  }) => {
    const projectPath = await makeProject('chain-actions');
    const project = await openProject(request, projectPath);
    const originalName = uniqueName('Original recipe');
    const original = await createChainViaApi(request, project.id, {
      name: originalName,
      harness: 'opencode',
      sessionMode: 'fresh',
      steps: [
        { id: 'step-1', skillName: 'library-probe', instruction: 'Do the work.' },
      ],
    });

    await gotoProject(page, project);
    await expect(page.getByTestId('chain-card')).toHaveCount(1);

    await cardFor(page, originalName)
      .getByRole('button', { name: `Duplicate ${originalName}` })
      .click();

    const copyName = `${originalName} copy`;
    const copyCard = cardFor(page, copyName);
    await expect(copyCard).toBeVisible();
    await expect(page.getByTestId('chain-card')).toHaveCount(2);
    await expect(cardFor(page, originalName)).toBeVisible();
    // Duplicate focuses the new card so keyboard users keep their place.
    await expect(
      copyCard.getByRole('heading', { level: 3, name: copyName }),
    ).toBeFocused();

    await cardFor(page, originalName)
      .getByRole('link', { name: `Open ${originalName}` })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/projects/${escapeRegExp(project.id)}/chains/${escapeRegExp(original.id)}$`,
      ),
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
    ).toBeVisible();

    await gotoProject(page, project);

    const deleteCopy = copyCard.getByRole('button', {
      name: `Delete ${copyName}`,
    });
    await deleteCopy.click();

    const confirmation = page.getByRole('group', {
      name: `Confirm deletion of ${copyName}`,
    });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(copyName);
    await expect(confirmation).toContainText('removes only');
    await expect(confirmation).toContainText('cannot be undone');
    await expect(
      confirmation.getByRole('button', { name: 'Delete chain' }),
    ).toBeFocused();

    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(copyCard).toBeVisible();
    await expect(deleteCopy).toBeFocused();

    await deleteCopy.click();
    await page.getByTestId('chain-delete-confirm').click();

    await expect(copyCard).toHaveCount(0);
    await expect(cardFor(page, originalName)).toBeVisible();
    await expect(page.getByTestId('chain-card')).toHaveCount(1);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Chains' }),
    ).toBeFocused();

    const remaining = await listChains(request, project.id);
    expect(remaining.chains.map((chain) => chain.id)).toEqual([original.id]);
    expect(await readdir(join(projectPath, '.loom', 'chains'))).toEqual([
      `${original.id}.json`,
    ]);
  });

  test('creates, duplicates, deletes, and opens with the keyboard alone', async ({
    page,
    request,
  }) => {
    const projectPath = await makeProject('chain-keyboard');
    const project = await openProject(request, projectPath);
    const seededName = uniqueName('Keyboard recipe');
    await createChainViaApi(request, project.id, {
      name: seededName,
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        { id: 'keyboard-step', skillName: 'library-probe', instruction: 'Start here.' },
      ],
    });

    await gotoProject(page, project);
    await expect(cardFor(page, seededName)).toBeVisible();

    const newChain = page.getByTestId('new-chain-open');
    await tabToFocused(page, newChain, 'the New chain action');
    await page.keyboard.press('Enter');

    const dialog = page.getByTestId('new-chain-dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { level: 3, name: 'New chain' }),
    ).toBeFocused();

    const nameInput = page.getByLabel('Chain name');
    await tabToFocused(page, nameInput, 'the chain name field');
    const draftName = uniqueName('Keyboard draft');
    await page.keyboard.type(draftName);

    const openCodeRadio = page.getByTestId('new-chain-harness-opencode');
    await tabToFocused(page, openCodeRadio, 'the harness choices');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('new-chain-harness-copilot')).toBeChecked();

    await page.keyboard.press('Tab');
    const submit = page.getByTestId('new-chain-submit');
    await expect(submit).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(project.id)}/chains/new\\?`),
    );
    expect(new URL(page.url()).searchParams.get('harness')).toBe('copilot');

    await page.goBack();
    await expect(
      page.getByRole('heading', { level: 1, name: project.displayName }),
    ).toBeVisible();
    await expect(cardFor(page, seededName)).toBeVisible();

    const duplicate = cardFor(page, seededName).getByRole('button', {
      name: `Duplicate ${seededName}`,
    });
    await tabToFocused(page, duplicate, 'the Duplicate action');
    await page.keyboard.press('Enter');

    const copyName = `${seededName} copy`;
    const copyCard = cardFor(page, copyName);
    await expect(copyCard).toBeVisible();
    await expect(
      copyCard.getByRole('heading', { level: 3, name: copyName }),
    ).toBeFocused();

    const deleteCopy = copyCard.getByRole('button', { name: `Delete ${copyName}` });
    await tabToFocused(page, deleteCopy, 'the Delete action for the copy');
    await page.keyboard.press('Enter');

    const confirmation = page.getByRole('group', {
      name: `Confirm deletion of ${copyName}`,
    });
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole('button', { name: 'Delete chain' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(copyCard).toHaveCount(0);
    await expect(cardFor(page, seededName)).toBeVisible();

    const open = cardFor(page, seededName).getByRole('link', {
      name: `Open ${seededName}`,
    });
    await tabToFocused(page, open, 'the Open chain link');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(project.id)}/chains/[^/]+$`),
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
    ).toBeVisible();
  });

  test('shows loading and server-error states distinctly and retries', async ({
    page,
    request,
  }) => {
    const projectPath = await makeProject('chain-errors');
    const project = await openProject(request, projectPath);
    let chainRequests = 0;

    await page.route(/\/api\/projects\/[^/]+\/chains$/, async (route) => {
      chainRequests += 1;
      if (chainRequests === 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, 600);
        });
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Chain library failed on purpose.',
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId('chain-library-loading')).toBeVisible();

    const errorRegion = page.getByTestId('chain-library-error');
    await expect(errorRegion.getByRole('alert')).toBeVisible();
    await expect(errorRegion).toContainText('Chain library failed on purpose.');
    await expect(errorRegion).toContainText('INTERNAL_ERROR');
    await expect(page.getByTestId('chain-library-empty')).toHaveCount(0);
    await expect(page.getByTestId('chain-card')).toHaveCount(0);

    await errorRegion.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('chain-library-error')).toHaveCount(0);
    await expect(page.getByTestId('chain-library-empty')).toBeVisible();
    expect(chainRequests).toBeGreaterThanOrEqual(2);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
