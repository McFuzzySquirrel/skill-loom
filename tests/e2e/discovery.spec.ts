import { expect, test } from '@playwright/test';

const revision = 'a'.repeat(40);
const source = {
  id: 'test-source',
  repository: 'https://example.test/skills.git',
};
const packageFixtures = [
  { name: 'alpha-skill', repositoryPath: 'skills/alpha' },
  { name: 'beta-skill', repositoryPath: 'skills/beta' },
].map((skill, index) => ({
  ...skill,
  directory: String(index + 1).repeat(64),
  files: 1,
  bytes: 48,
  fingerprint: String(index + 3).repeat(64),
  description: `Fixture ${skill.name}`,
}));

async function stubDiscovery(
  page: import('@playwright/test').Page,
  options: {
    failRequestNumber?: number;
    validateRequest?: (request: {
      goal: string;
      harness: string;
      candidates: Array<{ sourceId: string; revision: string; repositoryPath: string; fingerprint: string }>;
    }) => void;
  } = {},
) {
  await page.route('**/api/settings/remote-skill-sources', async (route) => {
    await route.fulfill({ json: { remoteSkillSources: [source] } });
  });
  await page.route('**/api/settings/remote-skill-sources/test-source/snapshots', async (route) => {
    await route.fulfill({
      json: {
        snapshots: [{
          version: 1,
          sourceId: source.id,
          repository: source.repository,
          revision,
          packages: packageFixtures,
          agents: [],
        }],
      },
    });
  });
  let requestNumber = 0;
  await page.route('**/api/discovery/handoffs', async (route) => {
    requestNumber += 1;
    const request = route.request().postDataJSON() as {
      goal: string;
      harness: string;
      candidates: Array<{ sourceId: string; revision: string; repositoryPath: string; fingerprint: string }>;
    };
    options.validateRequest?.(request);
    for (const candidate of request.candidates) {
      expect(Object.keys(candidate).sort()).toEqual([
        'fingerprint',
        'repositoryPath',
        'revision',
        'sourceId',
      ]);
    }

    if (requestNumber === options.failRequestNumber) {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'INSPECTION_TEMPORARY', message: 'The pinned package could not be read.' } },
      });
      return;
    }

    const candidates = request.candidates.map((selected) => {
      const fixture = packageFixtures.find((candidate) => candidate.repositoryPath === selected.repositoryPath);
      expect(fixture).toBeDefined();
      return {
        sourceId: selected.sourceId,
        revision: selected.revision,
        repositoryPath: selected.repositoryPath,
        name: fixture!.name,
        fingerprint: selected.fingerprint,
        files: [{ path: 'SKILL.md', content: packageContent(fixture!.name), executable: false }],
      };
    });
    await route.fulfill({
      json: {
        format: 'skill-loom-discovery-handoff',
        version: 1,
        goal: request.goal,
        harness: request.harness,
        createdAt: '2026-11-08T00:00:00.000Z',
        candidates,
        fingerprint: 'f'.repeat(64),
      },
    });
  });
}

function packageContent(name: string): string {
  return Buffer.from(`---\nname: ${name}\ndescription: Fixture.\n---\nReview.\n`).toString('base64');
}

test('downloads the CLI workflow skill with the keyboard', async ({ page }) => {
  await page.goto('/discovery');
  const link = page.getByRole('link', { name: 'Download CLI workflow skill' });
  await expect(link).toHaveAttribute('href', '/api/portable-skill/loom-chain-workflow');
  await link.focus();
  await expect(link).toBeFocused();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toBe('loom-chain-workflow.zip');
});

