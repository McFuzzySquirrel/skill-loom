import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;
let projectPath: string;
let skillProjectPath: string;

test.beforeAll(async () => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'loom-scenarios-e2e-')));
  projectPath = join(fixtureRoot, `scenario-project-${runSuffix}`);
  skillProjectPath = join(fixtureRoot, `scenario-skill-project-${runSuffix}`);
  await mkdir(projectPath, { recursive: true });
  await mkdir(skillProjectPath, { recursive: true });
});

test.afterAll(async () => {
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('filters examples, discloses skill sources, copies to the builder, and preflights missing skills', async ({
  page,
  request,
}) => {
  await page.route('**/api/projects/recent', (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  await page.goto('/scenarios');

  await expect(page.getByTestId('scenario-catalog')).toBeVisible();
  await expect(page.getByText('Open a project before copying an example.')).toBeVisible();
  await expect(page.getByTestId('scenario-copy').first()).toBeDisabled();
  await expect(page.getByTestId('scenario-disclaimer')).toContainText(
    'bundled as pinned snapshots',
  );

  await page.unroute('**/api/projects/recent');
  const projectResponse = await request.post('/api/projects', {
    data: { mode: 'open', path: projectPath },
  });
  expect(projectResponse.ok()).toBe(true);
  const project = (await projectResponse.json()) as {
    project: { id: string };
  };
  await page.reload();

  const audienceFilter = page.getByTestId('scenario-audience');
  await audienceFilter.selectOption('app-developer');
  await expect(page.getByTestId('scenario-card')).toHaveCount(3);

  const search = page.getByTestId('scenario-search');
  await search.fill('app mvp');
  const card = page.locator('[data-testid="scenario-card"][data-scenario-id="app-mvp"]');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('scenario-card')).toHaveCount(1);
  await card.getByTestId('scenario-variant').selectOption('fastapi');
  await card.getByText('View recipe, requirements, and sources').click();
  await expect(card.getByTestId('scenario-skill-source')).toContainText('fastapi-expert');
  await expect(card.getByTestId('scenario-skill-source')).toContainText('MIT');

  await page.getByTestId('scenario-project').selectOption(project.project.id);
  await card.getByTestId('scenario-copy').click();
  await expect(page.getByTestId('chain-builder-page')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Workflow designer' })).toBeVisible();
  await expect(page.getByTestId('step-list-count')).toHaveText('5 steps');
  await expect(page.getByTestId('chain-dirty-indicator')).toContainText('All changes saved');

  const chainResponse = await request.get(
    `/api/projects/${encodeURIComponent(project.project.id)}/chains`,
  );
  expect(chainResponse.ok()).toBe(true);
  const chains = (await chainResponse.json()) as {
    chains: Array<{
      id: string;
      name: string;
      sessionMode: string;
      automaticPermissionOptIn: boolean;
      steps: Array<{ skillName?: string }>;
    }>;
  };
  const copied = chains.chains.find((chain) => chain.name.includes('Python API'));
  expect(copied).toBeDefined();
  expect(copied).toMatchObject({
    sessionMode: 'shared',
    automaticPermissionOptIn: false,
  });
  expect(copied?.steps.some((step) => step.skillName === 'fastapi-expert')).toBe(true);

  await page.getByText('More actions').click();
  await page.getByTestId('chain-run-from-builder').click();
  await expect(page.getByTestId('run-start-page')).toBeVisible();
  await page.getByTestId('preflight-run').click();
  const missingSkill = page
    .getByTestId('preflight-blocking')
    .locator('[data-testid="preflight-finding"][data-check-id="skill"]');
  await expect(missingSkill).toContainText('fastapi-expert');
  await expect(page.getByTestId('start-run')).toBeDisabled();
});

test('adds a bundled skill only after an explicit project action', async ({ page, request }) => {
  const projectResponse = await request.post('/api/projects', {
    data: { mode: 'open', path: skillProjectPath },
  });
  expect(projectResponse.ok()).toBe(true);
  const project = (await projectResponse.json()) as {
    project: { id: string };
  };

  await page.goto('/scenarios');
  await page.getByTestId('scenario-project').selectOption(project.project.id);
  await page.getByTestId('scenario-search').fill('business performance');
  const card = page.locator(
    '[data-testid="scenario-card"][data-scenario-id="business-performance-review"]',
  );
  await card.getByText('View recipe, requirements, and sources').click();
  const addSkill = card.getByTestId('scenario-add-skill').first();
  await expect(addSkill).toHaveAttribute('data-skill-name', 'minimax-xlsx');
  await addSkill.click();
  await expect(page.getByTestId('scenario-skill-copy-success')).toContainText(
    'Added minimax-xlsx',
  );
  await expect(addSkill).toHaveText('Added to project');

  const catalogResponse = await request.get(
    `/api/projects/${encodeURIComponent(project.project.id)}/catalog?harness=opencode`,
  );
  expect(catalogResponse.ok()).toBe(true);
  const catalog = (await catalogResponse.json()) as {
    groups: Array<{
      source: string;
      entries: Array<{ name: string; enabled: boolean }>;
    }>;
  };
  expect(
    catalog.groups.some(
      (group) =>
        group.source === 'project' &&
        group.entries.some((entry) => entry.name === 'minimax-xlsx' && entry.enabled),
    ),
  ).toBe(true);
});
