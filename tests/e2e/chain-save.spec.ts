import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser coverage for CHAIN-06 (inputs, save, and harness binding).
 *
 * Playwright supplies an isolated LOOM_CONFIG_DIR and HOME. The project, skill
 * packages, and every chain document used here live under this spec's own
 * temporary root, so no test reads or writes the developer's real Skill Loom config
 * or skills. The builder is driven through src/web/App.tsx and the real API.
 */

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;
let projectPath: string;

interface OpenedProject {
  id: string;
  canonicalPath: string;
  displayName: string;
}

interface StoredChain {
  id: string;
  name: string;
  harness: 'opencode' | 'copilot';
  sessionMode: 'shared' | 'fresh' | 'fork';
  steps: Array<{ id: string; skillName: string; instruction: string; label?: string }>;
  inputs: Array<{ name: string; label?: string; required: boolean; defaultValue?: string }>;
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
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'loom-chain-save-e2e-')));
  projectPath = join(fixtureRoot, `save-project-${runSuffix}`);
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
  options: {
    name: string;
    harness?: 'opencode' | 'copilot';
    sessionMode?: 'shared' | 'fresh' | 'fork';
  },
): Promise<void> {
  const search = new URLSearchParams({
    name: options.name,
    harness: options.harness ?? 'opencode',
    sessionMode: options.sessionMode ?? 'shared',
  });
  await page.goto(`/projects/${projectId}/chains/new?${search.toString()}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
  ).toBeVisible();
  await expect(page.getByTestId('chain-builder')).toBeVisible();
  await expandCatalog(page);
}

async function expandCatalog(page: Page): Promise<void> {
  const toggle = page.getByTestId('catalog-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(page.getByTestId('catalog-summary')).toBeVisible();
}

function stepRows(page: Page): Locator {
  return page.getByTestId('step-row');
}

function inputRow(page: Page, name: string): Locator {
  return page.locator(`[data-testid="input-row"][data-input-name="${name}"]`);
}

async function addSkillAsStep(
  page: Page,
  skillName: string,
  expectedCount: number,
): Promise<void> {
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
  await expect(page.getByTestId('step-instruction')).toBeFocused();
}

async function addInput(
  page: Page,
  input: {
    name: string;
    label?: string;
    required?: boolean;
    defaultValue?: string;
  },
): Promise<void> {
  await closeStepEditor(page);
  await page.getByTestId('input-add-name').fill(input.name);
  if (input.label !== undefined) {
    await page.getByTestId('input-add-label').fill(input.label);
  }
  if (input.defaultValue !== undefined) {
    await page.getByTestId('input-add-default').fill(input.defaultValue);
  }
  if (input.required === true) {
    await page.getByTestId('input-add-required').check();
  }
  await page.getByTestId('input-add-submit').click();
  await expect(inputRow(page, input.name)).toBeVisible();
}

async function closeStepEditor(page: Page): Promise<void> {
  const dialog = page.getByTestId('step-editor-dialog');
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Done editing' }).click();
  }
  await expect(dialog).toBeHidden();
}

async function openFirstStepEditor(page: Page): Promise<void> {
  await stepRows(page).first().getByTestId('step-select').click();
  await expect(page.getByTestId('step-editor-dialog')).toBeVisible();
}

function chainIdFromUrl(value: string): string {
  const path = new URL(value).pathname;
  return path.slice(path.lastIndexOf('/') + 1);
}

test.describe('Chain inputs and save', () => {
  test('adds, edits, renames, and removes inputs with an affected-step report', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const project = await openFixtureProject(request);
    await gotoNewBuilder(page, project.id, { name: `Inputs ${runSuffix}` });

    await addSkillAsStep(page, 'deploy-helper', 1);
    await page
      .getByTestId('step-instruction')
      .fill('Deploy {{task}} to {{target_env}} and report the result.');
    await page.getByTestId('step-label').fill('Deploy release');

    // Add two inputs with a label, a required flag, and a default value.
    await addInput(page, {
      name: 'task',
      label: 'Task description',
      required: true,
      defaultValue: 'Release notes',
    });
    await addInput(page, {
      name: 'target_env',
      label: 'Target environment',
      defaultValue: 'staging',
    });

    await openFirstStepEditor(page);
    await expect(page.getByTestId('builder-input-count')).toHaveText('2 inputs');
    await expect(page.getByTestId('inputs-count')).toHaveText('2 inputs');

    // Inline edits update the draft without touching instruction text.
    await closeStepEditor(page);
    const taskRow = inputRow(page, 'task');
    await expect(taskRow.getByTestId('input-label')).toHaveValue('Task description');
    await expect(taskRow.getByTestId('input-required')).toBeChecked();
    await expect(taskRow.getByTestId('input-default')).toHaveValue('Release notes');
    await taskRow.getByTestId('input-label').fill('Task to perform');
    await expect(page.getByTestId('chain-dirty-indicator')).toContainText(
      'Unsaved changes',
    );

    // Removing an input reports every instruction that references it first.
    await closeStepEditor(page);
    await inputRow(page, 'target_env').getByTestId('input-remove').click();
    const removalReport = page.getByTestId('input-reconciliation');
    await expect(removalReport).toBeVisible();
    await expect(removalReport).toHaveAttribute('data-action', 'remove');
    await expect(
      page.getByRole('heading', { level: 3, name: 'Remove input target_env' }),
    ).toBeFocused();
    const removalSteps = removalReport.getByTestId('input-reconciliation-step');
    await expect(removalSteps).toHaveCount(1);
    await expect(removalSteps.first()).toContainText('Step 1');
    await expect(removalSteps.first()).toContainText('Deploy release');
    await expect(removalSteps.first()).toContainText('{{target_env}}');

    await removalReport.getByTestId('input-remove-confirm').click();
    await expect(inputRow(page, 'target_env')).toHaveCount(0);
    await expect(page.getByTestId('builder-input-count')).toHaveText('1 input');
    await openFirstStepEditor(page);
    await expect(page.getByTestId('step-instruction')).not.toHaveValue(
      /target_env/,
    );
    await expect(page.getByTestId('step-instruction')).toHaveValue(/\{\{task\}\}/);
    await closeStepEditor(page);

    // Renaming reports the affected step before rewriting its placeholder.
    await inputRow(page, 'task').getByTestId('input-rename').click();
    await page.getByTestId('input-rename-name').fill('request_title');
    await page.getByTestId('input-rename-review').click();

    const renameReport = page.getByTestId('input-reconciliation');
    await expect(renameReport).toBeVisible();
    await expect(renameReport).toHaveAttribute('data-action', 'rename');
    const renameSteps = renameReport.getByTestId('input-reconciliation-step');
    await expect(renameSteps).toHaveCount(1);
    await expect(renameSteps.first()).toContainText('Step 1');
    await expect(renameSteps.first()).toContainText('{{task}}');

    await renameReport.getByTestId('input-rename-apply').click();
    await openFirstStepEditor(page);
    await expect(inputRow(page, 'request_title')).toBeVisible();
    await expect(inputRow(page, 'task')).toHaveCount(0);
    await expect(page.getByTestId('step-instruction')).toHaveValue(
      /\{\{request_title\}\}/,
    );
    await closeStepEditor(page);
    await expect(page.getByTestId('input-label')).toHaveValue('Task to perform');
    await expect(page.getByTestId('input-required')).toBeChecked();
    await expect(page.getByTestId('input-default')).toHaveValue('Release notes');

    expect(consoleErrors).toEqual([]);
  });

  test('blocks save on an unresolved placeholder and names the step and input', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const project = await openFixtureProject(request);
    await gotoNewBuilder(page, project.id, { name: `Placeholders ${runSuffix}` });

    await addSkillAsStep(page, 'review-helper', 1);
    await page
      .getByTestId('step-instruction')
      .fill('Summarize the changes for {{missing_value}}.');

    const save = page.getByTestId('chain-save');
    await expect(save).toBeDisabled();
    await expect(page.getByTestId('chain-issues-summary')).toContainText(
      'block saving',
    );

    const issues = page.getByTestId('placeholder-issue');
    await expect(issues).toHaveCount(1);
    await expect(issues.first()).toContainText('Step 1');
    await expect(issues.first()).toContainText('"missing_value"');
    await expect(page.getByTestId('step-placeholder-errors')).toContainText(
      'missing_value',
    );
    await expect(
      page.locator('[data-testid="step-needs-instruction"]'),
    ).toContainText('Placeholder issue');

    await addInput(page, { name: 'missing_value', label: 'Missing value' });

    await openFirstStepEditor(page);
    await expect(page.getByTestId('placeholder-issue')).toHaveCount(0);
    await expect(page.getByTestId('chain-issues-none')).toBeVisible();
    await expect(save).toBeEnabled();

    // Identifier syntax is enforced before the placeholder reaches the API.
    await page.getByTestId('step-instruction').fill('Summarize {{bad name}}.');
    await expect(page.getByTestId('placeholder-issue')).toContainText(
      '{{bad name}}',
    );
    await expect(save).toBeDisabled();

    await page.getByTestId('step-instruction').fill('Summarize {{missing_value}}.');
    await expect(save).toBeEnabled();
    expect(consoleErrors).toEqual([]);
  });

  test('saves a new chain and reloads steps, inputs, session mode, and harness intact', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    const name = `Persisted chain ${runSuffix}`;
    await gotoNewBuilder(page, project.id, {
      name,
      harness: 'opencode',
      sessionMode: 'fork',
    });

    await addSkillAsStep(page, 'deploy-helper', 1);
    await page
      .getByTestId('step-instruction')
      .fill('Deploy {{release}} for {{ticket}} using the checklist.');
    await page.getByTestId('step-label').fill('Ship release');

    await addInput(page, {
      name: 'release',
      label: 'Release version',
      required: true,
      defaultValue: 'v1.0.0',
    });
    await addInput(page, {
      name: 'ticket',
      label: 'Tracking ticket',
    });

    await expect(page.getByTestId('chain-dirty-indicator')).toContainText(
      'Unsaved changes',
    );

    await page.getByTestId('chain-save').click();
    await expect(page.getByTestId('builder-draft-state')).toHaveText('Saved chain');
    await expect(page.getByTestId('chain-dirty-indicator')).toContainText(
      'All changes saved',
    );
    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(project.id)}/chains/(?!new)[^/]+$`),
    );
    const savedId = chainIdFromUrl(page.url());
    expect(savedId).not.toBe('new');

    // A reload must load the persisted document, not replay the URL draft.
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
    ).toBeVisible();
    await page.getByText('Harness and duplicate settings').click();
    await expect(page.getByTestId('builder-chain-name')).toHaveText(name);
    await expect(page.getByTestId('builder-draft-state')).toHaveText('Saved chain');
    await expect(page.getByTestId('builder-chain-id')).toHaveText(savedId);
    await expect(page.getByTestId('builder-harness')).toHaveText(
      'Harness: OpenCode',
    );
    await expect(page.getByTestId('builder-session-mode')).toHaveText(
      'Session: Forked session',
    );
    await expect(page.getByTestId('builder-step-count')).toHaveText('1 step');
    await expect(page.getByTestId('builder-input-count')).toHaveText('2 inputs');
    await openFirstStepEditor(page);
    await expect(page.getByTestId('step-instruction')).toHaveValue(
      'Deploy {{release}} for {{ticket}} using the checklist.',
    );
    await expect(page.getByTestId('step-label')).toHaveValue('Ship release');

    const releaseRow = inputRow(page, 'release');
    await expect(releaseRow.getByTestId('input-label')).toHaveValue(
      'Release version',
    );
    await expect(releaseRow.getByTestId('input-required')).toBeChecked();
    await expect(releaseRow.getByTestId('input-default')).toHaveValue('v1.0.0');

    const ticketRow = inputRow(page, 'ticket');
    await expect(ticketRow.getByTestId('input-label')).toHaveValue(
      'Tracking ticket',
    );
    await expect(ticketRow.getByTestId('input-required')).not.toBeChecked();
    await expect(ticketRow.getByTestId('input-default')).toHaveValue('');

    // The saved chain is bound to its original harness and cannot change it.
    const harnessSelect = page.getByTestId('builder-harness-select');
    await expect(harnessSelect).toHaveValue('opencode');
    await expect(harnessSelect).toBeDisabled();

    const stored = await request.get(
      `/api/projects/${project.id}/chains/${savedId}`,
    );
    expect(stored.ok()).toBe(true);
    const storedBody = (await stored.json()) as { chain: StoredChain };
    expect(storedBody.chain.harness).toBe('opencode');
    expect(storedBody.chain.sessionMode).toBe('fork');
    expect(storedBody.chain.inputs).toHaveLength(2);
  });

  test('asks for confirmation before leaving a dirty draft', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    await gotoNewBuilder(page, project.id, { name: `Dirty guard ${runSuffix}` });

    await addSkillAsStep(page, 'deploy-helper', 1);
    await page.getByTestId('step-instruction').fill('Deploy the release.');
    await closeStepEditor(page);

    const dirtyUrl = page.url();
    const projectBreadcrumb = page.getByRole('link', { name: '← Project' });

    await projectBreadcrumb.click();

    const confirmation = page.getByTestId('unsaved-changes');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('Discard unsaved changes?');
    await expect(confirmation).toContainText('unsaved changes');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Discard unsaved changes?' }),
    ).toBeFocused();
    expect(page.url()).toBe(dirtyUrl);

    await confirmation.getByTestId('unsaved-stay').click();
    await expect(confirmation).toHaveCount(0);
    expect(page.url()).toBe(dirtyUrl);
    await expect(page.getByTestId('chain-dirty-indicator')).toContainText(
      'Unsaved changes',
    );

    await projectBreadcrumb.click();
    await expect(page.getByTestId('unsaved-changes')).toBeVisible();
    await page.getByTestId('unsaved-leave').click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(project.id)}$`),
    );
    await expect(
      page.getByRole('heading', { level: 1, name: project.displayName }),
    ).toBeVisible();
    await expect(page.getByTestId('chain-library')).toBeVisible();
  });

  test('keeps the harness read-only and duplicates the chain with another harness', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    const name = `Harness binding ${runSuffix}`;
    const created = await request.post(`/api/projects/${project.id}/chains`, {
      data: {
        name,
        harness: 'opencode',
        sessionMode: 'shared',
        steps: [
          {
            id: 'step-harness',
            skillName: 'deploy-helper',
            instruction: 'Deploy {{release}} to the target environment.',
            label: 'Deploy target',
          },
        ],
        inputs: [
          {
            name: 'release',
            label: 'Release version',
            required: true,
            defaultValue: 'v2.0.0',
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as { chain: StoredChain };
    const original = createdBody.chain;

    await page.goto(`/projects/${project.id}/chains/${original.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
    ).toBeVisible();
    await page.getByText('Harness and duplicate settings').click();

    const harnessSelect = page.getByTestId('builder-harness-select');
    await expect(harnessSelect).toHaveValue('opencode');
    await expect(harnessSelect).toBeDisabled();
    await expect(page.getByTestId('harness-duplicate')).toBeVisible();
    await expect(page.getByTestId('harness-duplicate')).toContainText(
      'Changing the harness of this chain is not allowed.',
    );
    await expect(
      page.getByText(/per-step harness switching is unsupported/i).first(),
    ).toBeVisible();

    await page.getByTestId('harness-duplicate-target').selectOption('copilot');
    await page.getByTestId('harness-duplicate-action').click();

    // The duplicate announcement can be superseded quickly by the new builder's
    // catalog load, so the durable evidence is the copied route and document.
    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(project.id)}/chains/[^/]+$`),
    );
    await expect(page.getByTestId('builder-chain-name')).toHaveText(`${name} copy`);
    const copyId = chainIdFromUrl(page.url());
    expect(copyId).not.toBe(original.id);
    await expect(page.getByTestId('builder-harness')).toHaveText(
      'Harness: Copilot',
    );
    await expect(page.getByTestId('builder-harness-select')).toHaveValue('copilot');
    await expect(page.getByTestId('builder-harness-select')).toBeDisabled();
    await openFirstStepEditor(page);
    await expect(page.getByTestId('step-instruction')).toHaveValue(
      'Deploy {{release}} to the target environment.',
    );
    await expect(inputRow(page, 'release').getByTestId('input-label')).toHaveValue(
      'Release version',
    );

    const originalAfter = await request.get(
      `/api/projects/${project.id}/chains/${original.id}`,
    );
    expect(originalAfter.ok()).toBe(true);
    const originalBody = (await originalAfter.json()) as { chain: StoredChain };
    expect(originalBody.chain.harness).toBe('opencode');

    const copyAfter = await request.get(`/api/projects/${project.id}/chains/${copyId}`);
    expect(copyAfter.ok()).toBe(true);
    const copyBody = (await copyAfter.json()) as { chain: StoredChain };
    expect(copyBody.chain.harness).toBe('copilot');
    expect(copyBody.chain.inputs).toHaveLength(1);
  });

  test('keeps unsaved edits when another client changes the chain', async ({ page, request }) => {
    const project = await openFixtureProject(request);
    const draft = {
      name: `Concurrent ${runSuffix}`, harness: 'opencode', sessionMode: 'shared',
      steps: [{ id: 'step-1', skillName: 'deploy-helper', instruction: 'Initial instruction.' }],
      inputs: [],
    };
    const created = await request.post(`/api/projects/${project.id}/chains`, { data: draft });
    expect(created.status()).toBe(201);
    const { chain, revision } = (await created.json()) as { chain: StoredChain; revision: string };
    await page.goto(`/projects/${project.id}/chains/${chain.id}`);
    await expect(page.getByTestId('builder-chain-id')).toHaveText(chain.id);
    await openFirstStepEditor(page);
    await page.getByTestId('step-instruction').fill('My unsaved instruction.');
    await closeStepEditor(page);

    const external = await request.put(`/api/projects/${project.id}/chains/${chain.id}`, {
      headers: { 'x-loom-chain-revision': revision },
      data: { ...draft, steps: [{ ...draft.steps[0]!, instruction: 'External instruction.' }] },
    });
    expect(external.status()).toBe(200);
    await page.getByTestId('chain-save').click();
    await expect(page.getByTestId('chain-save-error')).toContainText('CHAIN_STALE');
    await expect(page.getByTestId('chain-dirty-indicator')).toContainText('Unsaved changes');
    await openFirstStepEditor(page);
    await expect(page.getByTestId('step-instruction')).toHaveValue('My unsaved instruction.');
    const stored = await request.get(`/api/projects/${project.id}/chains/${chain.id}`);
    expect(((await stored.json()) as { chain: StoredChain }).chain.steps[0]?.instruction).toBe('External instruction.');
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
