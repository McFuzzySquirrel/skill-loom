import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { ConfigStore } from '../config/store.js';
import { canonicalConfigRoot } from '../config/canonical-root.js';
import type { ProjectRegistry } from '../projects/registry.js';
import { TestWorkspaceError, TEST_WORKSPACE_ERROR_CODES } from './test-workspaces.js';
import { withWorkspaceLifecycleLock } from './workspace-lock.js';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 10_000;

export async function inspectTestWorkspace(
  options: { configStore: ConfigStore; projectRegistry: ProjectRegistry },
  input: { workspaceId: string; path: string; offset: number; limit: number },
) {
  const record = (await options.configStore.get()).testWorkspaces.find((item) => item.id === input.workspaceId);
  if (record === undefined) {
    throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.NOT_FOUND, 'No managed test workspace matches that id.');
  }
  return withWorkspaceLifecycleLock(record.projectId, async () => {
    const current = (await options.configStore.get()).testWorkspaces.find((item) => item.id === input.workspaceId);
    const project = current === undefined ? undefined : await options.projectRegistry.findRecentProject(current.projectId);
    let root: string;
    try {
      root = join(await canonicalConfigRoot(options.configStore.getConfigDir()), 'test-workspaces', input.workspaceId);
    } catch (error) {
      throw new TestWorkspaceError(
        TEST_WORKSPACE_ERROR_CODES.PATH_INVALID,
        'The managed workspace storage directory is unavailable or unsafe.',
        {},
        { cause: error },
      );
    }
    if (project?.managedWorkspace !== true || project.canonicalPath !== root) {
      throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.PATH_INVALID, 'The managed workspace ownership record is invalid.');
    }
    const segments = input.path === '' ? [] : input.path.split('/');
    if (isAbsolute(input.path) || input.path.includes('\\') || input.path.includes('\0') ||
        segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.PATH_INVALID, 'The workspace inspection path is invalid.');
    }
    let verifiedRoot = false;
    try {
      let path = root;
      for (const segment of ['', ...segments]) {
        if (segment !== '') path = join(path, segment);
        const info = await lstat(path);
        const fromRoot = relative(root, path);
        if (info.isSymbolicLink() || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) ||
            await realpath(path) !== path) {
          throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.PATH_INVALID, 'Workspace inspection refuses symbolic links and paths outside the workspace.');
        }
        verifiedRoot = true;
      }
      const info = await lstat(path);
      if (info.isDirectory()) {
        const names = (await readdir(path)).sort();
        if (names.length > MAX_DIRECTORY_ENTRIES) {
          throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.INSPECT_FAILED, 'The directory exceeds the 10,000-entry inspection limit.');
        }
        const page = names.slice(input.offset, input.offset + input.limit);
        const entries = await Promise.all(page.map(async (name) => {
          const entry = await lstat(join(path, name));
          return {
            name,
            type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
            ...(entry.isFile() ? { bytes: entry.size } : {}),
          };
        }));
        return {
          type: 'directory' as const, path: input.path, total: names.length, offset: input.offset, entries,
          nextOffset: input.offset + entries.length < names.length ? input.offset + entries.length : null,
        };
      }
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.INSPECT_FAILED, 'Workspace inspection supports only regular files up to 1 MiB.');
      }
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const fileInfo = await file.stat();
        if (!fileInfo.isFile() || fileInfo.size > MAX_FILE_BYTES) {
          throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.INSPECT_FAILED, 'Workspace inspection supports only regular files up to 1 MiB.');
        }
        const content = Buffer.alloc(fileInfo.size + 1);
        let bytes = 0;
        while (bytes < content.length) {
          const result = await file.read(content, bytes, content.length - bytes, bytes);
          if (result.bytesRead === 0) break;
          bytes += result.bytesRead;
        }
        if (bytes !== fileInfo.size) {
          throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.INSPECT_FAILED, 'The workspace file changed during inspection.');
        }
        return { type: 'file' as const, path: input.path, bytes, encoding: 'base64' as const, content: content.subarray(0, bytes).toString('base64') };
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof TestWorkspaceError) throw error;
      if (verifiedRoot && segments.length > 0 && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.ARTIFACT_NOT_FOUND, 'The workspace artifact does not exist.', { path: input.path }, { cause: error });
      }
      throw new TestWorkspaceError(TEST_WORKSPACE_ERROR_CODES.INSPECT_FAILED, 'The workspace path could not be inspected.', { path: input.path }, { cause: error });
    }
  });
}
