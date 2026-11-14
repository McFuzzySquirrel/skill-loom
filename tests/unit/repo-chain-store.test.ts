import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chainRevision } from '../../src/server/chains/service.js';
import { createRepoChainRepository, type RepoChainPublication } from '../../src/server/repo-chains/store.js';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function newRepository() {
  root = await mkdtemp(join(tmpdir(), 'loom-repo-chain-'));
  let nextId = 0;
  return createRepoChainRepository(root, {
    chainServiceOptions: {
      now: () => new Date('2026-02-01T00:00:00.000Z'),
      generateId: () => `repo-chain-${String(++nextId)}`,
    },
  });
}

function draft(name: string) {
  return {
    name,
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Review the changes.' }],
    inputs: [],
  };
}

function publication(repoChainId: string, hostedChainId = 'hosted-chain'): RepoChainPublication {
  return {
    version: 1,
    repoChainId,
    hostedChainId,
    hostedRevision: 'a'.repeat(64),
  };
}

describe('repository chain store', () => {
  it('rejects duplicate names and generated ids without replacing the existing file', async () => {
    root = await mkdtemp(join(tmpdir(), 'loom-repo-chain-conflict-'));
    const repository = await createRepoChainRepository(root, {
      chainServiceOptions: {
        generateId: () => 'fixed-chain-id',
      },
    });
    const first = await repository.service.create(repository.root, draft('First'), { uniqueName: true });
    const path = join(repository.chainsDirectory, `${first.id}.json`);
    const original = await readFile(path, 'utf8');

    await expect(repository.service.create(repository.root, draft('First'), { uniqueName: true }))
      .rejects.toMatchObject({ code: 'CHAIN_NAME_EXISTS' });
    await expect(repository.service.create(repository.root, draft('Second'), { uniqueName: true }))
      .rejects.toMatchObject({ code: 'CHAIN_ALREADY_EXISTS' });
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('creates, reads, updates, copies, and maps chains in tracked chains/ files', async () => {
    const repository = await newRepository();
    const created = await repository.service.create(repository.root, draft('Review'), { uniqueName: true });
    const path = join(repository.chainsDirectory, `${created.id}.json`);
    const revision = chainRevision(created);

    expect(await repository.service.get(repository.root, created.id)).toEqual(created);
    expect(await repository.readPublication(created.id)).toBeNull();
    expect(path).toBe(join(root!, 'chains', `${created.id}.json`));
    expect(await readFile(path, 'utf8')).toContain('"version": 3');
    expect(await repository.service.update(
      repository.root,
      created.id,
      draft('Review updated'),
      { expectedRevision: revision, uniqueName: true },
    )).toMatchObject({ id: created.id, name: 'Review updated' });
    await expect(repository.service.update(
      repository.root,
      created.id,
      draft('Stale edit'),
      { expectedRevision: revision, uniqueName: true },
    )).rejects.toMatchObject({ code: 'CHAIN_STALE', details: { expectedRevision: revision } });

    const mapping = publication(created.id);
    await repository.writePublication(created.id, mapping);
    expect(await repository.readPublication(created.id)).toEqual(mapping);

    const copy = await repository.service.duplicate(repository.root, created.id, { uniqueName: true });
    expect(copy.id).not.toBe(created.id);
    expect(await repository.readPublication(copy.id)).toBeNull();
    const listing = await repository.list();
    expect(listing.chains).toHaveLength(2);
    expect(listing.warnings).toEqual([]);
    expect(listing.publications[created.id]).toEqual(mapping);
    expect(listing.publications[copy.id]).toBeNull();
  });

  it('migrates supported versions on read without rewriting and rejects invalid or future files', async () => {
    const repository = await newRepository();
    const chains = repository.chainsDirectory;
    await mkdir(chains);
    const legacy = {
      version: 2,
      id: 'legacy-chain',
      name: 'Legacy',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Review.' }],
      inputs: [],
      automaticPermissionOptIn: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const legacyPath = join(chains, 'legacy-chain.json');
    const legacyBytes = `${JSON.stringify(legacy, null, 2)}\n`;
    await writeFile(legacyPath, legacyBytes);
    await writeFile(join(chains, 'future-chain.json'), JSON.stringify({ ...legacy, id: 'future-chain', version: 99 }));
    await writeFile(join(chains, 'invalid-chain.json'), JSON.stringify({ ...legacy, id: 'invalid-chain', steps: [] }));

    await expect(repository.service.get(repository.root, 'legacy-chain'))
      .resolves.toMatchObject({ version: 3, id: 'legacy-chain' });
    expect(await readFile(legacyPath, 'utf8')).toBe(legacyBytes);
    await expect(repository.service.get(repository.root, 'future-chain'))
      .rejects.toMatchObject({ code: 'CHAIN_UNSUPPORTED_VERSION' });
    const listing = await repository.list();
    expect(listing.chains.map((chain) => chain.id)).toEqual(['legacy-chain']);
    expect(listing.warnings.map((warning) => warning.code).sort())
      .toEqual(['CHAIN_FILE_CORRUPT', 'CHAIN_UNSUPPORTED_VERSION']);
  });

  it('preserves corrupt and unsupported sidecars, and does not overwrite on failed writes', async () => {
    const repository = await newRepository();
    const chain = await repository.service.create(repository.root, draft('Publication'));
    const target = join(repository.chainsDirectory, `${chain.id}.publish.json`);
    const original = publication(chain.id);
    await repository.writePublication(chain.id, original);

    const failing = await createRepoChainRepository(repository.root, {
      publicationWriter: async () => { throw new Error('injected write failure'); },
    });
    await expect(failing.writePublication(chain.id, publication(chain.id, 'different-hosted')))
      .rejects.toMatchObject({ code: 'REPO_PUBLICATION_WRITE_FAILED' });
    expect(await repository.readPublication(chain.id)).toEqual(original);

    const unsupported = JSON.stringify({ ...original, version: 2 });
    await writeFile(target, unsupported);
    await expect(repository.readPublication(chain.id)).rejects.toMatchObject({
      code: 'REPO_PUBLICATION_UNSUPPORTED_VERSION',
    });
    expect(await readFile(target, 'utf8')).toBe(unsupported);

    const corrupt = '{not json';
    await writeFile(target, corrupt);
    await expect(repository.readPublication(chain.id)).rejects.toMatchObject({
      code: 'REPO_PUBLICATION_CORRUPT',
    });
    expect(await readFile(target, 'utf8')).toBe(corrupt);
    expect(await repository.list()).toMatchObject({
      warnings: [expect.objectContaining({ code: 'REPO_PUBLICATION_CORRUPT', chainId: chain.id })],
    });
  });
});
