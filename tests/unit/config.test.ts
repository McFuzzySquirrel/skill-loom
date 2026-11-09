import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIG_TOP_LEVEL_FIELDS,
  CONFIG_VERSION,
  ConfigUpdateSchema,
  LoomConfigSchema,
  REMOTE_CATALOG_DEFAULT_LIMITS,
  createDefaultConfig,
  type ConfigUpdate,
} from '../../src/server/config/schema.js';
import {
  ConfigCorruptError,
  ConfigError,
  ConfigUnsupportedVersionError,
  atomicWriteJson,
  createConfigStore,
  resolveConfigDir,
  resolveConfigPath,
} from '../../src/server/config/store.js';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loom-config-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function storeFor(root: string, env: NodeJS.ProcessEnv = { LOOM_CONFIG_DIR: join(root, 'config') }) {
  return createConfigStore({ env, homeDirectory: () => join(root, 'home') });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to reject.');
}

function temporaryFiles(names: string[]): string[] {
  return names.filter((name) => name.endsWith('.tmp'));
}

describe('config path resolution', () => {
  it('honors LOOM_CONFIG_DIR and otherwise defaults to ~/.config/loom', () => {
    const override = '/tmp/loom-config-override';
    const env = { LOOM_CONFIG_DIR: override };

    expect(resolveConfigDir({ env, homeDirectory: () => '/home/ignored' })).toBe(resolve(override));
    expect(resolveConfigPath({ env, homeDirectory: () => '/home/ignored' })).toBe(
      join(resolve(override), 'config.json'),
    );

    const home = '/home/loom-user';
    expect(resolveConfigPath({ env: {}, homeDirectory: () => home })).toBe(
      join(home, '.config', 'loom', 'config.json'),
    );
    expect(resolveConfigPath({ env: { LOOM_CONFIG_DIR: '   ' }, homeDirectory: () => home })).toBe(
      join(home, '.config', 'loom', 'config.json'),
    );
  });

  it('resolves the override on every operation, not only at construction', async () => {
    const root = await makeRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    const env: NodeJS.ProcessEnv = { LOOM_CONFIG_DIR: first };
    const store = createConfigStore({ env, homeDirectory: () => join(root, 'home') });

    await store.get();
    expect(await fileExists(join(first, 'config.json'))).toBe(true);

    env.LOOM_CONFIG_DIR = second;
    expect(store.getConfigDir()).toBe(resolve(second));
    expect(store.getConfigPath()).toBe(join(resolve(second), 'config.json'));

    await store.update({ uiPreferences: { theme: 'dark' } });
    expect(await fileExists(join(second, 'config.json'))).toBe(true);

    const firstDocument = JSON.parse(await readFile(join(first, 'config.json'), 'utf8')) as {
      uiPreferences: Record<string, unknown>;
    };
    const secondDocument = JSON.parse(await readFile(join(second, 'config.json'), 'utf8')) as {
      uiPreferences: Record<string, unknown>;
    };
    expect(firstDocument.uiPreferences).toEqual({});
    expect(secondDocument.uiPreferences).toEqual({ theme: 'dark' });
  });
});

describe('missing configuration', () => {
  it('returns documented defaults, creates the file, and writes a private mode', async () => {
    const root = await makeRoot();
    const store = storeFor(root);

    const config = await store.get();

    expect(config).toEqual(createDefaultConfig());
    expect(config.version).toBe(CONFIG_VERSION);
    expect(config.harnessCommands).toEqual({});
    expect(config.extraSkillDirectories).toEqual([]);
    expect(config.remoteSkillSources).toEqual([]);
    expect(config.recentProjects).toEqual([]);
    expect(config.discoveryWorkspaces).toEqual([]);
    expect(config.uiPreferences).toEqual({});

    const onDiskText = await readFile(store.getConfigPath(), 'utf8');
    expect(onDiskText.endsWith('\n')).toBe(true);
    expect(JSON.parse(onDiskText)).toEqual(createDefaultConfig());
    if (process.platform !== 'win32') {
      expect((await stat(store.getConfigPath())).mode & 0o777).toBe(0o600);
    }
  });

  it('creates the file on the first update without a prior read', async () => {
    const root = await makeRoot();
    const store = storeFor(root);

    const updated = await store.update({ uiPreferences: { density: 'compact' } });

    expect(updated.uiPreferences).toEqual({ density: 'compact' });
    expect(JSON.parse(await readFile(store.getConfigPath(), 'utf8'))).toEqual(updated);
  });
});

