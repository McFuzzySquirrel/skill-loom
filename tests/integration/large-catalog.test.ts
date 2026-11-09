import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConfigStore } from '../../src/server/config/store.js';
import { listRemoteSkillSnapshots, listRemoteSnapshotPage, refreshRemoteSkillSource } from '../../src/server/catalog/remote.js';
import { prepareDiscoveryHandoff } from '../../src/server/catalog/discovery-handoff.js';

const roots: string[] = [];

async function stagingSize(root: string): Promise<{ bytes: number; entries: number }> {
  const pending = [root];
  let bytes = 0;
  let entries = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const child of children) {
      const path = join(directory, child.name);
      entries += 1;
      if (child.isDirectory()) {
        pending.push(path);
      } else if (child.isFile()) {
        try {
          bytes += (await lstat(path)).size;
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
      }
    }
  }
  return { bytes, entries };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('large remote catalog', () => {
  it('refreshes 1,000 pinned skills with 20,000 package files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-large-catalog-'));
    roots.push(root);
    const repository = join(root, 'source.git');
    execFileSync('git', ['init', '--bare', '--quiet', repository]);
    const git = (args: string[], input?: string): string => execFileSync(
      'git',
      [`--git-dir=${repository}`, ...args],
      { input, encoding: 'utf8' },
    ).trim();
    const shared = git(['hash-object', '-w', '--stdin'], 'Shared package file.\n');
    const rootsOfPackages: string[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      const name = `skill-${String(index).padStart(4, '0')}`;
      const skill = git(['hash-object', '-w', '--stdin'], `---\nname: ${name}\ndescription: Fixture skill.\n---\nReview.\n`);
      const files = [
        `100644 blob ${skill}\tSKILL.md`,
        ...Array.from({ length: 19 }, (_, file) =>
          `100644 blob ${shared}\tfile-${String(file).padStart(2, '0')}.txt`),
      ];
      const tree = git(['mktree'], `${files.join('\n')}\n`);
      rootsOfPackages.push(`040000 tree ${tree}\t${name}`);
    }
    const tree = git(['mktree'], `${rootsOfPackages.join('\n')}\n`);
    const commit = git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', tree], 'Fixture\n');
    git(['update-ref', 'refs/heads/main', commit]);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main']);

    const config = join(root, 'gitconfig');
    const remote = 'https://example.invalid/catalog.git';
    execFileSync('git', ['config', '--file', config, `url.file://${repository}.insteadOf`, remote]);
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    const previousSystem = process.env.GIT_CONFIG_NOSYSTEM;
    process.env.GIT_CONFIG_GLOBAL = config;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    try {
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
      await store.update({
        remoteSkillSources: [{ id: 'large', repository: remote }],
        remoteCatalogLimits: {
          maxPackages: 1_000,
          maxFiles: 20_000,
          maxCommandOutputBytes: 8 * 1024 * 1024,
          maxStagingEntries: 30_000,
          maxStagingBytes: 128 * 1024 * 1024,
          maxSnapshotBytes: 128 * 1024 * 1024,
        },
      });
      const stagingRoot = join(root, 'staging');
      await mkdir(stagingRoot);
      let peakRss = process.memoryUsage.rss();
      let peakStagingBytes = 0;
      let peakStagingEntries = 0;
      let monitoring = true;
      const monitor = (async () => {
        while (monitoring) {
          peakRss = Math.max(peakRss, process.memoryUsage.rss(), process.resourceUsage().maxRSS * 1024);
          const staging = await stagingSize(stagingRoot);
          peakStagingBytes = Math.max(peakStagingBytes, staging.bytes);
          peakStagingEntries = Math.max(peakStagingEntries, staging.entries);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })();
      let snapshot;
      try {
        snapshot = await refreshRemoteSkillSource(store, 'large', { temporaryDirectory: stagingRoot });
      } finally {
        monitoring = false;
        await monitor;
      }
      peakRss = Math.max(peakRss, process.memoryUsage.rss());
      expect(peakRss).toBeLessThan(768 * 1024 * 1024);
      expect(peakStagingBytes).toBeGreaterThan(0);
      expect(peakStagingBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
      expect(peakStagingEntries).toBeGreaterThan(0);
      expect(peakStagingEntries).toBeLessThanOrEqual(30_001);
      console.info('Large catalog sampled resources:', { peakRss, peakStagingBytes, peakStagingEntries });
      expect(snapshot.revision).toBe(commit);
      expect(snapshot.packages).toHaveLength(1_000);
      expect(snapshot.packages.reduce((sum, entry) => sum + entry.files, 0)).toBe(20_000);
      expect(snapshot.packages[0]?.name).toBe('skill-0000');
      expect(snapshot.packages.at(-1)?.name).toBe('skill-0999');
      const pagedNames: string[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = await listRemoteSnapshotPage(store.getConfigDir(), 'large', commit, {
          kind: 'skill', offset, limit: 100,
        });
        expect(page.total).toBe(1_000);
        pagedNames.push(...page.items.map((item) => item.name));
        offset = page.nextOffset;
      }
      expect(pagedNames).toEqual(snapshot.packages.map((item) => item.name));
      const filtered = await listRemoteSnapshotPage(store.getConfigDir(), 'large', commit, {
        kind: 'skill', search: 'SKILL-099', limit: 100,
      });
      expect(filtered.items).toHaveLength(10);
      const selected = [snapshot.packages[0]!, snapshot.packages[999]!];
      const handoff = await prepareDiscoveryHandoff(store, {
        goal: 'Review selected packages from a large catalog', harness: 'opencode',
        candidates: selected.map((item) => ({
          sourceId: 'large', revision: commit, repositoryPath: item.repositoryPath, fingerprint: item.fingerprint,
        })),
      });
      expect(handoff.candidates.map((item) => item.name)).toEqual(['skill-0000', 'skill-0999']);
      expect(handoff.candidates.map((item) => item.files.length)).toEqual([20, 20]);
      await store.update({ remoteCatalogLimits: { maxPackages: 100, maxFiles: 2_000 } });
      expect((await listRemoteSkillSnapshots(store.getConfigDir(), 'large'))[0]?.packages).toHaveLength(1_000);
      await store.update({ remoteCatalogLimits: { maxStagingBytes: 1 } });
      await expect(refreshRemoteSkillSource(store, 'large')).rejects.toMatchObject({
        code: 'REMOTE_SOURCE_TOO_LARGE',
        details: { dimension: 'maxStagingBytes', limit: 1 },
      });
      expect((await listRemoteSkillSnapshots(store.getConfigDir(), 'large'))[0]?.packages).toHaveLength(1_000);
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
      if (previousSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = previousSystem;
    }
  }, 180_000);
});
