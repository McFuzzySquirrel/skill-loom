import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogService } from '../../src/server/catalog/merge.js';
import { createGlobalDraftService } from '../../src/server/chains/drafts.js';
import { exportBundle } from '../../src/server/chains/bundle.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { sharedBundleRoutes } from '../../src/server/routes/shared-bundles.js';
import { SHARED_LIBRARY_ERROR_CODES } from '../../src/server/bundles/shared-library.js';

let root: string;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe('shared bundle routes', () => {
  it('publishes only a reviewed source bundle and makes it browseable', async () => {
    root = await mkdtemp(join(tmpdir(), 'loom-shared-routes-'));
    const configDirectory = join(root, 'config');
    const sharedDirectory = join(root, 'shared');
    await mkdir(sharedDirectory);
    const configStore = createConfigStore({
      env: { LOOM_CONFIG_DIR: configDirectory },
      homeDirectory: () => join(root, 'home'),
    });
    const drafts = createGlobalDraftService(configDirectory);
    const draft = await drafts.create(configDirectory, {
      name: 'Shared scenario',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Review {{scope}}.' }],
      inputs: [{ name: 'scope', required: true }],
    });
    const catalogService: CatalogService = {
      defaultHarness: 'opencode',
      async getCatalog({ harness }) {
        return {
          harness,
          query: '',
          total: 0,
          counts: {
            total: 0,
            bySource: {
              project: 0, personal: 0, custom: 0, plugin: 0,
              builtin: 0, 'loom-extra': 0, remote: 0,
            },
          },
          groups: [],
          agents: [],
          warnings: [],
          elapsedMs: 0,
        };
      },
    };
    const app = Fastify({ logger: false });
    await app.register(sharedBundleRoutes, { configStore, draftService: drafts, catalogService });

    await app.inject({
      method: 'PUT',
      url: '/api/shared-bundles/config',
      payload: { directory: sharedDirectory },
    });
    const bundle = await exportBundle(draft, configDirectory, catalogService);
    const reviewFingerprint = createHash('sha256')
      .update(JSON.stringify(bundle), 'utf8')
      .digest('hex');
    const publish = await app.inject({
      method: 'POST',
      url: '/api/shared-bundles/publish',
      payload: {
        source: { type: 'draft', draftId: draft.id },
        displayName: 'Shared scenario',
        contentsReviewed: true,
        redistributionReviewed: true,
        reviewFingerprint,
      },
    });
    expect(publish.statusCode).toBe(201);
    const entry = publish.json<{ entry: { id: string; status: string } }>().entry;
    expect(entry.status).toBe('available');

    const list = await app.inject({ method: 'GET', url: '/api/shared-bundles' });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ entries: Array<{ id: string }> }>().entries.map(({ id }) => id))
      .toEqual([entry.id]);
    const read = await app.inject({
      method: 'GET',
      url: `/api/shared-bundles/${encodeURIComponent(entry.id)}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      bundle: { format: 'skill-loom-chain', chain: { name: 'Shared scenario' } },
    });

    await app.close();
  });

  it('rejects publication without content and redistribution review', async () => {
    root = await mkdtemp(join(tmpdir(), 'loom-shared-routes-review-'));
    const configStore = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => join(root, 'home'),
    });
    const app = Fastify({ logger: false });
    await app.register(sharedBundleRoutes, { configStore });
    const response = await app.inject({
      method: 'POST',
      url: '/api/shared-bundles/publish',
      payload: {
        source: { type: 'draft', draftId: 'draft' },
        displayName: 'Unreviewed',
        contentsReviewed: false,
        redistributionReviewed: false,
        reviewFingerprint: 'a'.repeat(64),
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    await app.close();
  });

  it('rejects publication when the reviewed draft changes before publish', async () => {
    root = await mkdtemp(join(tmpdir(), 'loom-shared-routes-stale-'));
    const configDirectory = join(root, 'config');
    const sharedDirectory = join(root, 'shared');
    await mkdir(sharedDirectory);
    const configStore = createConfigStore({
      env: { LOOM_CONFIG_DIR: configDirectory },
      homeDirectory: () => join(root, 'home'),
    });
    const drafts = createGlobalDraftService(configDirectory);
    const draft = await drafts.create(configDirectory, {
      name: 'Stale review',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Review the source.' }],
    });
    const catalogService: CatalogService = {
      defaultHarness: 'opencode',
      async getCatalog({ harness }) {
        return {
          harness,
          query: '',
          total: 0,
          counts: {
            total: 0,
            bySource: {
              project: 0, personal: 0, custom: 0, plugin: 0,
              builtin: 0, 'loom-extra': 0, remote: 0,
            },
          },
          groups: [],
          agents: [],
          warnings: [],
          elapsedMs: 0,
        };
      },
    };
    const app = Fastify({ logger: false });
    await app.register(sharedBundleRoutes, { configStore, draftService: drafts, catalogService });
    await app.inject({
      method: 'PUT',
      url: '/api/shared-bundles/config',
      payload: { directory: sharedDirectory },
    });

    const reviewedBundle = await exportBundle(draft, configDirectory, catalogService);
    const reviewFingerprint = createHash('sha256')
      .update(JSON.stringify(reviewedBundle), 'utf8')
      .digest('hex');
    await drafts.update(configDirectory, draft.id, {
      name: draft.name,
      harness: draft.harness,
      sessionMode: draft.sessionMode,
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Review changed content.' }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/shared-bundles/publish',
      payload: {
        source: { type: 'draft', draftId: draft.id },
        displayName: 'Stale review',
        contentsReviewed: true,
        redistributionReviewed: true,
        reviewFingerprint,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: SHARED_LIBRARY_ERROR_CODES.REVIEW_STALE },
    });
    expect((await (await app.inject({ method: 'GET', url: '/api/shared-bundles' }))
      .json<{ entries: unknown[] }>()).entries).toEqual([]);
    await app.close();
  });
});