describe('corrupt and unsupported configuration', () => {
  it('reads version 1 without rewriting it and persists version 2 on update', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    const target = store.getConfigPath();
    const bytes = JSON.stringify({
      version: 1,
      remoteSkillSources: [{ id: 'legacy', repository: 'https://example.com/skills.git' }],
    });
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    expect(await store.get()).toMatchObject({
      version: CONFIG_VERSION,
      remoteCatalogLimits: REMOTE_CATALOG_DEFAULT_LIMITS,
      remoteSkillSources: [{ id: 'legacy', repository: 'https://example.com/skills.git' }],
    });
    expect(await readFile(target, 'utf8')).toBe(bytes);
    await store.update({ uiPreferences: { theme: 'dark' } });
    expect(JSON.parse(await readFile(target, 'utf8'))).toMatchObject({
      version: CONFIG_VERSION,
      remoteCatalogLimits: REMOTE_CATALOG_DEFAULT_LIMITS,
      uiPreferences: { theme: 'dark' },
    });
  });

  it('returns a typed error for malformed JSON and leaves the bytes untouched', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    const target = store.getConfigPath();
    const bytes = '{"version":1,"harnessCommands":{';
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, 'utf8');

    const error = await captureError(store.get());

    expect(error).toBeInstanceOf(ConfigCorruptError);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({
      code: 'CONFIG_CORRUPT',
      details: { path: target },
    });
    expect(await readFile(target, 'utf8')).toBe(bytes);

    // An update must fail the same way rather than replacing the user's file.
    const updateError = await captureError(store.update({ uiPreferences: { theme: 'dark' } }));
    expect(updateError).toMatchObject({ code: 'CONFIG_CORRUPT' });
    expect(await readFile(target, 'utf8')).toBe(bytes);
  });

  it('returns a typed error for a schema-invalid document without overwriting it', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    const target = store.getConfigPath();
    const bytes = JSON.stringify({ version: 1, extraSkillDirectories: 'not-an-array' });
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, 'utf8');

    const error = await captureError(store.get());

    expect(error).toBeInstanceOf(ConfigCorruptError);
    expect(error).toMatchObject({ code: 'CONFIG_CORRUPT' });
    expect((error as ConfigError).details.issues).toEqual([
      { path: 'extraSkillDirectories', code: 'invalid_type' },
    ]);
    expect(await readFile(target, 'utf8')).toBe(bytes);
  });

  it('rejects an unknown top-level version without overwriting the file', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    const target = store.getConfigPath();
    const bytes = JSON.stringify({ version: CONFIG_VERSION + 1, harnessCommands: { opencode: '/bin/opencode' } });
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, 'utf8');

    const error = await captureError(store.get());

    expect(error).toBeInstanceOf(ConfigUnsupportedVersionError);
    expect(error).toMatchObject({
      code: 'CONFIG_UNSUPPORTED_VERSION',
      details: { path: target, version: CONFIG_VERSION + 1 },
    });
    expect(await readFile(target, 'utf8')).toBe(bytes);
  });
});

