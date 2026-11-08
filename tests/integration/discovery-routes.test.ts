import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import {
  refreshRemoteSkillSource,
  type RemoteSourceGitRunner,
  unregisterRemoteSkillSource,
} from '../../src/server/catalog/remote.js';
import { createConfigStore, type ConfigStore } from '../../src/server/config/store.js';
import { DiscoveryHandoffSchema } from '../../src/shared/discovery-handoff.js';

const revision = 'a'.repeat(40);
const skillBlob = 'b'.repeat(40);
const scriptBlob = 'c'.repeat(40);
const skillContent = '---\nname: handoff-skill\ndescription: A review fixture.\n---\nReview carefully.\n';
const scriptContent = '#!/bin/sh\nprintf safe\n';

let root: string;
let store: ConfigStore;
let app: FastifyInstance;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-discovery-routes-'));
  store = createConfigStore({
    env: { LOOM_CONFIG_DIR: join(root, 'config') },
    homeDirectory: () => join(root, 'home'),
  });
  await mkdir(join(root, 'staging'));
  await store.update({
    remoteSkillSources: [{
      id: 'test-source',
      repository: 'https://example.test/skills.git',
    }],
  });
  const gitRunner: RemoteSourceGitRunner = async (args) => {
    if (args[0] === 'clone' || args[1] === 'fetch') return { stdout: '' };
    if (args.includes('rev-parse')) return { stdout: `${revision}\n` };
    if (args.includes('ls-tree')) {
      return {
        stdout: [
          `100644 blob ${skillBlob}\tcollection/handoff-skill/SKILL.md\0`,
          `100755 blob ${scriptBlob}\tcollection/handoff-skill/scripts/check.sh\0`,
        ].join(''),
      };
    }
    if (args.includes('cat-file')) {
      const content = args.at(-1) === skillBlob ? skillContent : scriptContent;
      return { stdout: content };
    }
    throw new Error(`Unexpected git command: ${args.join(' ')}`);
  };
  await refreshRemoteSkillSource(store, 'test-source', {
    gitRunner,
    temporaryDirectory: join(root, 'staging'),
  });
  app = await buildApp({ env: {}, serveStatic: false, configStore: store });
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe('discovery handoff route', () => {
  it('prepares exact pinned package bytes without storing a handoff', async () => {
    const snapshot = (await import('../../src/server/catalog/remote.js')).listRemoteSkillSnapshots;
    const snapshots = await snapshot(store.getConfigDir(), 'test-source');
    const selected = snapshots[0]!.packages[0]!;
    const response = await app.inject({
      method: 'POST',
      url: '/api/discovery/handoffs',
      payload: {
        goal: 'Review the example package',
        harness: 'opencode',
        candidates: [{
          sourceId: 'test-source',
          revision,
          repositoryPath: selected.repositoryPath,
          fingerprint: selected.fingerprint,
        }],
      },
    });

    expect(response.statusCode).toBe(200);
    const handoff = response.json();
    expect(DiscoveryHandoffSchema.safeParse(handoff).success).toBe(true);
    expect(handoff).not.toHaveProperty('repository');
    expect(handoff.candidates[0]).toMatchObject({
      name: 'handoff-skill',
      sourceId: 'test-source',
      revision,
      repositoryPath: 'collection/handoff-skill',
      fingerprint: selected.fingerprint,
    });
    expect(handoff.candidates[0].files).toEqual([
      {
        path: 'SKILL.md',
        content: Buffer.from(skillContent).toString('base64'),
        executable: false,
      },
      {
        path: 'scripts/check.sh',
        content: Buffer.from(scriptContent).toString('base64'),
        executable: true,
      },
    ]);
    const { fingerprint, ...body } = handoff;
    expect(fingerprint).toBe(createHash('sha256').update(JSON.stringify(body)).digest('hex'));
    expect(await readdir(join(store.getConfigDir(), 'catalog-sources', 'test-source'))).toEqual([revision]);
    expect(await readdir(join(store.getConfigDir(), 'catalog-sources', 'test-source', revision))).toContain('snapshot.json');
  });

  it('rejects invalid identities and tampered pinned snapshot files', async () => {
    const { listRemoteSkillSnapshots } = await import('../../src/server/catalog/remote.js');
    const snapshot = (await listRemoteSkillSnapshots(store.getConfigDir(), 'test-source'))[0]!;
    const pkg = snapshot.packages[0]!;
    const requestBody = {
      goal: 'Inspect this skill',
      harness: 'copilot',
      candidates: [{
        sourceId: snapshot.sourceId,
        revision: snapshot.revision,
        repositoryPath: pkg.repositoryPath,
        fingerprint: pkg.fingerprint,
      }],
    };
    const stale = await app.inject({
      method: 'POST',
      url: '/api/discovery/handoffs',
      payload: { ...requestBody, candidates: [{ ...requestBody.candidates[0], fingerprint: '0'.repeat(64) }] },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'DISCOVERY_CANDIDATE_UNAVAILABLE' } });

    const packagePath = join(
      store.getConfigDir(),
      'catalog-sources',
      snapshot.sourceId,
      snapshot.revision,
      'packages',
      pkg.directory,
      'SKILL.md',
    );
    await writeFile(packagePath, 'tampered package contents');
    const tampered = await app.inject({
      method: 'POST',
      url: '/api/discovery/handoffs',
      payload: requestBody,
    });
    expect(tampered.statusCode).toBe(422);
    expect(tampered.json()).toMatchObject({ error: { code: 'DISCOVERY_SNAPSHOT_UNSAFE' } });
    await expect(readFile(packagePath, 'utf8')).resolves.toBe('tampered package contents');
  });

  it('rejects malformed or duplicate candidate identities', async () => {
    const withDisplayMetadata = await app.inject({
      method: 'POST',
      url: '/api/discovery/handoffs',
      payload: {
        goal: 'Review skills',
        harness: 'opencode',
        candidates: [{
          sourceId: 'test-source',
          revision,
          repositoryPath: 'collection/handoff-skill',
          fingerprint: '1'.repeat(64),
          name: 'handoff-skill',
        }],
      },
    });
    expect(withDisplayMetadata.statusCode).toBe(422);
    expect(withDisplayMetadata.json()).toMatchObject({
      error: { code: 'DISCOVERY_CANDIDATE_INVALID' },
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/discovery/handoffs',
      payload: {
        goal: 'Review skills',
        harness: 'opencode',
        candidates: [
          { sourceId: 'test-source', revision, repositoryPath: 'x', fingerprint: '1'.repeat(64) },
          { sourceId: 'test-source', revision, repositoryPath: 'x', fingerprint: '1'.repeat(64) },
        ],
      },
    });
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.json()).toMatchObject({ error: { code: 'DISCOVERY_CANDIDATE_INVALID' } });
  });

  it('creates a retained blank workspace only from the reviewed pinned handoff', async () => {
    const { listRemoteSkillSnapshots } = await import('../../src/server/catalog/remote.js');
    const snapshot = (await listRemoteSkillSnapshots(store.getConfigDir(), 'test-source'))[0]!;
    const pkg = snapshot.packages[0]!;
    const identity = {
      sourceId: snapshot.sourceId,
      revision: snapshot.revision,
      repositoryPath: pkg.repositoryPath,
      fingerprint: pkg.fingerprint,
    };
    const handoffResponse = await app.inject({
      method: 'POST',
      url: '/api/discovery/handoffs',
      payload: {
        goal: 'Propose a reusable review workflow',
        harness: 'opencode',
        candidates: [identity],
      },
    });
    expect(handoffResponse.statusCode).toBe(200);
    const handoff = handoffResponse.json();

    const stale = await app.inject({
      method: 'POST',
      url: '/api/discovery/workspaces',
      payload: {
        goal: handoff.goal,
        harness: handoff.harness,
        createdAt: handoff.createdAt,
        reviewFingerprint: '0'.repeat(64),
        candidates: [identity],
        contentsReviewed: true,
        redistributionReviewed: true,
        autoImport: false,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'DISCOVERY_WORKSPACE_INVALID' } });

    const created = await app.inject({
      method: 'POST',
      url: '/api/discovery/workspaces',
      payload: {
        goal: handoff.goal,
        harness: handoff.harness,
        createdAt: handoff.createdAt,
        reviewFingerprint: handoff.fingerprint,
        candidates: [identity],
        contentsReviewed: true,
        redistributionReviewed: true,
        autoImport: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const { workspace, handoff: persistedHandoff } = created.json();
    expect(persistedHandoff.fingerprint).toBe(handoff.fingerprint);
    expect(workspace).toMatchObject({
      harness: 'opencode',
      handoffFingerprint: handoff.fingerprint,
      autoImport: true,
    });
    expect(await readFile(join(workspace.path, '.agents', 'skills', 'scenario-discovery', 'SKILL.md'), 'utf8'))
      .toContain('Project-independent discovery handoff');
    expect(JSON.parse(await readFile(join(workspace.path, 'skill-loom-discovery.loom-discovery.json'), 'utf8')))
      .toMatchObject({ fingerprint: handoff.fingerprint });
    expect((await stat(join(workspace.path, 'discovery-output'))).isDirectory()).toBe(true);

    const resultBundle = {
      format: 'skill-loom-chain',
      version: 1,
      chain: {
        name: 'Pinned review workflow',
        harness: 'opencode',
        sessionMode: 'shared',
        steps: [{
          id: 'review',
          skillName: 'handoff-skill',
          instruction: 'Review the requested change.',
        }],
        inputs: [],
      },
      skills: [{
        name: 'handoff-skill',
        directory: 'handoff-skill',
        files: [
          { path: 'SKILL.md', content: Buffer.from(skillContent).toString('base64'), executable: false },
          { path: 'scripts/check.sh', content: Buffer.from(scriptContent).toString('base64'), executable: true },
        ],
      }],
    };
    await writeFile(
      join(workspace.path, 'discovery-output', 'approved-result.loom.json'),
      JSON.stringify(resultBundle),
    );
    await unregisterRemoteSkillSource(store, 'test-source');
    const preview = await app.inject({
      method: 'GET',
      url: `/api/discovery/workspaces/${workspace.id}/result`,
    });
    expect(preview.statusCode).toBe(200);
    const resultFingerprint = preview.json().fingerprint as string;
    expect(preview.json().bundle.chain.name).toBe('Pinned review workflow');

    const review = await app.inject({
      method: 'POST',
      url: `/api/discovery/workspaces/${workspace.id}/result-review`,
      payload: {
        fingerprint: resultFingerprint,
        contentsReviewed: true,
        redistributionReviewed: true,
      },
    });
    expect(review.statusCode).toBe(200);
    await expect(app.inject({
      method: 'POST',
      url: `/api/discovery/workspaces/${workspace.id}/import`,
      payload: {},
    })).resolves.toMatchObject({ statusCode: 409 });
  });
});
