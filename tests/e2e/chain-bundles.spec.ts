import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root: string;

test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-sharing-e2e-'));
});

test.afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('shares mixed chains through a reviewed download and import with explicit conflict reuse', async ({ page, request }) => {
  const source = join(root, 'source');
  const target = join(root, 'target');
  const skillDirectory = join(source, '.opencode', 'skills', 'sharing-probe');
  await mkdir(join(skillDirectory, 'scripts'), { recursive: true });
  await mkdir(target);
  const skill = '---\nname: sharing-probe\ndescription: Sharing fixture\n---\nReview the changes.\n';
  await writeFile(join(skillDirectory, 'SKILL.md'), skill);
  await writeFile(join(skillDirectory, 'scripts', 'probe.sh'), 'exit 0\n');
  const ids: string[] = [];
  for (const path of [source, target]) {
    const response = await request.post('/api/projects', { data: { mode: 'open', path } });
    expect(response.ok()).toBe(true);
    ids.push((await response.json() as { project: { id: string } }).project.id);
  }
  const created = await request.post(`/api/projects/${ids[0]}/chains`, {
    data: {
      name: 'Shared mixed chain',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        { id: 'skill', skillName: 'sharing-probe', instruction: 'Review {{task}}.' },
        { id: 'instruction', kind: 'instruction', label: 'Summarize', instruction: 'Summarize the findings.' },
      ],
      inputs: [{ name: 'task', required: true, defaultValue: 'Do not share this default' }],
      automaticPermissionOptIn: true,
    },
  });
  expect(created.status()).toBe(201);
  await page.goto(`/projects/${ids[0]}`);
  await page.getByRole('button', { name: 'Export Shared mixed chain', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export chain bundle' });
  await expect(exportDialog.getByText('Shared mixed chain', { exact: true })).toBeVisible();
  await expect(exportDialog.getByRole('button', { name: 'Download bundle' })).toBeDisabled();
  await exportDialog.getByText('sharing-probe — 2 files', { exact: true }).click();
  await expect(exportDialog.getByText('scripts/probe.sh', { exact: true })).toBeVisible();
  await exportDialog.getByRole('checkbox').check();
  const downloaded = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Download bundle' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('Shared-mixed-chain.loom.json');
  const bundlePath = join(root, download.suggestedFilename());
  await download.saveAs(bundlePath);
  expect(await readFile(bundlePath, 'utf8')).not.toContain('Do not share this default');

  await page.goto(`/projects/${ids[1]}`);
  await page.getByRole('button', { name: 'Import bundle', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import chain bundle' });
  await importDialog.getByLabel('Chain bundle (.loom.json)').setInputFiles(bundlePath);
  await expect(importDialog.getByText('Shared mixed chain', { exact: true })).toBeVisible();
  await expect(importDialog.getByRole('button', { name: 'Import chain and skills' })).toBeDisabled();
  await importDialog.getByRole('checkbox', { name: 'I reviewed and trust these instructions and packages.' }).check();
  await importDialog.getByRole('button', { name: 'Import chain and skills' }).click();
  await expect(importDialog).not.toBeVisible();
  const cards = page.getByTestId('chain-card');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('2 steps');
  expect(await readFile(join(target, '.agents', 'skills', 'sharing-probe', 'SKILL.md'), 'utf8')).toBe(skill);
  const listing = await request.get(`/api/projects/${ids[1]}/chains`);
  const imported = (await listing.json() as { chains: Array<{ automaticPermissionOptIn: boolean; steps: Array<{ kind?: string }> }> }).chains[0]!;
  expect(imported.automaticPermissionOptIn).toBe(false);
  expect(imported.steps[1]!.kind).toBe('instruction');

  await page.getByRole('button', { name: 'Import bundle', exact: true }).click();
  await importDialog.getByLabel('Chain bundle (.loom.json)').setInputFiles(bundlePath);
  const reuse = importDialog.getByRole('checkbox', { name: /Reuse installed "sharing-probe"/ });
  await expect(reuse).toBeVisible();
  await importDialog.getByRole('checkbox', { name: 'I reviewed and trust these instructions and packages.' }).check();
  await expect(importDialog.getByRole('button', { name: 'Import chain and skills' })).toBeDisabled();
  await reuse.check();
  await importDialog.getByRole('button', { name: 'Import chain and skills' }).click();
  await expect(importDialog).not.toBeVisible();
  await expect(cards).toHaveCount(2);
});

test('surfaces invalid bundle files without installing anything', async ({ page, request }) => {
  const target = join(root, 'invalid');
  await mkdir(target);
  const registered = await request.post('/api/projects', { data: { mode: 'open', path: target } });
  const id = (await registered.json() as { project: { id: string } }).project.id;
  await page.goto(`/projects/${id}`);
  await page.getByRole('button', { name: 'Import bundle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import chain bundle' });
  await dialog.getByLabel('Chain bundle (.loom.json)').setInputFiles({
    name: 'broken.loom.json', mimeType: 'application/json', buffer: Buffer.from('{broken'),
  });
  await expect(dialog.getByText('Select a valid JSON chain bundle.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chain-card')).toHaveCount(0);
});
