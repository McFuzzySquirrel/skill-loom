import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_DIRECTORY_ENTRIES,
  listDirectory,
  type DirectoryBrowserDependencies,
} from '../../src/server/projects/browser.js';
import {
  FolderPathError,
  resolveCanonicalDirectory,
} from '../../src/server/projects/paths.js';

let root: string;
let restoreModePaths: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-projects-paths-'));
  restoreModePaths = [];
});

afterEach(async () => {
  for (const path of restoreModePaths.splice(0)) {
    await chmod(path, 0o755).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
});

function notFoundError(): NodeJS.ErrnoException {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

function permissionError(): NodeJS.ErrnoException {
  return Object.assign(new Error('denied'), { code: 'EACCES' });
}

async function expectFolderError(
  operation: Promise<unknown>,
  code: string,
): Promise<FolderPathError> {
  let captured: unknown;
  try {
    await operation;
  } catch (error) {
    captured = error;
  }

  expect(captured).toBeInstanceOf(FolderPathError);
  const error = captured as FolderPathError;
  expect(error.code).toBe(code);
  return error;
}

const unprivilegedIt = process.getuid?.() === 0 ? it.skip : it;

describe('canonical directory resolution', () => {
  it('returns the realpath and its canonical parent', async () => {
    const project = join(root, 'project');
    const nested = join(project, 'src');
    await mkdir(nested, { recursive: true });

    const resolved = await resolveCanonicalDirectory(join(project, 'src', '..', 'src'));

    expect(resolved.path).toBe(await realpath(nested));
    expect(resolved.parent).toBe(await realpath(project));
  });

  it('returns a null parent for a filesystem root', async () => {
    const filesystemRoot = parse(root).root;
    const resolved = await resolveCanonicalDirectory(filesystemRoot);

    expect(resolved.path).toBe(filesystemRoot);
    expect(resolved.parent).toBeNull();
  });

  it('rejects relative paths instead of resolving them against the process directory', async () => {
    for (const relative of ['relative/path', '../escape', '.', './projects']) {
      const error = await expectFolderError(
        resolveCanonicalDirectory(relative),
        'PATH_NOT_ABSOLUTE',
      );
      expect(error.details).toEqual({ path: relative });
    }
  });

  it('rejects empty, whitespace-only, and non-string paths', async () => {
    for (const value of ['', '   ', undefined, null, 42, {}]) {
      await expectFolderError(resolveCanonicalDirectory(value), 'PATH_REQUIRED');
    }
  });

  it('rejects a path containing a NUL byte', async () => {
    await expectFolderError(resolveCanonicalDirectory(`${root}/bad\0name`), 'PATH_INVALID');
  });

  it('rejects a file with a typed not-a-directory error', async () => {
    const file = join(root, 'notes.txt');
    await writeFile(file, 'private file body\n', 'utf8');

    const error = await expectFolderError(resolveCanonicalDirectory(file), 'PATH_NOT_DIRECTORY');
    expect(error.details).toMatchObject({ path: await realpath(file) });
    expect(JSON.stringify(error.details)).not.toContain('private file body');
  });

  it('rejects a missing path with a typed not-found error', async () => {
    const missing = join(root, 'does-not-exist');
    const error = await expectFolderError(resolveCanonicalDirectory(missing), 'PATH_NOT_FOUND');
    expect(error.details).toMatchObject({ path: missing, reason: 'ENOENT' });
  });

  it('rejects a path whose intermediate component is a file', async () => {
    const file = join(root, 'component.txt');
    await writeFile(file, 'x', 'utf8');

    await expectFolderError(
      resolveCanonicalDirectory(join(file, 'child')),
      'PATH_NOT_DIRECTORY',
    );
  });

  it('maps injected filesystem failures to typed errors', async () => {
    const unreadable = await expectFolderError(
      resolveCanonicalDirectory('/virtual/unreadable', {
        realpathPath: async () => '/virtual/unreadable',
        statPath: async () => ({ isDirectory: () => true }),
        accessPath: async () => {
          throw permissionError();
        },
      }),
      'PATH_UNREADABLE',
    );
    expect(unreadable.details).toMatchObject({ reason: 'EACCES' });

    await expectFolderError(
      resolveCanonicalDirectory('/virtual/relative-result', {
        realpathPath: async () => 'not-absolute',
      }),
      'PATH_INVALID',
    );

    await expectFolderError(
      resolveCanonicalDirectory('/virtual/dangling', {
        realpathPath: async () => {
          throw notFoundError();
        },
      }),
      'PATH_NOT_FOUND',
    );
  });

  unprivilegedIt('rejects a directory without read permission', async () => {
    const locked = join(root, 'locked');
    await mkdir(locked);
    restoreModePaths.push(locked);
    await chmod(locked, 0o000);

    const error = await expectFolderError(resolveCanonicalDirectory(locked), 'PATH_UNREADABLE');
    expect(error.details).toMatchObject({ path: await realpath(root).then((base) => join(base, 'locked')) });
  });
});

describe('symlink handling', () => {
  it('canonicalizes a symlinked directory to its real target', async () => {
    const target = join(root, 'real-directory');
    const link = join(root, 'link-to-directory');
    await mkdir(target);
    await symlink(target, link, 'dir');

    const resolved = await resolveCanonicalDirectory(link);

    expect(resolved.path).toBe(await realpath(target));
    expect(resolved.path).not.toBe(link);
  });

  it('rejects a symlink to a file as not-a-directory', async () => {
    const target = join(root, 'target.txt');
    const link = join(root, 'file-link');
    await writeFile(target, 'x', 'utf8');
    await symlink(target, link, 'file');

    await expectFolderError(resolveCanonicalDirectory(link), 'PATH_NOT_DIRECTORY');
  });

  it('rejects a dangling symlink as not-found', async () => {
    const link = join(root, 'dangling');
    await symlink(join(root, 'no-such-target'), link, 'dir');

    await expectFolderError(resolveCanonicalDirectory(link), 'PATH_NOT_FOUND');
  });

  it('lists entries through a symlinked path from the canonical target', async () => {
    const target = join(root, 'target');
    const link = join(root, 'alias');
    await mkdir(join(target, 'child'), { recursive: true });
    await writeFile(join(target, 'file.txt'), 'x', 'utf8');
    await symlink(target, link, 'dir');

    const listing = await listDirectory(link);

    expect(listing.path).toBe(await realpath(target));
    expect(listing.entries.map((entry) => entry.name)).toEqual(['child', 'file.txt']);
    expect(listing.entries[0]?.path).toBe(join(listing.path, 'child'));
  });
});

describe('directory listing', () => {
  it('sorts directories before files, case-insensitively, and detects git and .loom', async () => {
    const project = join(root, 'project');
    await mkdir(join(project, 'beta'), { recursive: true });
    await mkdir(join(project, 'Alpha'), { recursive: true });
    await mkdir(join(project, '.hidden'), { recursive: true });
    await mkdir(join(project, 'beta', '.git'), { recursive: true });
    await mkdir(join(project, 'Alpha', '.loom'), { recursive: true });
    await writeFile(join(project, 'b.txt'), 'b', 'utf8');
    await writeFile(join(project, 'A.txt'), 'a', 'utf8');

    const listing = await listDirectory(project);

    expect(listing.path).toBe(await realpath(project));
    expect(listing.parent).toBe(await realpath(root));
    expect(listing.truncated).toBe(false);
    expect(listing.entries.map((entry) => entry.name)).toEqual([
      '.hidden',
      'Alpha',
      'beta',
      'A.txt',
      'b.txt',
    ]);

    const alpha = listing.entries.find((entry) => entry.name === 'Alpha');
    expect(alpha).toMatchObject({
      isDirectory: true,
      isGitRepo: false,
      hasLoom: true,
      path: join(listing.path, 'Alpha'),
    });

    const beta = listing.entries.find((entry) => entry.name === 'beta');
    expect(beta).toMatchObject({ isDirectory: true, isGitRepo: true, hasLoom: false });

    const file = listing.entries.find((entry) => entry.name === 'A.txt');
    expect(file).toMatchObject({
      isDirectory: false,
      isGitRepo: false,
      hasLoom: false,
      path: join(listing.path, 'A.txt'),
    });
  });

  it('marks a worktree-style .git file as a repository', async () => {
    const project = join(root, 'worktree');
    await mkdir(join(project, 'repo'), { recursive: true });
    await writeFile(join(project, 'repo', '.git'), 'gitdir: /elsewhere\n', 'utf8');

    const listing = await listDirectory(project);
    const repo = listing.entries.find((entry) => entry.name === 'repo');

    expect(repo?.isGitRepo).toBe(true);
  });

  it('omits dangling symlink children without failing the listing', async () => {
    const project = join(root, 'project');
    await mkdir(project);
    await writeFile(join(project, 'visible.txt'), 'x', 'utf8');
    await symlink(join(root, 'gone'), join(project, 'broken'), 'file');

    const listing = await listDirectory(project);

    expect(listing.entries.map((entry) => entry.name)).toEqual(['visible.txt']);
  });

  unprivilegedIt('omits an unreadable child directory and still lists the parent', async () => {
    const project = join(root, 'project');
    const locked = join(project, 'locked');
    await mkdir(locked, { recursive: true });
    await writeFile(join(project, 'visible.txt'), 'x', 'utf8');
    restoreModePaths.push(locked);
    await chmod(locked, 0o000);

    const listing = await listDirectory(project);

    expect(listing.entries.map((entry) => entry.name)).toEqual(['visible.txt']);
  });

  it('omits unreadable children through the injected access seam', async () => {
    const dependencies: DirectoryBrowserDependencies = {
      realpathPath: async () => '/virtual',
      statPath: async () => ({ isDirectory: () => true }),
      accessPath: async (path) => {
        if (path === '/virtual/locked') {
          throw permissionError();
        }
      },
      readDirectory: async () => [
        { name: 'locked', isDirectory: true, isSymbolicLink: false },
        { name: 'open', isDirectory: true, isSymbolicLink: false },
      ],
    };

    const listing = await listDirectory('/virtual', dependencies);

    expect(listing.entries.map((entry) => entry.name)).toEqual(['open']);
  });

  it('truncates after sorting so directories still come first', async () => {
    const project = join(root, 'project');
    for (const name of ['a-dir', 'b-dir', 'z-dir']) {
      await mkdir(join(project, name), { recursive: true });
    }
    for (const name of ['a.txt', 'b.txt', 'z.txt']) {
      await writeFile(join(project, name), 'x', 'utf8');
    }

    const listing = await listDirectory(project, { maxEntries: 2 });

    expect(listing.truncated).toBe(true);
    expect(listing.entries.map((entry) => entry.name)).toEqual(['a-dir', 'b-dir']);
  });

  it('does not truncate a directory at exactly the default cap', async () => {
    const dependencies: DirectoryBrowserDependencies = {
      realpathPath: async () => '/virtual',
      statPath: async () => ({ isDirectory: () => true }),
      accessPath: async () => undefined,
      readDirectory: async () =>
        Array.from({ length: DEFAULT_MAX_DIRECTORY_ENTRIES }, (_, index) => ({
          name: `dir-${String(index).padStart(4, '0')}`,
          isDirectory: true,
          isSymbolicLink: false,
        })),
    };

    const listing = await listDirectory('/virtual', dependencies);

    expect(listing.truncated).toBe(false);
    expect(listing.entries).toHaveLength(DEFAULT_MAX_DIRECTORY_ENTRIES);
  });

  it('never exposes file contents in the listing payload', async () => {
    const project = join(root, 'project');
    const secret = 'TOP-SECRET-CONTENT';
    await mkdir(project);
    await writeFile(join(project, 'secret.txt'), secret, 'utf8');

    const list = await listDirectory(project);

    expect(JSON.stringify(list)).not.toContain(secret);
  });
});
