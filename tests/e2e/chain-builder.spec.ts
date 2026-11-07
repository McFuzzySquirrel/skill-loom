import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser coverage for CHAIN-05 (chain step editor and reordering).
 *
 * Playwright supplies an isolated LOOM_CONFIG_DIR and HOME. The project, its
 * skill packages, and every draft live under this spec's own temporary root, so
 * no test reads or writes the developer's real Skill Loom config or skills. The
 * builder is driven through src/web/App.tsx and the real server API.
 */

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;
let projectPath: string;

interface OpenedProject {
  id: string;
  canonicalPath: string;
  displayName: string;
}

async function writeSkill(
  directory: string,
  name: string,
  description: string,
  body: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
    'utf8',
  );
}

test.beforeAll(async () => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'loom-chain-builder-e2e-')));
  projectPath = join(fixtureRoot, `builder-project-${runSuffix}`);
  await writeSkill(
    join(projectPath, '.opencode', 'skills', 'deploy-helper'),
    'deploy-helper',
    'Ships releases to production with a checklist',
    'DEPLOY_BODY',
  );
  await writeSkill(
    join(projectPath, '.opencode', 'skills', 'review-helper'),
    'review-helper',
    'Reviews code changes before merge',
    'REVIEW_BODY',
  );
  await writeSkill(
    join(projectPath, '.opencode', 'skills', 'write-docs'),
    'write-docs',
    'Writes documentation from a changelog',
    'DOCS_BODY',
  );
});

