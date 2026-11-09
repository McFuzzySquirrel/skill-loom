import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createConfigStore } from '../../src/server/config/store.js';
import {
  REMOTE_SOURCE_ERROR_CODES,
  RemoteSourceError,
  inspectRemoteSnapshotCandidate,
  listRemoteSkillSnapshots,
  listRemoteSnapshotPage,
  resolveSnapshotAgentPath,
  resolveSnapshotPackagePath,
  refreshRemoteSkillSource,
  unregisterRemoteSkillSource,
  type RemoteSkillSnapshot,
  type RemoteSourceGitRunner,
} from '../../src/server/catalog/remote.js';
import { writeSnapshotIndex } from '../../src/server/catalog/snapshot-index.js';
import { snapshotPackageFingerprint, snapshotReviewFingerprint } from '../../src/server/catalog/snapshot-fingerprint.js';

const roots: string[] = [];
const revision = 'a'.repeat(40);
const skillBlob = 'b'.repeat(40);
const readmeBlob = 'c'.repeat(40);
const openCodeAgentBlob = 'd'.repeat(40);
const copilotAgentBlob = 'e'.repeat(40);

async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-remote-test-')));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fakeGit(tree = [
  `100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`,
  `100755 blob ${readmeBlob}\tcollection/demo/scripts/check.sh\0`,
  `100644 blob ${openCodeAgentBlob}\t.opencode/agents/reviewer.md\0`,
  `100644 blob ${copilotAgentBlob}\t.github/agents/tester.agent.md\0`,
].join('')): {
  run: RemoteSourceGitRunner;
  commands: string[][];
  outputLimits: number[];
} {
  const commands: string[][] = [];
  const outputLimits: number[] = [];
  const content = new Map([
    [skillBlob, '---\nname: demo-skill\ndescription: A remote demo.\n---\nInstructions.\n'],
    [readmeBlob, '# Check\n'],
    [openCodeAgentBlob, '---\nmode: primary\ndescription: Reviews changes.\n---\nReview carefully.\n'],
    [copilotAgentBlob, '---\nname: test-runner\ndescription: Runs focused tests.\n---\nRun tests.\n'],
  ]);
  return {
    commands,
    outputLimits,
    async run(args, _cwd, _timeoutMs, maxOutputBytes) {
      commands.push(args);
      if (maxOutputBytes !== undefined) outputLimits.push(maxOutputBytes);
      if (args[0] === 'clone' || args.includes('fetch')) return { stdout: '' };
      if (args.includes('rev-parse')) return { stdout: `${revision}\n` };
      if (args.includes('ls-tree')) return { stdout: tree };
      if (args.includes('cat-file')) {
        const blob = content.get(args.at(-1) ?? '');
        if (blob === undefined) throw new Error('Unexpected blob request.');
        return { stdout: blob };
      }
      throw new Error(`Unexpected git command: ${args.join(' ')}`);
    },
  };
}

