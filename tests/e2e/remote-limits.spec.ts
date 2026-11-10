import { expect, test } from '@playwright/test';

test('configures global and per-repository catalog limits', async ({ page, request }) => {
  const initial = await request.get('/api/settings/remote-catalog-limits');
  expect(initial.ok()).toBe(true);
  const initialSettings = await initial.json() as {
    global: Record<string, number>;
    maximums: Record<string, number>;
  };
  const repository = `https://example.invalid/fixture-${String(process.pid)}.git`;
  const added = await request.post('/api/settings/remote-skill-sources', { data: { repository } });
  expect(added.ok()).toBe(true);
  const { source } = await added.json() as { source: { id: string } };
  try {
    await page.goto('/sources');
    const section = page.getByRole('region', { name: 'Remote catalog limits' });
    const packages = section.getByLabel('Skill packages per snapshot');
    await expect(packages).toBeHidden();
    const disclosure = section.locator('summary');
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(packages).toHaveValue(String(initialSettings.global.maxPackages));
    const packageSize = section.getByLabel('Size per skill package or agent (MB)', { exact: true });
    await expect(packageSize).toHaveValue(String(initialSettings.global.maxPackageBytes! / 1_000_000));
    await expect(section.getByRole('button', { name: 'Save limits' })).toBeDisabled();
    await packages.fill('1000');
    await expect(packageSize).toHaveAttribute('max', String(initialSettings.maximums.maxPackageBytes! / 1_000_000));
    await packageSize.fill('0');
    await section.getByRole('button', { name: 'Save limits' }).click();
    await expect(packageSize).toBeFocused();
    await packageSize.fill('0.000001');
    expect(await packageSize.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
    await packageSize.fill('1.000001');
    await section.getByLabel('Files per snapshot').fill('20000');
    await section.getByRole('button', { name: 'Save limits' }).click();
    await expect(section.getByRole('button', { name: 'Save limits' })).toBeDisabled();
    const saved = await request.get('/api/settings/remote-catalog-limits');
    expect(await saved.json()).toMatchObject({
      global: { maxPackageBytes: 1_000_001, maxSnapshotBytes: initialSettings.global.maxSnapshotBytes },
    });
    await section.getByLabel('Limits for').selectOption({ label: repository });
    await expect(packages).toHaveValue('1000');
    await packages.fill('1500');
    await packageSize.fill('0.5');
    await section.getByRole('button', { name: 'Save limits' }).click();
    await expect(section.getByRole('button', { name: 'Use global limits' })).toBeVisible();
    const overridden = await request.get('/api/settings/remote-skill-sources');
    expect(await overridden.json()).toMatchObject({
      remoteSkillSources: [expect.objectContaining({ id: source.id, limits: expect.objectContaining({ maxPackageBytes: 500_000 }) })],
    });
    await section.getByRole('button', { name: 'Use global limits' }).click();
    await expect(packages).toHaveValue('1000');
    await expect(packageSize).toHaveValue('1.000001');
    const sources = await request.get('/api/settings/remote-skill-sources');
    expect(await sources.json()).toMatchObject({
      remoteSkillSources: [expect.objectContaining({ id: source.id })],
    });

  } finally {
    await request.put('/api/settings/remote-catalog-limits', { data: { limits: initialSettings.global } });
    await request.delete(`/api/settings/remote-skill-sources/${source.id}`);
  }
});

test('protects unsaved limits from navigation and repository removal', async ({ page, request }) => {
  const repository = `https://example.invalid/dirty-${String(process.pid)}.git`;
  const added = await request.post('/api/settings/remote-skill-sources', { data: { repository } });
  const { source } = await added.json() as { source: { id: string } };
  try {
    await page.goto('/sources');
    const section = page.getByRole('region', { name: 'Remote catalog limits' });
    await section.locator('summary').click();
    await section.getByLabel('Limits for').selectOption({ label: repository });
    const packages = section.getByLabel('Skill packages per snapshot');
    await packages.fill('999');
    await expect(page.getByRole('button', { name: 'Unregister' })).toBeDisabled();
    await section.locator('summary').click();
    await expect(packages).toBeHidden();
    await page.getByRole('link', { name: 'select candidate skills for a reusable workflow handoff' }).click();
    const confirmation = page.getByRole('group', { name: 'Discard unsaved catalog limits?' });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('heading')).toBeFocused();
    await confirmation.getByRole('button', { name: 'Stay and keep editing' }).click();
    await section.locator('summary').click();
    await expect(packages).toHaveValue('999');
    await section.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('button', { name: 'Unregister' })).toBeEnabled();
  } finally {
    await request.delete(`/api/settings/remote-skill-sources/${source.id}`);
  }
});

test('refreshes an explicitly selected saved commit', async ({ page, request }) => {
  const repository = `https://example.invalid/saved-${String(process.pid)}.git`;
  const added = await request.post('/api/settings/remote-skill-sources', { data: { repository, ref: 'main' } });
  const { source } = await added.json() as { source: { id: string } };
  const revision = 'a'.repeat(40);
  const snapshot = {
    version: 1, sourceId: source.id, repository, revision,
    packages: [{
      name: 'Small skill', description: 'Size display fixture', repositoryPath: 'skills/small',
      directory: 'c'.repeat(64), files: 1, bytes: 1234, fingerprint: 'b'.repeat(64),
    }],
    agents: [],
  };
  let releaseRefresh: () => void = () => {};
  const pending = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let body: unknown;
  await page.route(`**/api/settings/remote-skill-sources/${source.id}/snapshots`, async (route) => {
    await route.fulfill({ json: { snapshots: [snapshot] } });
  });
  await page.route(`**/api/settings/remote-skill-sources/${source.id}/refresh`, async (route) => {
    body = route.request().postDataJSON();
    await pending;
    await route.fulfill({ status: 201, json: { snapshot } });
  });
  try {
    await page.goto('/sources');
    await expect(page.getByText('(1 files, 0.001234 MB)', { exact: false })).toBeVisible();
    const button = page.getByRole('button', { name: `Refresh saved commit ${revision}` });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toBeDisabled();
    await expect(button).toHaveText('Refreshing saved commit…');
    await expect.poll(() => body).toEqual({ revision });
    releaseRefresh();
    await expect(button).toBeEnabled();
    await expect(page.getByRole('status')).toContainText(`Refreshed ${repository} at commit ${revision.slice(0, 12)}`);
  } finally {
    releaseRefresh();
    await request.delete(`/api/settings/remote-skill-sources/${source.id}`);
  }
});
