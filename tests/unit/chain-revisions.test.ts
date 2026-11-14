import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chainRevision, createChainService } from '../../src/server/chains/service.js';
import { createChainStore } from '../../src/server/chains/store.js';

describe('chain revision concurrency', () => {
  it('serializes competing services and changes revisions even within the same clock tick', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-chain-revision-'));
    try {
      const options = { now: () => new Date('2026-01-01T00:00:00.000Z') };
      const first = createChainService(options);
      const second = createChainService(options);
      const draft = {
        name: 'Concurrent', harness: 'copilot', sessionMode: 'shared',
        steps: [{ id: 'step', kind: 'instruction', instruction: 'Review.' }], inputs: [],
      };
      const created = await first.create(root, draft);
      const revision = chainRevision(created);
      const outcomes = await Promise.allSettled([
        first.update(root, created.id, draft, { expectedRevision: revision }),
        second.update(root, created.id, { ...draft, name: 'Changed' }, { expectedRevision: revision }),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'CHAIN_STALE' } });
      const updated = await first.get(root, created.id);
      expect(chainRevision(updated)).not.toBe(revision);
      await expect(second.remove(root, created.id, { expectedRevision: revision }))
        .rejects.toMatchObject({ code: 'CHAIN_STALE' });
      await first.remove(root, created.id, { expectedRevision: chainRevision(updated) });
      await expect(first.get(root, created.id)).rejects.toMatchObject({ code: 'CHAIN_NOT_FOUND' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes updates from different project contexts that share one store', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-shared-chain-revision-')));
    try {
      const projectA = join(root, 'project-a');
      const projectB = join(root, 'project-b');
      const backing = createChainStore({ chainsDirectory: join(root, 'shared-chains') });
      const createStore = () => ({
        async list() {
          return backing.list();
        },
        async read(chainId: string) {
          const observed = await backing.read(chainId);
          await new Promise((resolve) => setTimeout(resolve, 20));
          return observed;
        },
        async create(chain: Parameters<typeof backing.create>[0]) {
          return backing.create(chain);
        },
        async update(chain: Parameters<typeof backing.update>[0]) {
          return backing.update(chain);
        },
        async delete(chainId: string) {
          return backing.delete(chainId);
        },
      });
      const service = createChainService({
        createStore,
        mutationScope: () => join(root, 'shared-chains'),
      });
      const draft = {
        name: 'Concurrent shared chain',
        harness: 'copilot',
        sessionMode: 'shared',
        steps: [{ id: 'step', kind: 'instruction', instruction: 'Review.' }],
        inputs: [],
      };
      const created = await service.create(projectA, draft);
      const revision = chainRevision(created);

      const outcomes = await Promise.allSettled([
        service.update(projectA, created.id, draft, { expectedRevision: revision }),
        service.update(projectB, created.id, { ...draft, name: 'Changed elsewhere' }, { expectedRevision: revision }),
      ]);

      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === 'rejected')).toMatchObject([
        { reason: { code: 'CHAIN_STALE' } },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
