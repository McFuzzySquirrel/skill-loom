import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const skillName = 'loom-e2e-goal-planning';
const skillBody = 'Use the supplied outcome to build a clear, reviewable plan.';

let fixtureRoot: string;
let projectPath: string;
let sourceProjectId: string;
let workspaceId: string | null;

async function openSourceProject(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/projects', {
    data: { mode: 'open', path: projectPath },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json() as { project: { id: string } };
  sourceProjectId = body.project.id;
}

async function createSourceSkill(): Promise<void> {
  const skillPath = join(projectPath, '.agents', 'skills', skillName);
  await mkdir(skillPath, { recursive: true });
  await writeFile(
    join(skillPath, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: Helps shape a goal into a plan.\n---\n${skillBody}\n`,
  );
}

test.beforeEach(async ({ request }) => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-scenario-discovery-e2e-'));
  projectPath = join(fixtureRoot, 'source-project');
  await createSourceSkill();
  await openSourceProject(request);
  workspaceId = null;
});

test.afterEach(async ({ request, page }) => {
  if (workspaceId !== null) {
    await request.delete(`/api/test-workspaces/${workspaceId}`).catch(() => undefined);
  }
  await page.evaluate(async () => {
    const active = await fetch('/api/runs/active').then((response) =>
      response.ok ? response.json() as Promise<{ id?: string } | null> : null,
    ).catch(() => null);
    if (active?.id) {
      await fetch(`/api/runs/${active.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'abort' }),
      }).catch(() => undefined);
    }
  }).catch(() => undefined);
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('creates a disposable scenario workspace after reviewing its candidate skill', async ({ page, request }) => {
  await page.goto('/test-workspaces');
  await page.getByRole('button', { name: 'Start scenario discovery' }).click();
  await page.getByLabel('Goal or desired outcome').fill('Prepare a release readiness checklist.');
  await page.getByLabel('Harness').selectOption('opencode');
  await page.getByLabel('Also include packages from a registered project (optional)')
    .selectOption(sourceProjectId);

  const review = page.getByRole('button', { name: `Review ${skillName} instructions` });
  await expect(review).toBeVisible();
  await review.focus();
  await review.press('Enter');
  await expect(page.getByText(skillBody)).toBeVisible();

  const candidate = page.getByRole('checkbox', { name: skillName });
  await candidate.focus();
  await candidate.press('Space');
  await expect(candidate).toBeChecked();
  const create = page.getByRole('button', { name: 'Create discovery workspace' });
  await expect(create).toBeEnabled();
  await create.focus();
  await create.press('Enter');

  await expect(page.getByRole('heading', { level: 1, name: 'Workflow designer' })).toBeVisible();
  const response = await request.get('/api/test-workspaces');
  expect(response.ok()).toBe(true);
  const body = await response.json() as {
    workspaces: Array<{
      id: string;
      purpose?: string;
      discoveryGoal?: string;
      discoverySkillNames?: string[];
    }>;
  };
  const created = body.workspaces.find((workspace) =>
    workspace.purpose === 'discovery',
  );
  expect(created).toMatchObject({
    purpose: 'discovery',
    discoveryGoal: 'Prepare a release readiness checklist.',
    discoverySkillNames: [skillName],
  });
  workspaceId = created?.id ?? null;

  await page.goto('/test-workspaces');
  await expect(page.getByText('Prepare a release readiness checklist.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Run discovery' })).toBeVisible();
});
