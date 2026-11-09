import { mkdtemp, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../src/server/config/store.js';
import { createSharedLibrary, SHARED_LIBRARY_ERROR_CODES } from '../../src/server/bundles/shared-library.js';

const fault = vi.hoisted(() => ({ directory: '', code: '' }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (args[0] !== fault.directory || fault.code === '') return handle;
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'sync') return async () => { throw Object.assign(new Error('sync failure'), { code: fault.code }); };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let root = '';

afterEach(async () => {
  Object.defineProperty(process, 'platform', platform);
  fault.directory = '';
  fault.code = '';
  if (root !== '') await rm(root, { recursive: true, force: true });
  root = '';
});

describe('shared library directory synchronization', () => {
  it.each([
    { platform: 'win32', code: 'EPERM', succeeds: true },
    { platform: 'win32', code: 'EIO', succeeds: false },
    { platform: 'linux', code: 'EPERM', succeeds: false },
  ])('handles $code on $platform without ignoring other failures', async ({ platform: os, code, succeeds }) => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-library-sync-')));
    const directory = join(root, 'shared');
    await mkdir(directory);
    const library = createSharedLibrary(createConfigStore({ env: { LOOM_CONFIG_DIR: join(root, 'config') } }));
    await library.configure(directory);
    fault.directory = directory;
    fault.code = code;
    Object.defineProperty(process, 'platform', { ...platform, value: os });

    const operation = library.publish({
      format: 'skill-loom-chain', version: 1,
      chain: {
        name: 'Test', harness: 'opencode', sessionMode: 'shared',
        steps: [{ id: 'one', kind: 'instruction', instruction: 'Review.' }], inputs: [],
      },
      skills: [],
    }, 'Test');
    if (succeeds) {
      await expect(operation).resolves.toMatchObject({ status: 'available' });
      expect(await readdir(directory)).toHaveLength(1);
    } else {
      await expect(operation).rejects.toMatchObject({ code: SHARED_LIBRARY_ERROR_CODES.PUBLISH_FAILED });
      expect(await readdir(directory)).toEqual([]);
    }
  });
});
