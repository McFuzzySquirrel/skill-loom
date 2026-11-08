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

function packageContent(name: string): string {
  return Buffer.from(`---\nname: ${name}\ndescription: Fixture.\n---\nReview.\n`).toString('base64');
}

test('discovery bulk-selects hidden candidates and downloads only an explicitly reviewed handoff', async ({
  page,
}) => {
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
  await page.route('**/api/discovery/handoffs', async (route) => {
    const request = route.request().postDataJSON() as {
      goal: string;
      harness: string;
      candidates: Array<{ name?: string; sourceId: string; revision: string; repositoryPath: string; fingerprint: string }>;
    };
    expect(request.goal).toBe('Review a release workflow');
    expect(request.harness).toBe('opencode');
    expect(request.candidates).toHaveLength(2);
    expect(request.candidates.map((candidate) => candidate.repositoryPath)).toEqual([
      'skills/alpha',
      'skills/beta',
    ]);
    const candidates = packageFixtures.map((skill) => ({
      sourceId: source.id,
      revision,
      repositoryPath: skill.repositoryPath,
      name: skill.name,
      fingerprint: skill.fingerprint,
      files: [{ path: 'SKILL.md', content: packageContent(skill.name), executable: false }],
    }));
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