test.afterAll(async () => {
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

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

async function openFixtureProject(
  request: APIRequestContext,
): Promise<OpenedProject> {
  const response = await request.post('/api/projects', {
    data: { mode: 'open', path: projectPath },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { project: OpenedProject };
  return body.project;
}

async function gotoNewBuilder(
  page: Page,
  projectId: string,
  name: string,
): Promise<void> {
  const search = new URLSearchParams({
    name,
    harness: 'opencode',
    sessionMode: 'shared',
  });
  await page.goto(`/projects/${projectId}/chains/new?${search.toString()}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
  ).toBeVisible();
  await expect(page.getByTestId('chain-builder')).toBeVisible();
  await expect(page.locator('.chain-builder__catalog')).toBeVisible();
  await expect(
    page.locator('[data-testid="chain-builder"] .chain-builder__catalog'),
  ).toHaveCount(1);
  await expandCatalog(page);
}

async function expandCatalog(page: Page): Promise<void> {
  const toggle = page.getByTestId('catalog-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(page.getByTestId('catalog-summary')).toBeVisible();
}

function stepRows(page: Page) {
  return page.getByTestId('step-row');
}

function rowForSkill(page: Page, skillName: string) {
  return page.locator(`[data-testid="step-row"][data-skill-name="${skillName}"]`);
}

async function orderedSkillNames(page: Page): Promise<string[]> {
  return stepRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-skill-name') ?? ''),
  );
}

async function addSkillAsStep(
  page: Page,
  skillName: string,
  expectedCount: number,
): Promise<string> {
  await closeStepEditor(page);
  const search = page.getByTestId('catalog-search');
  await search.fill(skillName);

  const skillRow = page.locator(`[data-testid="skill-row"][data-name="${skillName}"]`);
  await expect(skillRow).toHaveCount(1);

  const toggle = skillRow.locator('.skill-row__toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }

  await skillRow.getByRole('button', { name: 'Add as step' }).click();
  await expect(stepRows(page)).toHaveCount(expectedCount);
  // Add as step moves focus to the new instruction field, so the keyboard
  // user lands where the required work is.
  await expect(page.getByTestId('step-instruction')).toBeFocused();

  const row = stepRows(page).last();
  const stepId = await row.getAttribute('data-step-id');
  expect(stepId).not.toBeNull();
  return stepId ?? '';
}

async function closeStepEditor(page: Page): Promise<void> {
  const dialog = page.getByTestId('step-editor-dialog');
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Done editing' }).click();
  }
  await expect(dialog).toBeHidden();
}

test.describe('Chain builder', () => {
  test('adds instruction steps without skills, edits, orders, saves, and reloads them', async ({
    page, request,
  }) => {
    const project = await openFixtureProject(request);
    await gotoNewBuilder(page, project.id, `Instruction builder ${runSuffix}`);
    await page.getByTestId('chain-add-instruction').click();
    await expect(page.getByTestId('step-instruction')).toBeFocused();
    await expect(page.getByTestId('step-skill')).toHaveCount(0);
    await expect(page.getByTestId('step-kind')).toContainText('no installed skill required');
    await expect(page.getByTestId('chain-save')).toBeDisabled();
    await page.getByTestId('step-instruction').fill('Inspect the project and summarize its purpose.');
    await page.getByTestId('step-label').fill('Inspect project');
    const firstId = await page.getByTestId('step-id').textContent();
    await closeStepEditor(page);
    await page.getByTestId('chain-add-instruction').click();
    await page.getByTestId('step-instruction').fill('Write an implementation checklist.');
    await page.getByTestId('step-label').fill('Checklist');
    const secondId = await page.getByTestId('step-id').textContent();
    await closeStepEditor(page);
    await stepRows(page).last().getByRole('button', { name: /Move up Checklist, step 2/ }).click();
    await expect(stepRows(page).first()).toContainText('Checklist');
    await closeStepEditor(page);
    await page.getByTestId('chain-save').click();
    await expect(page).not.toHaveURL(/\/chains\/new/);
    await page.reload();
    await expect(stepRows(page)).toHaveCount(2);
    await expect(stepRows(page).first()).toHaveAttribute('data-step-id', secondId!);
    await expect(stepRows(page).last()).toHaveAttribute('data-step-id', firstId!);
    await stepRows(page).first().getByRole('button', { name: /Select step 1:/ }).click();
    await expect(page.getByTestId('step-label')).toHaveValue('Checklist');
    await expect(page.getByTestId('step-instruction')).toHaveValue('Write an implementation checklist.');
    await expect(page.getByTestId('step-skill')).toHaveCount(0);
  });

  test('project-independent drafts save, reopen, and create disposable test workspaces', async ({ page, request }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/drafts');
    await page.getByRole('link', { name: 'Blank draft' }).click();
    await expect(page.getByTestId('chain-builder-page')).toBeVisible();
    await expect(page.getByTestId('chain-save')).toHaveText('Save draft');

    await page.getByTestId('chain-add-instruction').click();
    await page.getByTestId('step-instruction').fill('Write a draft test result file.');
    await page.getByTestId('step-label').fill('Create result');
    await closeStepEditor(page);
    await page.getByTestId('chain-save').click();

    await expect(page).toHaveURL(/\/drafts\/[^/]+$/);
    await expect(page.getByTestId('chain-save')).toHaveText('Save draft');
    const draftId = new URL(page.url()).pathname.split('/').at(-1);
    expect(draftId).toBeTruthy();

    await page.getByTestId('chain-test-in-workspace').click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/chains\/[^/]+\/run$/);
    const response = await request.get('/api/test-workspaces');
    expect(response.ok()).toBe(true);
    const body = await response.json() as {
      workspaces: Array<{ sourceDraftId?: string }>;
    };
    expect(body.workspaces.some((workspace) => workspace.sourceDraftId === draftId)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('starts a project-independent scenario draft from a goal', async ({ page }) => {
    const outcome = `Summarize a project and produce a release checklist ${runSuffix}`;
    await page.goto('/drafts');
    await page.getByRole('button', { name: 'Start from a goal' }).click();
    await page.getByLabel('What outcome do you want?').fill(outcome);
    await page.getByRole('button', { name: 'Review catalog and build draft' }).click();

    await expect(page).toHaveURL(/\/drafts\/[^/]+$/);
    await expect(page.getByTestId('chain-builder-page')).toBeVisible();
    await expect(stepRows(page)).toHaveCount(1);
    await expect(stepRows(page).first()).toContainText(`Achieve this outcome: ${outcome}`);
  });

  test('registers and refreshes optional repositories before opening a goal draft', async ({ page }) => {
    const repository = 'https://github.com/example/scenario-skills.git';
    const sourceRequests: Array<{ repository: string; ref?: string }> = [];
    const refreshRequests: string[] = [];
    await page.route('**/api/settings/remote-skill-sources', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { repository: string; ref?: string };
      sourceRequests.push(body);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          source: { id: 'scenario-source', repository: body.repository, ref: body.ref },
        }),
      });
    });
    await page.route('**/api/settings/remote-skill-sources/scenario-source/refresh', async (route) => {
      refreshRequests.push(route.request().method());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          snapshot: {
            version: 1,
            sourceId: 'scenario-source',
            repository,
            revision: 'a'.repeat(40),
            packages: [],
            agents: [],
          },
        }),
      });
    });

    await page.goto('/drafts');
    await page.getByRole('button', { name: 'Start from a goal' }).click();
    await page.getByLabel('What outcome do you want?').fill('Review the repository before a release.');
    await page.getByLabel('Repository URL 1').fill(repository);
    await page.getByLabel('Optional branch, tag, or commit').fill('release');
    await page.getByRole('button', { name: 'Review catalog and build draft' }).click();

    await expect(page).toHaveURL(/\/drafts\/[^/]+$/);
    expect(sourceRequests).toEqual([{ repository, ref: 'release' }]);
    expect(refreshRequests).toEqual(['POST']);
  });

  test('uses a responsive multi-pane workflow design layout', async ({ page, request }) => {
    const project = await openFixtureProject(request);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await gotoNewBuilder(page, project.id, `Responsive builder ${runSuffix}`);

    const builder = page.getByTestId('chain-builder');
    const columnCount = () =>
      builder.evaluate((element) =>
        getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      );

    await expect.poll(columnCount).toBe(2);
    await expect(page.getByTestId('builder-skills-column')).toBeVisible();
    await expect(page.getByTestId('builder-steps-column')).toBeVisible();
    await expect(page.getByTestId('step-editor-dialog')).toBeHidden();

    await page.setViewportSize({ width: 1024, height: 900 });
    await expect.poll(columnCount).toBe(2);

    await page.setViewportSize({ width: 640, height: 800 });
    await expect.poll(columnCount).toBe(1);
  });

  test('adds catalog skills as steps, edits instruction and label, and searches the catalog', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const project = await openFixtureProject(request);
    await gotoNewBuilder(page, project.id, `Builder add ${runSuffix}`);

    await expect(page.getByTestId('step-list-empty')).toBeVisible();
    await expect(page.getByTestId('step-editor-dialog')).toBeHidden();

    const firstId = await addSkillAsStep(page, 'deploy-helper', 1);
    expect(firstId).toMatch(/^step-/);
    await expect(page.getByTestId('step-id')).toHaveText(firstId);
    await expect(page.getByTestId('builder-step-count')).toHaveText('1 step');
    await expect(page.getByTestId('step-position')).toHaveText('Step 1 of 1');
    await expect(page.getByTestId('step-needs-instruction')).toBeVisible();

    await page
      .getByTestId('step-instruction')
      .fill('Deploy the release using the deployment checklist.');
    await page.getByTestId('step-label').fill('Deploy release');
    await expect(stepRows(page).first()).toContainText('Deploy release');
    await expect(stepRows(page).first()).toContainText('deploy-helper');
    await expect(stepRows(page).first()).toContainText('Deploy the release');

    const secondId = await addSkillAsStep(page, 'review-helper', 2);
    expect(secondId).not.toBe(firstId);
    await expect(page.getByTestId('step-id')).toHaveText(secondId);
    await expect(page.getByTestId('builder-step-count')).toHaveText('2 steps');
    await expect(stepRows(page)).toHaveCount(2);
    expect(await orderedSkillNames(page)).toEqual(['deploy-helper', 'review-helper']);

    // Selecting an earlier row opens that step in the editor and keeps the
    // unsaved instruction and label.
    await closeStepEditor(page);
    await stepRows(page)
      .first()
      .getByRole('button', { name: /Select step 1:/ })
      .click();
    await expect(page.getByTestId('step-id')).toHaveText(firstId);
    await expect(page.getByTestId('step-instruction')).toHaveValue(
      'Deploy the release using the deployment checklist.',
    );
    await expect(page.getByTestId('step-label')).toHaveValue('Deploy release');

    // Catalog search filters the builder panel without touching the steps.
    await closeStepEditor(page);
    await page.getByTestId('catalog-search').fill('deploy');
    await expect(
      page.locator('[data-testid="skill-row"][data-name="deploy-helper"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="skill-row"][data-name="review-helper"]'),
    ).toHaveCount(0);
    await expect(stepRows(page)).toHaveCount(2);

    expect(consoleErrors).toEqual([]);
  });

  test('persists the selected remote snapshot and clears it when the skill changes', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    const snapshots = [
      {
        id: 'remote-review-a',
        name: 'remote-review',
        sourceId: 'source-a',
        revision: 'a'.repeat(40),
        repositoryPath: 'skills/review',
      },
      {
        id: 'remote-review-b',
        name: 'alternate-review',
        sourceId: 'source-b',
        revision: 'b'.repeat(40),
        repositoryPath: 'skills/review',
      },
    ];
    await page.route(`**/api/projects/${project.id}/catalog**`, async (route) => {
      const requestUrl = new URL(route.request().url());
      const skillId = requestUrl.pathname.split('/skills/')[1];
      if (skillId !== undefined) {
        const snapshot = snapshots.find((entry) => entry.id === skillId);
        if (snapshot === undefined) {
          await route.fulfill({ status: 404, body: 'not found' });
          return;
        }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            id: snapshot.id,
            harness: 'opencode',
            name: snapshot.name,
            path: `/snapshot/${snapshot.sourceId}/${snapshot.revision}/SKILL.md`,
            content: `---\nname: ${snapshot.name}\ndescription: remote test skill\n---\nReview the selected snapshot.`,
          }),
        });
        return;
      }

      const entries = snapshots.map((snapshot) => ({
        ...snapshot,
        harness: 'opencode',
        source: 'remote',
        description: 'Remote test skill',
        path: `/snapshot/${snapshot.sourceId}/${snapshot.revision}/SKILL.md`,
        packagePath: `/snapshot/${snapshot.sourceId}/${snapshot.revision}`,
        repository: `https://example.test/${snapshot.sourceId}.git`,
        enabled: true,
      }));
      const query = requestUrl.searchParams.get('q') ?? '';
      const visibleEntries = entries.filter((entry) =>
        entry.name.toLocaleLowerCase('en-US').includes(query.toLocaleLowerCase('en-US')),
      );
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          harness: 'opencode',
          query,
          total: visibleEntries.length,
          counts: {
            total: visibleEntries.length,
            bySource: {
              project: 0,
              personal: 0,
              custom: 0,
              plugin: 0,
              builtin: 0,
              'loom-extra': 0,
              remote: visibleEntries.length,
            },
          },
          groups:
            visibleEntries.length === 0
              ? []
              : [{ source: 'remote', count: visibleEntries.length, entries: visibleEntries }],
          agents: [],
          warnings: [],
          elapsedMs: 1,
        }),
      });
    });

    await gotoNewBuilder(page, project.id, `Remote binding ${runSuffix}`);
    await page.getByTestId('catalog-search').fill('remote-review');
    const skillRow = page.locator('[data-testid="skill-row"][data-name="remote-review"]');
    await expect(skillRow).toHaveCount(1);
    await skillRow.locator('.skill-row__toggle').click();
    await skillRow.getByRole('button', { name: 'Add as step' }).click();
    await page.getByTestId('step-instruction').fill('Review this snapshot.');
    await expect(page.getByTestId('skill-snapshot-binding')).toContainText('source-a');
    await expect(page.getByTestId('skill-snapshot-binding')).toContainText('aaaaaaaaaaaa');
    await closeStepEditor(page);
    await page.getByTestId('chain-save').click();
    await expect(page).not.toHaveURL(/\/chains\/new/);

    await page.reload();
    await stepRows(page).first().getByRole('button', { name: /Select step 1:/ }).click();
    await expect(page.getByTestId('skill-snapshot-binding')).toContainText('source-a');

    await page.getByTestId('step-skill').selectOption('alternate-review');
    await expect(page.getByTestId('skill-snapshot-binding')).toHaveCount(0);
    await closeStepEditor(page);
    await page.getByTestId('chain-save').click();
    await page.reload();
    await stepRows(page).first().getByRole('button', { name: /Select step 1:/ }).click();
    await expect(page.getByTestId('step-skill')).toHaveValue('alternate-review');
    await expect(page.getByTestId('skill-snapshot-binding')).toHaveCount(0);
  });

  test('blocks save and shows an inline error while an instruction is empty', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    await gotoNewBuilder(page, project.id, `Builder validation ${runSuffix}`);

    const save = page.getByTestId('chain-save');
    await expect(save).toBeDisabled();

    await addSkillAsStep(page, 'deploy-helper', 1);

    const instruction = page.getByTestId('step-instruction');
    await expect(instruction).toHaveAttribute('aria-invalid', 'true');
    const error = page.getByTestId('step-instruction-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Enter an instruction for step 1 before saving.');
    await expect(page.getByTestId('step-needs-instruction')).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(page.locator('#chain-save-hint')).toContainText(
      '1 step needs an instruction before saving.',
    );

    await instruction.fill('Apply the deployment checklist to this release.');
    await expect(error).toHaveCount(0);
    await expect(instruction).toHaveAttribute('aria-invalid', 'false');
    await expect(save).toBeEnabled();
    await expect(page.getByTestId('step-needs-instruction')).toHaveCount(0);

    await closeStepEditor(page);
    await save.click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(project.id)}/chains/(?!new)[^/]+$`),
    );
    await expect(page.getByTestId('builder-draft-state')).toHaveText('Saved chain');
    await expect(page.getByTestId('chain-dirty-indicator')).toContainText(
      'All changes saved',
    );

    await stepRows(page).first().getByTestId('step-select').click();
    await instruction.fill('   ');
    await expect(page.getByTestId('step-instruction-error')).toBeVisible();
    await expect(save).toBeDisabled();
  });

  test('loads an existing saved chain into the ordered list and editor', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    const name = `Saved builder chain ${runSuffix}`;
    const response = await request.post(`/api/projects/${project.id}/chains`, {
      data: {
        name,
        harness: 'opencode',
        sessionMode: 'shared',
        steps: [
          {
            id: 'step-a',
            skillName: 'deploy-helper',
            instruction: 'Saved deploy instruction.',
            label: 'Saved deploy',
          },
          {
            id: 'step-b',
            skillName: 'review-helper',
            instruction: 'Saved review instruction.',
          },
        ],
      },
    });
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { chain: { id: string; name: string } };

    await page.goto(`/projects/${project.id}/chains/${body.chain.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
    ).toBeVisible();
    await expect(page.getByTestId('builder-chain-name')).toHaveText(name);
    await expect(page.getByTestId('builder-chain-id')).toHaveText(body.chain.id);
    await expect(page.getByTestId('builder-draft-state')).toHaveText('Saved chain');
    await expect(stepRows(page)).toHaveCount(2);
    expect(await orderedSkillNames(page)).toEqual(['deploy-helper', 'review-helper']);

    // The selected step opens in the editor dialog with its saved content intact.
    await rowForSkill(page, 'deploy-helper').getByTestId('step-select').click();
    const editorDialog = page.getByRole('dialog', { name: 'Step editor' });
    await expect(editorDialog).toBeVisible();
    await expect(editorDialog.getByRole('heading', { name: 'Step editor' })).toBeFocused();
    await expect(page.getByTestId('step-id')).toHaveText('step-a');
    await expect(page.getByTestId('step-instruction')).toHaveValue(
      'Saved deploy instruction.',
    );
    await expect(page.getByTestId('step-label')).toHaveValue('Saved deploy');

    await closeStepEditor(page);
    await rowForSkill(page, 'review-helper').getByTestId('step-move-up').click();
    await expect
      .poll(() => orderedSkillNames(page))
      .toEqual(['review-helper', 'deploy-helper']);
    await rowForSkill(page, 'deploy-helper').getByTestId('step-select').click();
    await expect(page.getByTestId('step-id')).toHaveText('step-a');
  });

  test('removes only the selected step and selects an adjacent step', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    await gotoNewBuilder(page, project.id, `Builder remove ${runSuffix}`);

    const firstId = await addSkillAsStep(page, 'deploy-helper', 1);
    const secondId = await addSkillAsStep(page, 'review-helper', 2);
    const thirdId = await addSkillAsStep(page, 'write-docs', 3);

    await closeStepEditor(page);
    await stepRows(page)
      .nth(1)
      .getByRole('button', { name: /Select step 2:/ })
      .click();
    await expect(page.getByTestId('step-id')).toHaveText(secondId);

    await closeStepEditor(page);
    await stepRows(page)
      .nth(1)
      .getByRole('button', { name: /Remove step 2:/ })
      .click();

    await expect(stepRows(page)).toHaveCount(2);
    expect(await orderedSkillNames(page)).toEqual(['deploy-helper', 'write-docs']);
    const remainingIds = await stepRows(page).evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-step-id')),
    );
    expect(remainingIds).toEqual([firstId, thirdId]);
    await expect(
      page.locator(`[data-testid="step-row"][data-step-id="${secondId}"]`),
    ).toHaveCount(0);

    // The neighbor becomes selected and keeps keyboard focus in the list.
    await expect(
      page.getByTestId('step-row').nth(1).getByTestId('step-select'),
    ).toBeFocused();
    await page.getByTestId('step-row').nth(1).getByTestId('step-select').click();
    await expect(page.getByTestId('step-id')).toHaveText(thirdId);
  });

  test('drag-and-drop and Move up/Move down produce the same order and keep unsaved text', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);

    await gotoNewBuilder(page, project.id, `Builder drag ${runSuffix}`);
    await addSkillAsStep(page, 'deploy-helper', 1);
    await addSkillAsStep(page, 'review-helper', 2);
    await addSkillAsStep(page, 'write-docs', 3);

    // Type into the middle step, then drag the first step onto the last one.
    await closeStepEditor(page);
    await stepRows(page)
      .nth(1)
      .getByRole('button', { name: /Select step 2:/ })
      .click();
    await page.getByTestId('step-instruction').fill('Preserve this unsaved instruction.');

    await closeStepEditor(page);
    await rowForSkill(page, 'write-docs').scrollIntoViewIfNeeded();
    await rowForSkill(page, 'deploy-helper').dragTo(rowForSkill(page, 'write-docs'));
    await expect
      .poll(() => orderedSkillNames(page))
      .toEqual(['review-helper', 'write-docs', 'deploy-helper']);

    // Reordering preserved the unsaved text and the stable step ids.
    await stepRows(page)
      .first()
      .getByRole('button', { name: /Select step 1:/ })
      .click();
    await expect(page.getByTestId('step-instruction')).toHaveValue(
      'Preserve this unsaved instruction.',
    );
    const dragOrder = await orderedSkillNames(page);

    // Repeat from a clean draft using only the keyboard alternative.
    await closeStepEditor(page);
    await gotoNewBuilder(page, project.id, `Builder keyboard ${runSuffix}`);
    await addSkillAsStep(page, 'deploy-helper', 1);
    await addSkillAsStep(page, 'review-helper', 2);
    await addSkillAsStep(page, 'write-docs', 3);

    await closeStepEditor(page);
    const moveReviewUp = rowForSkill(page, 'review-helper').getByTestId('step-move-up');
    await moveReviewUp.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => orderedSkillNames(page))
      .toEqual(['review-helper', 'deploy-helper', 'write-docs']);
    // It is now the first step, so Move up is disabled; focus stays on the
    // moved row instead of dropping to the document body.
    await expect(
      rowForSkill(page, 'review-helper').getByTestId('step-select'),
    ).toBeFocused();

    const moveDocsUp = rowForSkill(page, 'write-docs').getByTestId('step-move-up');
    await moveDocsUp.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => orderedSkillNames(page))
      .toEqual(['review-helper', 'write-docs', 'deploy-helper']);
    await expect(moveDocsUp).toBeFocused();

    expect(await orderedSkillNames(page)).toEqual(dragOrder);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
