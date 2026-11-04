import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser coverage for CHAIN-05 (chain step editor and reordering).
 *
 * Playwright supplies an isolated SLAN_CONFIG_DIR and HOME. The project, its
 * skill packages, and every draft live under this spec's own temporary root, so
 * no test reads or writes the developer's real Slan config or skills. The
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
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'slan-chain-builder-e2e-')));
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
    page.getByRole('heading', { level: 1, name: 'Chain authoring' }),
  ).toBeVisible();
  await expect(page.getByTestId('chain-builder')).toBeVisible();
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

test.describe('Chain builder', () => {
  test('adds catalog skills as steps, edits instruction and label, and searches the catalog', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const project = await openFixtureProject(request);
    await gotoNewBuilder(page, project.id, `Builder add ${runSuffix}`);

    await expect(page.getByTestId('step-list-empty')).toBeVisible();
    await expect(page.getByTestId('step-editor-empty')).toBeVisible();

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

    await save.click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(project.id)}/chains/(?!new)[^/]+$`),
    );
    await expect(page.getByTestId('builder-draft-state')).toHaveText('Saved chain');
    await expect(page.getByTestId('chain-dirty-indicator')).toContainText(
      'All changes saved',
    );

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
      page.getByRole('heading', { level: 1, name: 'Chain authoring' }),
    ).toBeVisible();
    await expect(page.getByTestId('builder-chain-name')).toHaveText(name);
    await expect(page.getByTestId('builder-chain-id')).toHaveText(body.chain.id);
    await expect(page.getByTestId('builder-draft-state')).toHaveText('Saved chain');
    await expect(stepRows(page)).toHaveCount(2);
    expect(await orderedSkillNames(page)).toEqual(['deploy-helper', 'review-helper']);

    // The first step opens in the editor with its saved content intact.
    await expect(page.getByTestId('step-id')).toHaveText('step-a');
    await expect(page.getByTestId('step-instruction')).toHaveValue(
      'Saved deploy instruction.',
    );
    await expect(page.getByTestId('step-label')).toHaveValue('Saved deploy');

    await rowForSkill(page, 'review-helper').getByTestId('step-move-up').click();
    await expect
      .poll(() => orderedSkillNames(page))
      .toEqual(['review-helper', 'deploy-helper']);
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

    await stepRows(page)
      .nth(1)
      .getByRole('button', { name: /Select step 2:/ })
      .click();
    await expect(page.getByTestId('step-id')).toHaveText(secondId);

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
    await expect(page.getByTestId('step-id')).toHaveText(thirdId);
    await expect(
      page.getByTestId('step-row').nth(1).getByTestId('step-select'),
    ).toBeFocused();
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
    await stepRows(page)
      .nth(1)
      .getByRole('button', { name: /Select step 2:/ })
      .click();
    await page.getByTestId('step-instruction').fill('Preserve this unsaved instruction.');

    await rowForSkill(page, 'deploy-helper')
      .locator('.step-row__handle')
      .dragTo(rowForSkill(page, 'write-docs'));
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
    await gotoNewBuilder(page, project.id, `Builder keyboard ${runSuffix}`);
    await addSkillAsStep(page, 'deploy-helper', 1);
    await addSkillAsStep(page, 'review-helper', 2);
    await addSkillAsStep(page, 'write-docs', 3);

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
