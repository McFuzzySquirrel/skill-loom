import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogService } from '../../src/server/catalog/merge.js';
import { exportBundle } from '../../src/server/chains/bundle.js';
import {
  DraftBundleStoreError,
  readDraftBundle,
  saveDraftBundle,
} from '../../src/server/chains/draft-bundles.js';
import { createChainService } from '../../src/server/chains/service.js';

let root: string;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe('frozen global-draft packages', () => {
  it('stores a parsed versioned bundle atomically and leaves corrupt bytes untouched', async () => {
    root = await mkdtemp(join(tmpdir(), 'loom-draft-bundles-'));
    const configDirectory = join(root, 'config');
    const projectPath = join(root, 'project');
    await mkdir(projectPath);
    const chain = await createChainService().create(projectPath, {
      name: 'Frozen package test',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Review the outcome.' }],
      inputs: [],
    });
    const catalog: CatalogService = {
      defaultHarness: 'opencode',
      async getCatalog() {
        throw new Error('Instruction-only bundle export must not discover skills.');
      },
    };
    const bundle = await exportBundle(chain, projectPath, catalog);

    await saveDraftBundle(configDirectory, chain.id, chain, bundle);

    expect(await readDraftBundle(configDirectory, chain.id)).toEqual(bundle);
    const file = join(configDirectory, 'draft-packages', `${chain.id}.json`);
    const corrupt = '{not json';
    await writeFile(file, corrupt);
    await expect(readDraftBundle(configDirectory, chain.id)).rejects.toBeInstanceOf(
      DraftBundleStoreError,
    );
    expect(await readFile(file, 'utf8')).toBe(corrupt);
    await expect(readDraftBundle(configDirectory, '../outside')).rejects.toBeInstanceOf(
      DraftBundleStoreError,
    );
  });
});
