import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConfigStore } from '../../src/server/config/store.js';
import {
  REMOTE_SOURCE_ERROR_CODES,
  RemoteSourceError,
  listRemoteSkillSnapshots,
  resolveSnapshotAgentPath,
  resolveSnapshotPackagePath,
  refreshRemoteSkillSource,
  type RemoteSourceGitRunner,
} from '../../src/server/catalog/remote.js';

const roots: string[] = [];
const revision = 'a'.repeat(40);
const skillBlob = 'b'.repeat(40);
const readmeBlob = 'c'.repeat(40);
const openCodeAgentBlob = 'd'.repeat(40);
const copilotAgentBlob = 'e'.repeat(40);

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loom-remote-test-'));
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
      if (args[0] === 'clone' || args[1] === 'fetch') return { stdout: '' };
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
    expect(await readFile(agentPath, 'utf8')).toContain('Run tests.');
    await writeFile(join(packageRoot, 'SKILL.md'), 'tampered');
    await expect(resolveSnapshotPackagePath(
      store.getConfigDir(),
      snapshot,
      snapshot.packages[0]!,
    )).rejects.toMatchObject({ code: REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT });
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