describe('typed updates', () => {
  it('merges bounded catalog limit overrides and rejects invalid values', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    await store.update({ remoteCatalogLimits: { maxPackages: 1_000 } });
    const updated = await store.update({ remoteCatalogLimits: { maxFiles: 20_000 } });
    expect(updated.remoteCatalogLimits).toMatchObject({
      maxPackages: 1_000,
      maxFiles: 20_000,
      maxSnapshotBytes: REMOTE_CATALOG_DEFAULT_LIMITS.maxSnapshotBytes,
    });
    await expect(store.update({ remoteCatalogLimits: { maxPackages: 0 } })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
    await expect(store.update({ remoteCatalogLimits: { maxPackages: 10_001 } })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect((await store.get()).remoteCatalogLimits.maxPackages).toBe(1_000);
  });

  it('merges nested maps and preserves unrelated fields in the written document', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    const recent = {
      id: 'demo-project',
      canonicalPath: join(root, 'project'),
      displayName: 'Demo Project',
      lastOpenedAt: '2026-11-04T12:00:00.000Z',
    };
    const workspace = {
      id: 'f04b89d8-6ab7-4678-96dc-a225fe9024ac',
      projectId: 'managed-project',
      sourceProjectId: recent.id,
      sourceChainId: 'demo-chain',
      chainId: 'copied-chain',
      createdAt: '2026-11-04T12:00:00.000Z',
    };

    await store.update({
      harnessCommands: { opencode: '/usr/local/bin/opencode' },
      extraSkillDirectories: [join(root, 'skills')],
      remoteSkillSources: [{ id: 'public-skills', repository: 'https://github.com/acme/skills.git', ref: 'main' }],
      recentProjects: [recent],
      testWorkspaces: [workspace],
      uiPreferences: { theme: 'dark' },
    });

    const updated = await store.update({
      harnessCommands: { copilot: '/usr/local/bin/copilot' },
      uiPreferences: { density: 'compact' },
    });

    expect(updated).toEqual({
      version: CONFIG_VERSION,
      harnessCommands: {
        opencode: '/usr/local/bin/opencode',
        copilot: '/usr/local/bin/copilot',
      },
      extraSkillDirectories: [join(root, 'skills')],
      remoteSkillSources: [{ id: 'public-skills', repository: 'https://github.com/acme/skills.git', ref: 'main' }],
      remoteCatalogLimits: REMOTE_CATALOG_DEFAULT_LIMITS,
      recentProjects: [recent],
      testWorkspaces: [workspace],
      discoveryWorkspaces: [],
      uiPreferences: { theme: 'dark', density: 'compact' },
    });
    expect(JSON.parse(await readFile(store.getConfigPath(), 'utf8'))).toEqual(updated);
    expect(temporaryFiles(await readdir(dirname(store.getConfigPath())))).toEqual([]);
  });

  it('supports a functional update against the current document', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    await store.get();

    const updated = await store.update((current) => ({
      extraSkillDirectories: [...current.extraSkillDirectories, join(root, 'extra-skills')],
    }));

    expect(updated.extraSkillDirectories).toEqual([join(root, 'extra-skills')]);
  });

  it('accepts supported Git remotes but rejects embedded credentials and URL parameters', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    const validSources = [
      { id: 'https-source', repository: 'https://github.com/acme/skills.git', ref: 'main' },
      { id: 'ssh-uri', repository: 'ssh://git@github.com/acme/skills.git' },
      { id: 'scp-source', repository: 'git@github.com:acme/skills.git' },
    ];

    await expect(store.update({ remoteSkillSources: validSources })).resolves.toMatchObject({
      remoteSkillSources: validSources,
    });

    for (const repository of [
      'https://user:password@example.com/skills.git',
      'https://token@example.com/skills.git',
      'ssh://alice@example.com/skills.git',
      'https://example.com/skills.git?token=secret',
      'file:///tmp/skills.git',
      'git://example.com/skills.git',
    ]) {
      const parsed = ConfigUpdateSchema.safeParse({
        remoteSkillSources: [{ id: 'source', repository }],
      });
      expect(parsed.success, repository).toBe(false);
    }
  });

  it('serializes concurrent read-modify-write cycles without losing either update', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    await store.get();

    await Promise.all([
      store.update({ harnessCommands: { opencode: '/opt/opencode' } }),
      store.update({ uiPreferences: { theme: 'dark' } }),
    ]);

    const config = await store.get();
    expect(config.harnessCommands).toEqual({ opencode: '/opt/opencode' });
    expect(config.uiPreferences).toEqual({ theme: 'dark' });
  });

  it('rejects an invalid update with Zod 4 issue paths and leaves the file unchanged', async () => {
    const root = await makeRoot();
    const store = storeFor(root);
    const original = await store.get();
    const before = await readFile(store.getConfigPath(), 'utf8');

    const error = await captureError(store.update({ extraSkillDirectories: [''] }));

    expect(error).toMatchObject({ code: 'CONFIG_INVALID' });
    expect((error as ConfigError).details.issues).toEqual([
      { path: 'extraSkillDirectories.0', code: 'too_small' },
    ]);
    expect(await readFile(store.getConfigPath(), 'utf8')).toBe(before);
    expect(await store.get()).toEqual(original);

    const parsed = ConfigUpdateSchema.safeParse({ extraSkillDirectories: [''] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['extraSkillDirectories', 0]);
    }
  });
});

