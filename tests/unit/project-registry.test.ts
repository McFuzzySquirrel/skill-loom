import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConfigStore } from '../../src/server/config/store.js';
import { FolderPathError } from '../../src/server/projects/paths.js';
import {
  PROJECT_ERROR_CODES,
  ProjectRegistryError,
  LOOM_GITIGNORE_CONTENT,
  createProjectRegistry,
  isProjectId,
  projectDisplayName,
  projectIdForPath,
  type GitInitRunner,
  type ProjectRegistry,
} from '../../src/server/projects/registry.js';

let root: string;
let configDirectory: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-project-registry-')));
  configDirectory = join(root, 'config');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function storeFor() {
  return createConfigStore({
    env: { LOOM_CONFIG_DIR: configDirectory },
    homeDirectory: () => join(root, 'home'),
  });
}

function clockFrom(timestamps: string[]): () => Date {
  let index = 0;
  return () => {
    const value = timestamps[Math.min(index, timestamps.length - 1)] ?? '2026-11-04T12:00:00.000Z';
    index += 1;
    return new Date(value);
  };
}

function registryWith(
  options: { gitInit?: GitInitRunner; now?: () => Date } = {},
): ProjectRegistry {
  return createProjectRegistry({
    configStore: storeFor(),
    ...(options.gitInit === undefined ? {} : { gitInit: options.gitInit }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to reject.');
}

async function expectProjectError(
  operation: Promise<unknown>,
  code: string,
): Promise<ProjectRegistryError> {
  const captured = await captureError(operation);
  expect(captured).toBeInstanceOf(ProjectRegistryError);
  const error = captured as ProjectRegistryError;
  expect(error.code).toBe(code);
  return error;
}

async function expectFolderError(operation: Promise<unknown>, code: string): Promise<void> {
  const captured = await captureError(operation);
  expect(captured).toBeInstanceOf(FolderPathError);
  expect((captured as FolderPathError).code).toBe(code);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('project identity', () => {
  it('returns the same path-derived id when the same canonical path is opened twice', async () => {
    const project = join(root, 'My Project');
    await mkdir(project);
    const canonical = await realpath(project);

    const registry = registryWith({
      now: clockFrom(['2026-11-04T10:00:00.000Z', '2026-11-04T11:00:00.000Z']),
    });

    const first = await registry.openProject(project);
    const second = await registry.openProject(canonical);

    expect(first.id).toBe(second.id);
    expect(first.id).toBe(projectIdForPath(canonical));
    expect(isProjectId(first.id)).toBe(true);
    expect(first.canonicalPath).toBe(canonical);
    expect(first.displayName).toBe('My Project');
    expect(projectDisplayName(canonical)).toBe('My Project');

    const recent = await registry.listRecentProjects();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toEqual({
      id: first.id,
      canonicalPath: canonical,
      displayName: 'My Project',
      lastOpenedAt: '2026-11-04T11:00:00.000Z',
    });
  });

  it('canonicalizes a symlinked path before deriving the id', async () => {
    const target = join(root, 'real-project');
    const alias = join(root, 'alias-project');
    await mkdir(target);
    await symlink(target, alias, 'dir');

    const registry = registryWith();

    const viaAlias = await registry.openProject(alias);
    const viaTarget = await registry.openProject(target);

    expect(viaAlias.canonicalPath).toBe(await realpath(target));
    expect(viaAlias.id).toBe(viaTarget.id);
    expect(await registry.listRecentProjects()).toHaveLength(1);
  });

  it('derives different ids for different canonical paths', () => {
    const first = projectIdForPath('/tmp/one');
    const second = projectIdForPath('/tmp/two');

    expect(first).not.toBe(second);
    expect(isProjectId(first)).toBe(true);
    expect(isProjectId(second)).toBe(true);
  });

  it('rejects ids containing separators, traversal, or arbitrary text', () => {
    for (const value of ['', '..', '../escape', 'a/b', 'a-b', 'project-000000000000x']) {
      expect(isProjectId(value)).toBe(false);
    }
  });
});

describe('.loom initialization', () => {
  it('creates .loom/.gitignore with runs/ and no chains or run directories', async () => {
    const project = join(root, 'fresh-project');
    await mkdir(project);

    const registry = registryWith();
    const registration = await registry.openProject(project);

    expect(registration.loom.gitignoreCreated).toBe(true);
    expect(registration.loom.directory).toBe(join(await realpath(project), '.loom'));
    expect(registration.loom.chainCount).toBe(0);
    expect(registration.loom.hasChains).toBe(false);

    const gitignore = await readFile(join(project, '.loom', '.gitignore'), 'utf8');
    expect(gitignore).toBe(LOOM_GITIGNORE_CONTENT);
    expect(gitignore).toContain('runs/');

    expect(await readdir(join(project, '.loom'))).toEqual(['.gitignore']);
    expect(await exists(join(project, '.loom', 'chains'))).toBe(false);
    expect(await exists(join(project, '.loom', 'runs'))).toBe(false);
    expect(await readdir(project)).toEqual(['.loom']);
  });

  it('preserves an existing .loom/.gitignore and other user files', async () => {
    const project = join(root, 'existing-project');
    await mkdir(join(project, '.loom'), { recursive: true });
    const custom = '# custom ignore\nnode_modules/\nruns/\n';
    await writeFile(join(project, '.loom', '.gitignore'), custom, 'utf8');
    await writeFile(join(project, '.loom', 'keep.txt'), 'keep me\n', 'utf8');

    const registry = registryWith();
    await registry.openProject(project);
    const second = await registry.openProject(project);

    expect(second.loom.gitignoreCreated).toBe(false);
    expect(await readFile(join(project, '.loom', '.gitignore'), 'utf8')).toBe(custom);
    expect(await readFile(join(project, '.loom', 'keep.txt'), 'utf8')).toBe('keep me\n');
  });

  it('reports existing chain files without modifying them', async () => {
    const project = join(root, 'with-chains');
    await mkdir(join(project, '.loom', 'chains'), { recursive: true });
    const chainPath = join(project, '.loom', 'chains', 'alpha.json');
    await writeFile(chainPath, '{"version":1,"id":"alpha"}\n', 'utf8');
    await writeFile(join(project, '.loom', 'chains', 'notes.txt'), 'not a chain\n', 'utf8');

    const registration = await registryWith().openProject(project);

    expect(registration.loom.chainCount).toBe(1);
    expect(registration.loom.hasChains).toBe(true);
    expect(await readFile(chainPath, 'utf8')).toBe('{"version":1,"id":"alpha"}\n');
    expect(await exists(join(project, '.loom', 'runs'))).toBe(false);
  });
});

describe('creating a project', () => {
  it('creates an empty folder without scaffolding and without git by default', async () => {
    const registry = registryWith();
    const registration = await registry.createProject({
      parentPath: root,
      name: 'new-project',
    });

    const target = join(root, 'new-project');
    expect(registration.canonicalPath).toBe(await realpath(target));
    expect(registration.gitInitialized).toBe(false);
    expect(registration.isGitRepo).toBe(false);
    expect((await stat(target)).isDirectory()).toBe(true);
    expect(await readdir(target)).toEqual(['.loom']);
    expect(await exists(join(target, '.git'))).toBe(false);
    expect(await exists(join(target, 'package.json'))).toBe(false);

    const recent = await registry.listRecentProjects();
    expect(recent.map((entry) => entry.id)).toEqual([registration.id]);
  });

  it('runs git init only when requested and records the result', async () => {
    const calls: string[] = [];
    const gitInit: GitInitRunner = async (directory) => {
      calls.push(directory);
      await mkdir(join(directory, '.git'));
    };
    const registry = registryWith({ gitInit });

    const withGit = await registry.createProject({
      parentPath: root,
      name: 'git-project',
      gitInit: true,
    });
    const withoutGit = await registry.createProject({
      parentPath: root,
      name: 'plain-project',
    });

    expect(calls).toEqual([await realpath(join(root, 'git-project'))]);
    expect(withGit.gitInitialized).toBe(true);
    expect(withGit.isGitRepo).toBe(true);
    expect(withoutGit.gitInitialized).toBe(false);
    expect(withoutGit.isGitRepo).toBe(false);
  });

  it('reports git unavailable without registering the project', async () => {
    const gitInit: GitInitRunner = async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    };
    const registry = registryWith({ gitInit });

    const error = await expectProjectError(
      registry.createProject({ parentPath: root, name: 'no-git', gitInit: true }),
      PROJECT_ERROR_CODES.GIT_UNAVAILABLE,
    );

    expect(error.details).toMatchObject({ reason: 'ENOENT' });
    expect(await exists(join(root, 'no-git', '.loom'))).toBe(false);
    expect(await registry.listRecentProjects()).toEqual([]);
  });

  it('reports a failed git init with the exit code and does not register', async () => {
    const gitInit: GitInitRunner = async () => {
      throw Object.assign(new Error('git init failed'), {
        code: 'GIT_INIT_EXIT',
        exitCode: 128,
      });
    };
    const registry = registryWith({ gitInit });

    const error = await expectProjectError(
      registry.createProject({ parentPath: root, name: 'bad-git', gitInit: true }),
      PROJECT_ERROR_CODES.GIT_INIT_FAILED,
    );

    expect(error.details).toMatchObject({ exitCode: 128 });
    expect(await registry.listRecentProjects()).toEqual([]);
  });

  it('rejects an existing target with a conflict and leaves it untouched', async () => {
    const existing = join(root, 'occupied');
    await mkdir(existing);
    await writeFile(join(existing, 'marker.txt'), 'original\n', 'utf8');

    const registry = registryWith();
    const error = await expectProjectError(
      registry.createProject({ parentPath: root, name: 'occupied' }),
      PROJECT_ERROR_CODES.CREATE_TARGET_EXISTS,
    );

    expect(error.details).toMatchObject({ path: existing });
    expect(await readFile(join(existing, 'marker.txt'), 'utf8')).toBe('original\n');
    expect(await exists(join(existing, '.loom'))).toBe(false);
    expect(await registry.listRecentProjects()).toEqual([]);
  });

  it('rejects an existing dangling symlink target as a conflict', async () => {
    const link = join(root, 'dangling-target');
    await symlink(join(root, 'missing-target'), link, 'dir');

    const registry = registryWith();
    await expectProjectError(
      registry.createProject({ parentPath: root, name: 'dangling-target' }),
      PROJECT_ERROR_CODES.CREATE_TARGET_EXISTS,
    );
  });

  it('rejects a missing parent and a parent that is a file', async () => {
    const registry = registryWith();

    await expectFolderError(
      registry.createProject({ parentPath: join(root, 'missing'), name: 'child' }),
      'PATH_NOT_FOUND',
    );

    const file = join(root, 'parent.txt');
    await writeFile(file, 'not a directory\n', 'utf8');
    await expectFolderError(
      registry.createProject({ parentPath: file, name: 'child' }),
      'PATH_NOT_DIRECTORY',
    );
  });

  it('rejects names that are not a single safe path segment', async () => {
    const registry = registryWith();
    const invalidNames: Array<[unknown, string]> = [
      ['', 'REQUIRED'],
      ['   ', 'REQUIRED'],
      [' padded', 'SURROUNDING_WHITESPACE'],
      ['padded ', 'SURROUNDING_WHITESPACE'],
      ['.', 'RESERVED'],
      ['..', 'RESERVED'],
      ['a/b', 'SEPARATOR'],
      ['a\\b', 'SEPARATOR'],
      ['bad\0name', 'SEPARATOR'],
      ['x'.repeat(256), 'TOO_LONG'],
      [42, 'REQUIRED'],
    ];

    for (const [name, reason] of invalidNames) {
      const error = await expectProjectError(
        registry.createProject({ parentPath: root, name: name as string }),
        PROJECT_ERROR_CODES.NAME_INVALID,
      );
      expect(error.details).toMatchObject({ reason });
    }

    expect(await readdir(root)).toEqual([]);
  });
});

describe('recent projects and removal', () => {
  it('returns recent projects newest first and updates on reopen', async () => {
    const first = join(root, 'alpha');
    const second = join(root, 'beta');
    await mkdir(first);
    await mkdir(second);

    const registry = registryWith({
      now: clockFrom([
        '2026-11-04T09:00:00.000Z',
        '2026-11-04T10:00:00.000Z',
        '2026-11-04T11:00:00.000Z',
      ]),
    });

    await registry.openProject(first);
    await registry.openProject(second);

    let recent = await registry.listRecentProjects();
    expect(recent.map((entry) => entry.displayName)).toEqual(['beta', 'alpha']);
    expect(recent[0]?.lastOpenedAt).toBe('2026-11-04T10:00:00.000Z');

    await registry.openProject(first);
    recent = await registry.listRecentProjects();
    expect(recent.map((entry) => entry.displayName)).toEqual(['alpha', 'beta']);
    expect(recent[0]?.lastOpenedAt).toBe('2026-11-04T11:00:00.000Z');
    expect(recent).toHaveLength(2);
  });

  it('persists id, canonical path, display name, and lastOpenedAt in global config', async () => {
    const project = join(root, 'persisted');
    await mkdir(project);

    const registry = registryWith({ now: clockFrom(['2026-11-04T12:34:56.000Z']) });
    const registration = await registry.openProject(project);

    const raw = JSON.parse(
      await readFile(join(configDirectory, 'config.json'), 'utf8'),
    ) as { recentProjects: unknown[] };

    expect(raw.recentProjects).toEqual([
      {
        id: registration.id,
        canonicalPath: await realpath(project),
        displayName: 'persisted',
        lastOpenedAt: '2026-11-04T12:34:56.000Z',
      },
    ]);
  });

  it('removes only the recent entry and leaves project files intact', async () => {
    const project = join(root, 'keep-my-files');
    await mkdir(join(project, '.loom', 'chains'), { recursive: true });
    await writeFile(join(project, 'source.ts'), 'export const kept = true;\n', 'utf8');
    const chainPath = join(project, '.loom', 'chains', 'chain.json');
    await writeFile(chainPath, '{"version":1}\n', 'utf8');

    const registry = registryWith();
    const registration = await registry.openProject(project);

    const result = await registry.removeRecentProject(registration.id);

    expect(result).toEqual({ projectId: registration.id, removed: true });
    expect(await registry.listRecentProjects()).toEqual([]);
    expect(await readFile(join(project, 'source.ts'), 'utf8')).toBe(
      'export const kept = true;\n',
    );
    expect(await readFile(chainPath, 'utf8')).toBe('{"version":1}\n');
  });

  it('returns a typed not-found error for an unknown recent id', async () => {
    const registry = registryWith();
    const error = await expectProjectError(
      registry.removeRecentProject(projectIdForPath('/tmp/never-registered')),
      PROJECT_ERROR_CODES.RECENT_NOT_FOUND,
    );

    expect(error.details).toMatchObject({
      projectId: projectIdForPath('/tmp/never-registered'),
    });
  });

  it('rejects malformed project ids before touching the configuration', async () => {
    const registry = registryWith();

    for (const value of ['..', '../escape', 'bad id', 'not-a-valid-id', '']) {
      await expectProjectError(
        registry.removeRecentProject(value),
        PROJECT_ERROR_CODES.ID_INVALID,
      );
    }

    expect(await exists(join(configDirectory, 'config.json'))).toBe(false);
  });

  it('finds a recent project by id and ignores malformed ids', async () => {
    const project = join(root, 'lookup');
    await mkdir(project);

    const registry = registryWith();
    const registration = await registry.openProject(project);

    await expect(registry.findRecentProject(registration.id)).resolves.toMatchObject({
      id: registration.id,
      canonicalPath: await realpath(project),
    });
    await expect(registry.findRecentProject('../escape')).resolves.toBeUndefined();
  });
});

describe('opening existing directories', () => {
  it('rejects relative paths and file paths with typed errors', async () => {
    const file = join(root, 'notes.txt');
    await writeFile(file, 'private\n', 'utf8');

    const registry = registryWith();
    await expectFolderError(registry.openProject('relative/path'), 'PATH_NOT_ABSOLUTE');
    await expectFolderError(registry.openProject(file), 'PATH_NOT_DIRECTORY');
    await expectFolderError(registry.openProject(join(root, 'missing')), 'PATH_NOT_FOUND');
  });

  it('never returns file contents', async () => {
    const project = join(root, 'secret-project');
    await mkdir(project);
    await writeFile(join(project, 'secret.txt'), 'TOP-SECRET-MARKER\n', 'utf8');

    const registration = await registryWith().openProject(project);

    expect(JSON.stringify(registration)).not.toContain('TOP-SECRET-MARKER');
  });
});