describe('remote skill source snapshots', () => {
  it('binds versioned Git executable modes to snapshot fingerprints and migrates legacy snapshots', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git', ref: 'main' }],
    });
    const refresh = () => refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: fakeGit().run, temporaryDirectory: root,
    });
    const snapshot = await refresh();
    const entry = snapshot.packages[0]!;
    const snapshotRoot = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision);
    const modePath = join(snapshotRoot, 'modes', `${entry.directory}.json`);
    const expected = { version: 1, executablePaths: ['scripts/check.sh'] };
    expect(JSON.parse(await readFile(modePath, 'utf8'))).toEqual(expected);
    await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry)).resolves.toBeTruthy();

    for (const invalid of [
      { version: 1, executablePaths: [] },
      { version: 1, executablePaths: ['missing.sh', 'scripts/check.sh'] },
      { version: 1, executablePaths: ['scripts/check.sh', 'scripts/check.sh'] },
      { version: 1, executablePaths: ['../outside'] },
      { version: 2, executablePaths: ['scripts/check.sh'] },
    ]) {
      await writeFile(modePath, JSON.stringify(invalid));
      await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry))
        .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
      await expect(refresh()).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
    }

    await unlink(modePath);
    if (process.platform === 'win32') {
      await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry))
        .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
    } else {
      await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry)).resolves.toBeTruthy();
    }
    const historical = fakeGit();
    expect(await refreshRemoteSkillSource(store, 'demo-source', {
      revision, gitRunner: historical.run, temporaryDirectory: root,
    })).toEqual(snapshot);
    expect(historical.commands.some((args) => args.includes('fetch') && args.includes(revision))).toBe(true);
    expect(historical.commands.find((args) => args[0] === 'clone')).not.toContain('--branch=main');
    expect((await store.get()).remoteSkillSources[0]?.ref).toBe('main');
    expect(JSON.parse(await readFile(modePath, 'utf8'))).toEqual(expected);
    await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry)).resolves.toBeTruthy();
  });

  it('requires a framed review index and restores it only after a matching refresh', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const refresh = () => refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: fakeGit().run, temporaryDirectory: root,
    });
    const snapshot = await refresh();
    const entry = snapshot.packages[0]!;
    const path = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision, 'modes', `${entry.directory}.review.json`);
    const index = await readFile(path, 'utf8');
    for (const invalid of ['{"version":1,"fingerprint":"bad"}', '{"version":2,"fingerprint":"' + '0'.repeat(64) + '"}']) {
      await writeFile(path, invalid);
      await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry))
        .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
      await expect(refresh()).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
    }
    await writeFile(path, index);
    await unlink(path);
    const modePath = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision, 'modes', `${entry.directory}.json`);
    const modes = await readFile(modePath, 'utf8');
    await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry))
      .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'REVIEW_INDEX_MISSING' } });
    await unlink(modePath);
    expect(await refreshRemoteSkillSource(store, 'demo-source', {
      revision, gitRunner: fakeGit().run, temporaryDirectory: root,
    })).toEqual(snapshot);
    expect(await readFile(path, 'utf8')).toBe(index);
    expect(await readFile(modePath, 'utf8')).toBe(modes);
    await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry)).resolves.toBeTruthy();
  });

  it.skipIf(process.platform !== 'win32')('requires Git mode metadata on Windows even for non-executable files', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const tree = `100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`;
    const refresh = () => refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: fakeGit(tree).run, temporaryDirectory: root,
    });
    const snapshot = await refresh();
    const entry = snapshot.packages[0]!;
    const modes = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision, 'modes', `${entry.directory}.json`);
    await unlink(modes);
    await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry))
      .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'MODE_INDEX_MISSING' } });
    await refresh();
    await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry)).resolves.toBeTruthy();
  });

  it('rejects equal-length package substitutions that collide under the legacy fingerprint', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const skill = Buffer.from('---\nname: demo-skill\ndescription: A remote demo.\n---\n');
    const original = [
      { path: 'SKILL.md', executable: false, content: skill },
      { path: 'b', executable: false, content: Buffer.from('prefixc\0-\0suffix') },
    ];
    const altered = [
      { path: 'SKILL.md', executable: false, content: Buffer.concat([skill, Buffer.from('b\0-\0prefix')]) },
      { path: 'c', executable: false, content: Buffer.from('suffix') },
    ];
    expect(snapshotPackageFingerprint(original)).toBe(snapshotPackageFingerprint(altered));
    expect(snapshotReviewFingerprint(original)).not.toBe(snapshotReviewFingerprint(altered));
    const tree = [
      `100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`,
      `100644 blob ${readmeBlob}\tcollection/demo/b\0`,
    ].join('');
    const gitRunner: RemoteSourceGitRunner = async (args) => {
      if (args[0] === 'clone' || args[1] === 'fetch') return { stdout: '' };
      if (args.includes('rev-parse')) return { stdout: `${revision}\n` };
      if (args.includes('ls-tree')) return { stdout: tree };
      if (args.includes('cat-file')) return { stdout: args.at(-1) === skillBlob ? original[0]!.content : original[1]!.content };
      throw new Error('Unexpected Git request.');
    };
    const refresh = () => refreshRemoteSkillSource(store, 'demo-source', { gitRunner, temporaryDirectory: root });
    const snapshot = await refresh();
    const entry = snapshot.packages[0]!;
    const snapshotRoot = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision);
    const packagePath = join(snapshotRoot, 'packages', entry.directory);
    await writeFile(join(packagePath, 'SKILL.md'), altered[0]!.content);
    await unlink(join(packagePath, 'b'));
    await writeFile(join(packagePath, 'c'), altered[1]!.content);
    await expect(resolveSnapshotPackagePath(store.getConfigDir(), snapshot, entry))
      .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
    await expect(refresh()).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
    await unlink(join(snapshotRoot, 'modes', `${entry.directory}.review.json`));
    await expect(refresh()).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
  });

  it('only refreshes saved commits and rejects a different resolved commit', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git', ref: 'main' }],
    });
    await refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit().run, temporaryDirectory: root });
    for (const invalid of ['../invalid', 'f'.repeat(40)]) {
      const unknown = fakeGit();
      await expect(refreshRemoteSkillSource(store, 'demo-source', {
        revision: invalid, gitRunner: unknown.run, temporaryDirectory: root,
      })).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.NOT_FOUND });
      expect(unknown.commands).toEqual([]);
    }
    const base = fakeGit();
    const mismatch: RemoteSourceGitRunner = async (args, cwd, timeout, maxOutput) =>
      args.includes('rev-parse') ? { stdout: `${'f'.repeat(40)}\n` } :
        base.run(args, cwd, timeout, maxOutput);
    await expect(refreshRemoteSkillSource(store, 'demo-source', {
      revision, gitRunner: mismatch, temporaryDirectory: root,
    })).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED });
    const resolutions: string[][] = [];
    const failing: RemoteSourceGitRunner = async (args, cwd, timeout, maxOutput) => {
      if (args.includes('rev-parse')) {
        resolutions.push(args);
        throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED, 'missing commit');
      }
      return base.run(args, cwd, timeout, maxOutput);
    };
    await expect(refreshRemoteSkillSource(store, 'demo-source', {
      revision, gitRunner: failing, temporaryDirectory: root,
    })).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED });
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toContain('FETCH_HEAD^{commit}');
  });

  it('reuses an existing snapshot only after verifying its manifest, content, and index', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const tree = [
      `100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`,
      `100644 blob ${openCodeAgentBlob}\t.opencode/agents/reviewer.md\0`,
    ].join('');
    const refresh = () => refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: fakeGit(tree).run, temporaryDirectory: root,
    });
    const initial = await refresh();
    expect(await refresh()).toEqual(initial);

    const snapshotRoot = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision);
    const skillPath = join(snapshotRoot, 'packages', initial.packages[0]!.directory, 'SKILL.md');
    const skill = await readFile(skillPath);
    await writeFile(skillPath, 'tampered skill');
    await expect(refresh()).rejects.toMatchObject({
      code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'CONTENT_MISMATCH' },
    });
    expect(await readFile(skillPath, 'utf8')).toBe('tampered skill');
    await writeFile(skillPath, skill);

    const agentPath = join(snapshotRoot, 'agents', initial.agents[0]!.directory, 'agent.md');
    const agent = await readFile(agentPath);
    await writeFile(agentPath, Buffer.alloc(agent.length, 0x61));
    await expect(refresh()).rejects.toMatchObject({
      code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'CONTENT_MISMATCH' },
    });
    await writeFile(agentPath, agent);

    const manifestPath = join(snapshotRoot, 'snapshot.json');
    const manifest = await readFile(manifestPath);
    await writeFile(manifestPath, JSON.stringify({
      ...initial, packages: [{ ...initial.packages[0]!, description: 'tampered metadata' }],
    }));
    await expect(refresh()).rejects.toMatchObject({
      code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'IMMUTABLE_MISMATCH' },
    });
    await writeFile(manifestPath, manifest);
    await unlink(join(snapshotRoot, 'snapshot-index.sqlite'));
    await writeSnapshotIndex(snapshotRoot, initial);

    const indexPath = join(snapshotRoot, 'snapshot-index.sqlite');
    const database = new DatabaseSync(indexPath);
    try {
      database.prepare('UPDATE entries SET item = ? WHERE kind = ?')
        .run(JSON.stringify({ ...initial.packages[0]!, description: 'tampered index' }), 'skill');
    } finally {
      database.close();
    }
    await expect(refresh()).rejects.toMatchObject({
      code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'INDEX_INVALID' },
    });
    const alteredIndex = new DatabaseSync(indexPath);
    try {
      alteredIndex.prepare('UPDATE entries SET item = ?, search = ? WHERE kind = ?')
        .run(JSON.stringify(initial.packages[0]), 'incorrect search', 'skill');
    } finally {
      alteredIndex.close();
    }
    await expect(refresh()).rejects.toMatchObject({
      code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'INDEX_INVALID' },
    });
    expect(await readFile(manifestPath)).toEqual(manifest);
    expect(await readdir(join(store.getConfigDir(), 'catalog-sources', 'demo-source'))).toEqual([revision]);
  });

  it('uses a canonical snapshot root when a config ancestor is an alias', async () => {
    const root = await makeRoot();
    const alias = join(root, 'alias');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(alias, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'alias-source', repository: 'https://example.com/skills.git' }],
    });

    await refreshRemoteSkillSource(store, 'alias-source', { gitRunner: fakeGit().run, temporaryDirectory: root });
    const snapshots = await listRemoteSkillSnapshots(store.getConfigDir(), 'alias-source');
    expect(snapshots).toHaveLength(1);
    const page = await listRemoteSnapshotPage(store.getConfigDir(), 'alias-source', revision, {
      kind: 'skill', search: '', offset: 0, limit: 50,
    });
    expect(page.items).toHaveLength(1);
    const inspected = await inspectRemoteSnapshotCandidate(store.getConfigDir(), 'alias-source', revision, {
      kind: 'skill', repositoryPath: 'collection/demo',
    });
    expect(inspected.path).toBe(await realpath(inspected.path));
  });

  it('rejects a symlink as the configured snapshot directory', async () => {
    const root = await makeRoot();
    const target = join(root, 'target');
    const config = join(root, 'config');
    await mkdir(target);
    await symlink(target, config, process.platform === 'win32' ? 'junction' : 'dir');
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: config } });
    await store.update({
      remoteSkillSources: [{ id: 'link-source', repository: 'https://example.com/skills.git' }],
    });
    await expect(refreshRemoteSkillSource(store, 'link-source', {
      gitRunner: fakeGit().run, temporaryDirectory: root,
    })).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.NOT_FOUND });
    expect(await readdir(target)).toEqual(['config.json']);
  });

  it('serializes refresh and unregister for the same source', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'queued', repository: 'https://example.com/skills.git' }],
    });
    const base = fakeGit();
    let started: () => void = () => undefined;
    let release: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run: RemoteSourceGitRunner = async (...args) => {
      if (args[0][0] === 'clone') {
        started();
        await gate;
      }
      return base.run(...args);
    };
    const refresh = refreshRemoteSkillSource(store, 'queued', { gitRunner: run, temporaryDirectory: root });
    await entered;
    let removed = false;
    const removal = unregisterRemoteSkillSource(store, 'queued').then(() => { removed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(removed).toBe(false);
    release();
    await refresh;
    await removal;
    expect((await store.get()).remoteSkillSources).toEqual([]);
    expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'queued')).toHaveLength(1);
  });

  it('applies per-source limits and keeps larger snapshots readable after limits are lowered', async () => {
    const root = await makeRoot();
    const store = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => root,
    });
    await store.update({
      remoteSkillSources: [{
        id: 'large-source',
        repository: 'https://example.com/acme/skills.git',
        limits: { maxPackages: 101 },
      }],
    });
    const tree = Array.from({ length: 101 }, (_, index) =>
      `100644 blob ${skillBlob}\tpackage-${String(index)}/SKILL.md\0`,
    ).join('');
    const snapshot = await refreshRemoteSkillSource(store, 'large-source', { gitRunner: fakeGit(tree).run });
    expect(snapshot.packages).toHaveLength(101);
    await store.update({
      remoteSkillSources: [{ id: 'large-source', repository: 'https://example.com/acme/skills.git' }],
    });
    expect((await listRemoteSkillSnapshots(store.getConfigDir(), 'large-source'))[0]?.packages).toHaveLength(101);
    await expect(refreshRemoteSkillSource(store, 'large-source', { gitRunner: fakeGit(tree).run }))
      .rejects.toMatchObject({
        code: REMOTE_SOURCE_ERROR_CODES.TOO_LARGE,
        details: { dimension: 'maxPackages', limit: 100 },
      });
    expect((await listRemoteSkillSnapshots(store.getConfigDir(), 'large-source'))[0]?.packages).toHaveLength(101);
  });

  it('enforces a distinct aggregate snapshot budget without deleting the prior snapshot', async () => {
    const root = await makeRoot();
    const store = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => root,
    });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const initial = await refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit().run });
    await store.update({ remoteCatalogLimits: { maxSnapshotBytes: 1 } });
    await expect(refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit().run }))
      .rejects.toMatchObject({
        code: REMOTE_SOURCE_ERROR_CODES.TOO_LARGE,
        details: { dimension: 'maxSnapshotBytes', limit: 1 },
      });
    expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'demo-source')).toEqual([initial]);
  });

  it('uses stable indexed pages and preserves the legacy manifest fallback', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const tree = Array.from({ length: 5 }, (_, index) =>
      `100644 blob ${skillBlob}\tpackage-${String(index)}/SKILL.md\0`,
    ).join('');
    await refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run });
    const requests = [
      { kind: 'skill', offset: 0, limit: 2 },
      { kind: 'skill', search: 'PACKAGE-3', limit: 2 },
      { kind: 'skill', offset: 9, limit: 2 },
      { kind: 'agent', search: 'missing' },
    ];
    const indexed = await Promise.all(requests.map((request) =>
      listRemoteSnapshotPage(store.getConfigDir(), 'demo-source', revision, request)));
    const indexPath = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision, 'snapshot-index.sqlite');
    const database = new DatabaseSync(indexPath);
    try {
      database.prepare('DELETE FROM entries WHERE kind = ? AND position = (SELECT min(position) FROM entries WHERE kind = ?)')
        .run('skill', 'skill');
    } finally {
      database.close();
    }
    await expect(listRemoteSnapshotPage(store.getConfigDir(), 'demo-source', revision, requests[0]))
      .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'INDEX_INVALID' } });
    await unlink(indexPath);
    const legacy = await Promise.all(requests.map((request) =>
      listRemoteSnapshotPage(store.getConfigDir(), 'demo-source', revision, request)));
    expect(indexed).toEqual(legacy);
  });

  it('reports a stale index and safely reads the changed manifest', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    await refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit().run });
    const manifest = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision, 'snapshot.json');
    await writeFile(manifest, `${await readFile(manifest, 'utf8')} `);
    await expect(listRemoteSnapshotPage(store.getConfigDir(), 'demo-source', revision, { kind: 'skill' }))
      .resolves.toMatchObject({
        items: [{ name: 'demo-skill' }],
        warning: { code: 'REMOTE_SOURCE_INDEX_STALE' },
      });
  });

  it('uses the manifest when exact JavaScript substring matching needs unpaired surrogates', async () => {
    const root = await makeRoot();
    const snapshotRoot = join(root, 'catalog-sources', 'demo-source', revision);
    await mkdir(snapshotRoot, { recursive: true });
    const snapshot: RemoteSkillSnapshot = {
      version: 1, sourceId: 'demo-source', repository: 'https://example.com/acme/skills.git', revision,
      packages: [{
        name: `unpaired-\ud800`, description: 'fixture', repositoryPath: 'package',
        directory: 'b'.repeat(64), files: 1, bytes: 1, fingerprint: 'c'.repeat(64),
      }],
      agents: [],
    };
    await writeFile(join(snapshotRoot, 'snapshot.json'), JSON.stringify(snapshot));
    await writeSnapshotIndex(snapshotRoot, snapshot);
    await expect(listRemoteSnapshotPage(root, 'demo-source', revision, { kind: 'skill', search: '\ud800' }))
      .resolves.toMatchObject({ total: 1, items: [{ name: 'unpaired-\ud800' }] });
    await expect(listRemoteSnapshotPage(root, 'demo-source', revision, { kind: 'skill', search: '\ufffd' }))
      .resolves.toMatchObject({ total: 0, items: [] });
  });

  it('enforces package file and byte budgets at their exact boundaries', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const tree = [
      `100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`,
      `100755 blob ${readmeBlob}\tcollection/demo/scripts/check.sh\0`,
    ].join('');
    const packageBytes = Buffer.byteLength('---\nname: demo-skill\ndescription: A remote demo.\n---\nInstructions.\n# Check\n');
    for (const [dimension, threshold] of [
      ['maxFiles', 2],
      ['maxPackageBytes', packageBytes],
      ['maxSnapshotBytes', packageBytes],
    ] as const) {
      for (const delta of [-1, 0, 1]) {
        const limit = threshold + delta;
        await store.update({ remoteCatalogLimits: { [dimension]: limit } });
        const refresh = refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run });
        if (delta < 0) {
          await expect(refresh).rejects.toMatchObject({
            code: REMOTE_SOURCE_ERROR_CODES.TOO_LARGE, details: { dimension, limit },
          });
        } else {
          await expect(refresh).resolves.toMatchObject({
            packages: [{ files: 2, bytes: packageBytes }],
          });
        }
      }
    }
  });

  it('counts native-agent files and bytes at their exact boundaries', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const tree = [
      `100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`,
      `100644 blob ${openCodeAgentBlob}\t.opencode/agents/reviewer.md\0`,
    ].join('');
    const skillBytes = Buffer.byteLength('---\nname: demo-skill\ndescription: A remote demo.\n---\nInstructions.\n');
    const agentBytes = Buffer.byteLength('---\nmode: primary\ndescription: Reviews changes.\n---\nReview carefully.\n');
    const manifest = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision, 'snapshot.json');
    await refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run });
    const original = await readFile(manifest);

    for (const [dimension, threshold] of [
      ['maxFiles', 2],
      ['maxPackageBytes', agentBytes],
      ['maxSnapshotBytes', skillBytes + agentBytes],
    ] as const) {
      for (const delta of [-1, 0, 1]) {
        const limit = threshold + delta;
        await store.update({
          remoteCatalogLimits: {
            maxFiles: dimension === 'maxFiles' ? limit : 100,
            maxPackageBytes: dimension === 'maxPackageBytes' ? limit : 1_000,
            maxSnapshotBytes: dimension === 'maxSnapshotBytes' ? limit : 2_000,
          },
        });
        const refresh = refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run });
        if (delta < 0) {
          await expect(refresh).rejects.toMatchObject({
            code: REMOTE_SOURCE_ERROR_CODES.TOO_LARGE, details: { dimension, limit },
          });
          expect(await readFile(manifest)).toEqual(original);
        } else {
          await expect(refresh).resolves.toMatchObject({
            packages: [{ bytes: skillBytes }],
            agents: [{ bytes: agentBytes }],
          });
        }
      }
    }
  });

  it('counts shared nested-package files for each containing package', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
      remoteCatalogLimits: { maxFiles: 5 },
    });
    const tree = [
      `100644 blob ${skillBlob}\tSKILL.md\0`,
      `100644 blob ${skillBlob}\tnested/SKILL.md\0`,
      `100644 blob ${readmeBlob}\tnested/scripts/check.sh\0`,
    ].join('');
    const snapshot = await refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run });
    expect(snapshot.packages).toMatchObject([
      { repositoryPath: '.', files: 3 },
      { repositoryPath: 'nested', files: 2 },
    ]);
    await store.update({ remoteCatalogLimits: { maxFiles: 4 } });
    await expect(refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run }))
      .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.TOO_LARGE, details: { dimension: 'maxFiles', limit: 4 } });
    expect((await listRemoteSkillSnapshots(store.getConfigDir(), 'demo-source'))[0]?.packages).toHaveLength(2);
  });

  it('indexes distinct path segments without collecting unrelated deep files', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const tree = [
      `100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`,
      `100644 blob ${readmeBlob}\tcollection/demo/file.txt\0`,
      `100644 blob ${skillBlob}\tcollection/demo-extra/SKILL.md\0`,
      `100644 blob ${readmeBlob}\tcollection/demo-extra/file.txt\0`,
      `100644 blob ${readmeBlob}\tunrelated/${'deep/'.repeat(20_000)}file.txt\0`,
    ].join('');
    const snapshot = await refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run });
    expect(snapshot.packages).toMatchObject([
      { repositoryPath: 'collection/demo', files: 2 },
      { repositoryPath: 'collection/demo-extra', files: 2 },
    ]);
  });

  it('rejects invalid UTF-8 tree paths without changing the prior snapshot', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const base = fakeGit();
    const original = await refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: base.run,
      temporaryDirectory: root,
    });
    const invalidTree = Buffer.concat([
      Buffer.from(`100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`),
      Buffer.from(`100644 blob ${readmeBlob}\tcollection/demo/invalid-`),
      Buffer.from([0xff]),
      Buffer.from('.txt\0'),
    ]);
    const runner: RemoteSourceGitRunner = async (...args) => {
      if (args[0].includes('ls-tree')) return { stdout: invalidTree };
      return base.run(...args);
    };
    await expect(refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: runner,
      temporaryDirectory: root,
    })).rejects.toMatchObject({
      code: REMOTE_SOURCE_ERROR_CODES.INVALID_PACKAGE,
      message: 'The remote tree contains a path that is not valid UTF-8.',
      details: { sourceId: 'demo-source' },
    });
    expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'demo-source')).toEqual([original]);
    expect((await readdir(root)).filter((name) => name.startsWith('skill-loom-source-'))).toEqual([]);
  });

  it('enforces package and agent count boundaries without replacing the prior snapshot', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const tree = [
      `100644 blob ${skillBlob}\tcollection/first/SKILL.md\0`,
      `100644 blob ${skillBlob}\tcollection/second/SKILL.md\0`,
      `100644 blob ${openCodeAgentBlob}\t.opencode/agents/reviewer.md\0`,
      `100644 blob ${copilotAgentBlob}\t.github/agents/tester.agent.md\0`,
    ].join('');
    const manifest = join(store.getConfigDir(), 'catalog-sources', 'demo-source', revision, 'snapshot.json');

    await refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run });
    const original = await readFile(manifest);
    for (const dimension of ['maxPackages', 'maxAgents'] as const) {
      for (const limit of [1, 2, 3]) {
        await store.update({ remoteCatalogLimits: { [dimension]: limit } });
        const refresh = refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(tree).run });
        if (limit === 1) {
          await expect(refresh).rejects.toMatchObject({
            code: REMOTE_SOURCE_ERROR_CODES.TOO_LARGE, details: { dimension, limit },
          });
          expect(await readFile(manifest)).toEqual(original);
        } else {
          await expect(refresh).resolves.toMatchObject({
            packages: [
              { name: 'demo-skill', repositoryPath: 'collection/first' },
              { name: 'demo-skill', repositoryPath: 'collection/second' },
            ],
            agents: [{}, {}],
          });
        }
      }
    }
  });

  it('rejects unsafe package tree entries without publishing a partial snapshot', async () => {
    const root = await makeRoot();
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } });
    await store.update({
      remoteSkillSources: [{ id: 'demo-source', repository: 'https://example.com/acme/skills.git' }],
    });
    const skill = `100644 blob ${skillBlob}\tcollection/demo/SKILL.md\0`;
    for (const unsafe of [
      `120000 blob ${readmeBlob}\tcollection/demo/link\0`,
      `100644 blob ${readmeBlob}\tcollection/demo/../outside\0`,
      `100644 blob ${readmeBlob}\tcollection/demo/.git/config\0`,
      `100644 blob ${readmeBlob}\tcollection/demo/CON.txt\0`,
      `160000 commit ${readmeBlob}\tcollection/demo/submodule\0`,
    ]) {
      await expect(refreshRemoteSkillSource(store, 'demo-source', { gitRunner: fakeGit(skill + unsafe).run }))
        .rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.INVALID_PACKAGE });
      expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'demo-source')).toEqual([]);
    }
  });

  it('pins packages to a commit, stores complete files, and removes the staging clone', async () => {
    const root = await makeRoot();
    const staging = join(root, 'staging');
    await mkdir(staging);
    const store = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => root,
    });
    await store.update({
      remoteSkillSources: [{
        id: 'demo-source',
        repository: 'https://example.com/acme/skills.git',
      }],
    });
    const git = fakeGit();

    const snapshot = await refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: git.run,
      temporaryDirectory: staging,
    });

    expect(snapshot).toMatchObject({
      sourceId: 'demo-source',
      revision,
      packages: [{
        name: 'demo-skill',
        description: 'A remote demo.',
        repositoryPath: 'collection/demo',
        files: 2,
      }],
      agents: [
        { harness: 'copilot', name: 'test-runner', status: 'available' },
        { harness: 'opencode', name: 'reviewer', status: 'available' },
      ],
    });
    expect(snapshot.packages[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const packageRoot = join(
      store.getConfigDir(),
      'catalog-sources',
      'demo-source',
      revision,
      'packages',
      snapshot.packages[0]!.directory,
    );
    expect(await readFile(join(packageRoot, 'SKILL.md'), 'utf8')).toContain('Instructions.');
    expect((await readdir(staging))).toEqual([]);
    expect(git.commands[0]).toContain('--no-checkout');
    expect(git.commands.flat().some((argument) => argument === 'checkout')).toBe(false);
    expect(git.outputLimits).toEqual([
      2 * 1024 * 1024,
      2 * 1024 * 1024,
      2 * 1024 * 1024,
      20 * 1024 * 1024,
      20 * 1024 * 1024,
      20 * 1024 * 1024,
      20 * 1024 * 1024,
    ]);
    expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'demo-source')).toEqual([snapshot]);
    await expect(resolveSnapshotPackagePath(
      store.getConfigDir(),
      snapshot,
      snapshot.packages[0]!,
    )).resolves.toBe(packageRoot);
    const agent = snapshot.agents.find((entry) => entry.harness === 'copilot');
    expect(agent).toBeDefined();
    const agentPath = await resolveSnapshotAgentPath(
      store.getConfigDir(),
      snapshot,
      agent!,
    );
    await expect(inspectRemoteSnapshotCandidate(store.getConfigDir(), 'demo-source', revision, {
      kind: 'agent', repositoryPath: agent!.repositoryPath,
    })).resolves.toMatchObject({ kind: 'agent', path: agentPath, candidate: { fingerprint: agent!.fingerprint } });
    await expect(inspectRemoteSnapshotCandidate(store.getConfigDir(), 'demo-source', revision, {
      kind: 'skill', repositoryPath: '../unlisted',
    })).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.NOT_FOUND });
    expect(await readFile(agentPath, 'utf8')).toContain('Run tests.');
    await writeFile(join(packageRoot, 'SKILL.md'), 'tampered');
    await expect(resolveSnapshotPackagePath(
      store.getConfigDir(),
      snapshot,
      snapshot.packages[0]!,
    )).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
    await truncate(join(packageRoot, 'SKILL.md'), snapshot.packages[0]!.bytes + 1);
    await expect(resolveSnapshotPackagePath(
      store.getConfigDir(),
      snapshot,
      snapshot.packages[0]!,
    )).rejects.toMatchObject({
      code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT, details: { reason: 'CONTENT_MISMATCH' },
    });
    await writeFile(agentPath, 'tampered');
    await expect(resolveSnapshotAgentPath(
      store.getConfigDir(),
      snapshot,
      agent!,
    )).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
  });

  it('keeps unsupported and malformed native agents visible but unselectable', async () => {
    const root = await makeRoot();
    const store = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => root,
    });
    await store.update({
      remoteSkillSources: [{
        id: 'demo-source',
        repository: 'https://example.com/acme/skills.git',
      }],
    });
    const tree = [
      `100644 blob ${openCodeAgentBlob}\t.opencode/agents/sub/reviewer.md\0`,
      `100644 blob ${copilotAgentBlob}\t.github/agents/tester.agent.md\0`,
    ].join('');
    const git = fakeGit(tree);
    git.commands.length = 0;
    const snapshot = await refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: async (args, cwd, timeoutMs, maxOutputBytes) => {
        if (args.includes('cat-file')) {
          const blob = args.at(-1);
          if (blob === openCodeAgentBlob) {
            return { stdout: '---\nmode: subagent\n---\nSubagent only.\n' };
          }
          if (blob === copilotAgentBlob) {
            return { stdout: '---\ndescription: Missing a required name.\n---\nInvalid.\n' };
          }
        }
        return git.run(args, cwd, timeoutMs, maxOutputBytes);
      },
    });
    expect(snapshot.agents.map((agent) => agent.status)).toEqual(['invalid', 'unsupported']);
  });

  it('rejects unsafe package files and leaves no partial snapshot', async () => {
    const root = await makeRoot();
    const staging = join(root, 'staging');
    await mkdir(staging);
    const store = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => root,
    });
    await store.update({
      remoteSkillSources: [{
        id: 'demo-source',
        repository: 'git@example.com:acme/skills.git',
      }],
    });
    const unsafeTree = [
      `100644 blob ${skillBlob}\tpackage/SKILL.md\0`,
      `100644 blob ${readmeBlob}\tpackage/../outside.txt\0`,
    ].join('');
    const git = fakeGit(unsafeTree);

    await expect(refreshRemoteSkillSource(store, 'demo-source', {
      gitRunner: git.run,
      temporaryDirectory: staging,
    })).rejects.toMatchObject({
      code: REMOTE_SOURCE_ERROR_CODES.INVALID_PACKAGE,
    } satisfies Partial<RemoteSourceError>);
    expect(await listRemoteSkillSnapshots(store.getConfigDir(), 'demo-source')).toEqual([]);
    expect(await readdir(staging)).toEqual([]);
  });

  it('reports absent registrations and limits duplicate output without leaking repository details', async () => {
    const root = await makeRoot();
    const store = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => root,
    });
    const error = await refreshRemoteSkillSource(store, 'missing').catch((value: unknown) => value);
    expect(error).toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.NOT_FOUND });

    const tree = Array.from({ length: 101 }, (_, index) =>
      `100644 blob ${createHash('sha1').update(String(index)).digest('hex')}\t${String(index)}/SKILL.md\0`,
    ).join('');
    const sourceStore = createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'many-config') },
      homeDirectory: () => root,
    });
    await sourceStore.update({
      remoteSkillSources: [{
        id: 'demo-source',
        repository: 'https://example.com/acme/skills.git',
      }],
    });
    const staging = join(root, 'staging-many');
    await mkdir(staging);
    await expect(refreshRemoteSkillSource(sourceStore, 'demo-source', {
      gitRunner: fakeGit(tree).run,
      temporaryDirectory: staging,
    })).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.TOO_LARGE });
  });
});