test('discovery bulk-selects hidden candidates and downloads only an explicitly reviewed handoff', async ({
  page,
}) => {
  await stubDiscovery(page, {
    validateRequest(request) {
      expect(request.goal).toBe('Review a release workflow');
      expect(request.harness).toBe('opencode');
      expect(request.candidates).toHaveLength(2);
      expect(request.candidates.map((candidate) => candidate.repositoryPath)).toEqual([
        'skills/alpha',
        'skills/beta',
      ]);
    },
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Start discovery' }).click();
  await expect(page.getByRole('heading', { name: 'Discover reusable workflows' })).toBeVisible();
  await page.getByLabel('What outcome do you want?').fill('Review a release workflow');
  await page.getByLabel('Search candidates').fill('alpha');
  await expect(page.getByRole('checkbox', { name: /Select beta-skill/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select all available skills' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 selected · 2 available' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Select alpha-skill/ })).toBeChecked();
  await page.getByRole('button', { name: 'Prepare selected candidates for review' }).click();
  await expect(page.getByRole('heading', { name: '4. Review and hand off' })).toBeVisible();
  await expect(page.getByText('beta-skill', { exact: true })).toBeVisible();
  await page.getByLabel('I reviewed the goal, complete package inventory, and contents.').check();
  await page.getByLabel('I separately reviewed whether sharing these package contents is permitted.').check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed handoff' }).click();
  const handoffDownload = await download;
  expect(handoffDownload.suggestedFilename()).toBe('skill-loom-discovery.loom-discovery.json');
});

test('discovery inspection shows local errors and retries without losing prepared review', async ({ page }) => {
  await stubDiscovery(page, { failRequestNumber: 2 });
  await page.goto('/');
  await page.getByRole('link', { name: 'Start discovery' }).click();
  await expect(page.getByRole('heading', { name: 'Discover reusable workflows' })).toBeVisible();
  await page.getByLabel('What outcome do you want?').fill('Review a release workflow');
  await page.getByLabel('Target harness').selectOption('copilot');
  await page.getByRole('checkbox', { name: /Select alpha-skill/ }).check();
  await page.getByRole('button', { name: 'Prepare selected candidates for review' }).click();
  await expect(page.getByRole('heading', { name: '4. Review and hand off' })).toBeVisible();

  const alpha = page.locator('.discovery-candidate').filter({ hasText: 'alpha-skill' }).first();
  const inspect = alpha.getByRole('button', { name: 'Inspect package and SKILL.md' });
  await inspect.focus();
  await page.keyboard.press('Enter');
  const inspectionError = alpha.getByRole('alert');
  await expect(inspectionError).toContainText('The pinned package could not be read.');
  await expect(inspectionError).toContainText('INSPECTION_TEMPORARY');
  await expect(inspectionError).toContainText('HTTP 503');
  await expect(page.getByRole('heading', { name: '4. Review and hand off' })).toBeVisible();

  await alpha.getByRole('button', { name: 'Retry inspection' }).click();
  await expect(alpha.getByText('Verified package files (1)')).toBeVisible();
  await expect(alpha.locator('pre')).toContainText('Review.');
  await expect(page.getByRole('status').filter({
    hasText: 'Inspected alpha-skill. Verified package files are available below.',
  })).toBeVisible();
  await expect(page.getByLabel('What outcome do you want?')).toHaveValue('Review a release workflow');
  await expect(page.getByRole('checkbox', { name: /Select alpha-skill/ })).toBeChecked();
  await expect(page.getByRole('heading', { name: '4. Review and hand off' })).toBeVisible();
});

test('preparing a managed discovery workspace does not start a harness', async ({ page }) => {
  const workspaceId = 'c29e8f69-dc8f-4d69-b2fc-6eaef0e08b44';
  const projectId = 'managed-discovery-project';
  await stubDiscovery(page);
  await page.route('**/api/discovery/workspaces', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { workspaces: [] } });
      return;
    }
    const request = route.request().postDataJSON() as {
      autoImport: boolean;
      contentsReviewed: boolean;
      redistributionReviewed: boolean;
      candidates: Array<Record<string, unknown>>;
    };
    expect(request.autoImport).toBe(true);
    expect(request.contentsReviewed).toBe(true);
    expect(request.redistributionReviewed).toBe(true);
    expect(Object.keys(request.candidates[0] ?? {}).sort()).toEqual([
      'fingerprint',
      'repositoryPath',
      'revision',
      'sourceId',
    ]);
    await route.fulfill({
      status: 201,
      json: {
        workspace: {
          id: workspaceId,
          projectId,
          chainId: 'interactive-discovery',
          harness: 'copilot',
          createdAt: '2026-11-08T00:00:00.000Z',
          handoffFingerprint: 'f'.repeat(64),
          autoImport: true,
          path: `/tmp/managed-discovery/${workspaceId}`,
        },
        handoff: {
          format: 'skill-loom-discovery-handoff',
          version: 1,
          goal: 'Review a release workflow',
          harness: 'copilot',
          createdAt: '2026-11-08T00:00:00.000Z',
          candidates: [{
            sourceId: source.id,
            revision,
            repositoryPath: 'skills/alpha',
            name: 'alpha-skill',
            fingerprint: packageFixtures[0]!.fingerprint,
            files: [{ path: 'SKILL.md', content: packageContent('alpha-skill'), executable: false }],
          }],
          fingerprint: 'f'.repeat(64),
        },
      },
    });
  });
  let runRequests = 0;
  await page.route('**/api/projects/*/runs', async (route) => {
    runRequests += 1;
    await route.fulfill({ status: 500, json: { error: { code: 'UNEXPECTED', message: 'Unexpected launch' } } });
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Start discovery' }).click();
  await page.getByLabel('What outcome do you want?').fill('Review a release workflow');
  await page.getByLabel('Target harness').selectOption('copilot');
  await page.getByRole('checkbox', { name: /Select alpha-skill/ }).check();
  await page.getByRole('button', { name: 'Prepare selected candidates for review' }).click();
  await expect(page.getByRole('heading', { name: '4. Review and hand off' })).toBeVisible();
  await page.getByLabel('I reviewed the goal, complete package inventory, and contents.').check();
  await page.getByLabel('I separately reviewed whether sharing these package contents is permitted.').check();
  await page.getByLabel(/After I review the exact result/).check();
  await page.getByRole('button', { name: 'Prepare discovery workspace' }).click();

  await expect(page.getByRole('link', { name: 'Preflight and start discovery' })).toHaveAttribute(
    'href',
    `/discovery/workspaces/${workspaceId}/start`,
  );
  await expect(page.getByRole('status').filter({
    hasText: 'No CLI was started.',
  })).toBeVisible();
  expect(runRequests).toBe(0);
});