describe('atomic writes', () => {
  it('leaves the previous target intact and removes the temp file when rename fails', async () => {
    const root = await makeRoot();
    const target = join(root, 'config.json');
    const original = '{"version":1,"kept":true}\n';
    await writeFile(target, original, 'utf8');

    const failure = Object.assign(new Error('simulated rename failure'), { code: 'EIO' });
    const write = atomicWriteJson(
      target,
      { version: 1, replaced: true },
      {
        renameFile: async () => {
          throw failure;
        },
      },
    );

    await expect(write).rejects.toThrow('simulated rename failure');
    expect(await readFile(target, 'utf8')).toBe(original);
    expect(temporaryFiles(await readdir(root))).toEqual([]);
  });

  it('writes valid JSON through a temp file and leaves no residue', async () => {
    const root = await makeRoot();
    const target = join(root, 'config.json');

    await atomicWriteJson(target, createDefaultConfig());

    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(createDefaultConfig());
    expect(temporaryFiles(await readdir(root))).toEqual([]);
  });

  it('retries transient Windows rename permission failures without exposing a partial target', async () => {
    const root = await makeRoot();
    const target = join(root, 'config.json');
    const original = '{"old":true}\n';
    await writeFile(target, original);
    const waits: number[] = [];
    let attempts = 0;
    await atomicWriteJson(target, { new: true }, {
      platform: 'win32',
      delay: async (milliseconds) => { waits.push(milliseconds); },
      renameFile: async (source, destination) => {
        attempts += 1;
        expect(await readFile(target, 'utf8')).toBe(original);
        if (attempts <= 2) throw Object.assign(new Error('locked'), { code: 'EPERM' });
        await rename(source, destination);
      },
    });
    expect(attempts).toBe(3);
    expect(waits).toEqual([10, 25]);
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ new: true });
    expect(temporaryFiles(await readdir(root))).toEqual([]);
  });

  it.each([
    { platform: 'win32' as const, code: 'EPERM', attempts: 6 },
    { platform: 'win32' as const, code: 'EIO', attempts: 1 },
    { platform: 'linux' as const, code: 'EPERM', attempts: 1 },
  ])('surfaces bounded rename failures on $platform ($code)', async ({ platform, code, attempts }) => {
    const root = await makeRoot();
    const target = join(root, 'config.json');
    const original = '{"old":true}\n';
    await writeFile(target, original);
    const failure = Object.assign(new Error('rename failed'), { code });
    let calls = 0;
    await expect(atomicWriteJson(target, { new: true }, {
      platform,
      delay: async () => undefined,
      renameFile: async () => { calls += 1; throw failure; },
    })).rejects.toBe(failure);
    expect(calls).toBe(attempts);
    expect(await readFile(target, 'utf8')).toBe(original);
    expect(temporaryFiles(await readdir(root))).toEqual([]);
  });

  it('surfaces a store write failure as a typed error without a partial target', async () => {
    const root = await makeRoot();
    const target = join(root, 'config', 'config.json');
    const store = createConfigStore({
      env: { LOOM_CONFIG_DIR: dirname(target) },
      homeDirectory: () => join(root, 'home'),
      atomicWrite: async () => {
        throw Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' });
      },
    });

    const error = await captureError(store.get());

    expect(error).toMatchObject({
      code: 'CONFIG_WRITE_FAILED',
      details: { path: target, reason: 'ENOSPC' },
    });
    expect(await fileExists(target)).toBe(false);
  });
});

describe('credential safety', () => {
  it('defines no credential-like top-level fields', () => {
    expect(CONFIG_TOP_LEVEL_FIELDS).toEqual([
      'version',
      'harnessCommands',
      'extraSkillDirectories',
      'remoteSkillSources',
      'remoteCatalogLimits',
      'sharedBundleDirectory',
      'recentProjects',
      'testWorkspaces',
      'discoveryWorkspaces',
      'uiPreferences',
    ]);
    expect(Object.keys(LoomConfigSchema.shape)).toEqual([...CONFIG_TOP_LEVEL_FIELDS]);

    for (const field of CONFIG_TOP_LEVEL_FIELDS) {
      expect(field).not.toMatch(/(token|secret|password|api[-_]?key|credential|auth)/i);
    }
  });

  it('rejects credential-like keys and never echoes their values in errors', async () => {
    const parsed = LoomConfigSchema.safeParse({ ...createDefaultConfig(), apiKey: 'sk-live-secret-value' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ code: 'unrecognized_keys', keys: ['apiKey'] }),
      );
      expect(JSON.stringify(parsed.error.issues)).not.toContain('sk-live-secret-value');
    }

    const root = await makeRoot();
    const store = storeFor(root);
    const before = await store.get();

    const error = await captureError(
      store.update({ apiKey: 'sk-live-secret-value' } as unknown as ConfigUpdate),
    );

    expect(error).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(await store.get()).toEqual(before);
    expect(await readFile(store.getConfigPath(), 'utf8')).not.toContain('sk-live-secret-value');
  });
});
