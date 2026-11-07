import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fixtureRoot: string;
let sharedDirectory: string;
let projectPath: string;

test.beforeAll(async () => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'loom-shared-bundles-e2e-')));
  sharedDirectory = join(fixtureRoot, 'shared');
  projectPath = join(fixtureRoot, 'recipient');
  await Promise.all([
    mkdir(sharedDirectory, { recursive: true }),
    mkdir(projectPath, { recursive: true }),
  ]);
});

test.afterAll(async () => {
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true });
});

test('reviewed drafts publish immutably and shared bundles import through review', async ({
  page,
  request,
}) => {
  const projectResponse = await request.post('/api/projects', {
    data: { mode: 'open', path: projectPath },
  });
  expect(projectResponse.ok()).toBe(true);
  const project = (await projectResponse.json() as { project: { id: string } }).project;

  const draftResponse = await request.post('/api/drafts', {
    data: {
      name: 'Shared acceptance draft',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Review {{scope}}.' }],
      inputs: [{ name: 'scope', required: true }],
    },
  });
  expect(draftResponse.ok()).toBe(true);
  const draft = (await draftResponse.json() as { chain: { id: string } }).chain;

  await page.goto('/shared-bundles');
  await page.getByLabel('Server-side directory path').fill(sharedDirectory);
  await page.getByRole('button', { name: 'Configure directory' }).click();
  await expect(page.getByText(sharedDirectory)).toBeVisible();

  await page.goto(`/drafts/${draft.id}`);
  await page.getByText('More actions').click();
  await page.getByTestId('publish-shared-bundle').click();
  await expect(page.getByRole('heading', { name: 'Publish to shared library' })).toBeVisible();
  await page.getByLabel(/I reviewed every instruction/).check();
  await page.getByLabel(/I reviewed applicable licenses/).check();
  const publishButton = page.getByRole('button', { name: 'Publish immutable bundle' });
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(page.getByRole('heading', { name: 'Publish to shared library' })).toBeHidden();

  await page.goto('/shared-bundles');
  await expect(page.getByText('Shared acceptance draft')).toBeVisible();
  await page.getByLabel('Import destination').selectOption(project.id);
  await page.getByRole('button', { name: 'Review and import' }).click();
  await expect(page.getByRole('heading', { name: 'Import chain bundle' })).toBeVisible();
  await expect(page.getByText('Previewing a bundle from the configured shared library.')).toBeVisible();
  await page.getByLabel('I reviewed and trust these instructions and packages.').check();
  await page.getByRole('button', { name: 'Import chain, skills, and agents' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/chains/[^/]+$`));
  await expect(page.getByTestId('chain-builder-page')).toBeVisible();
});
