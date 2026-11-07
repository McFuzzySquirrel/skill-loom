import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChainBundle } from '../../src/shared/bundles.js';
import { createConfigStore } from '../../src/server/config/store.js';
import {
  createSharedLibrary,
  SHARED_LIBRARY_ERROR_CODES,
  SharedLibraryError,
} from '../../src/server/bundles/shared-library.js';

let root: string;
let directory: string;
const bundle: ChainBundle = {
  format: 'skill-loom-chain',
  version: 1,
  chain: {
    name: 'Shared review',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [{ id: 'review', kind: 'instruction', instruction: 'Review {{task}}.' }],
    inputs: [{ name: 'task', required: true }],
  },
  skills: [],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-shared-library-'));
  directory = join(root, 'shared');
  await mkdir(directory);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function createLibrary() {
  const configStore = createConfigStore({
    env: { LOOM_CONFIG_DIR: join(root, 'config') },
    homeDirectory: () => join(root, 'home'),
  });
  return { configStore, library: createSharedLibrary(configStore) };
}

describe('shared bundle library', () => {
  it('publishes immutable bundles with atomic no-overwrite names and scans them', async () => {
    const { library } = createLibrary();
    await library.configure(directory);
    const [first, second] = await Promise.all([
      library.publish(bundle, 'Shared review'),
      library.publish(bundle, 'Shared review'),
    ]);

    expect(first.id).not.toBe(second.id);
    expect(first.filename).toMatch(/^shared-review-[a-f0-9-]+\.loom\.json$/);
    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    expect(files.every((filename) => filename.endsWith('.loom.json'))).toBe(true);

    const listed = await library.list();
    expect(listed.entries).toHaveLength(2);
    expect(listed.entries.every((entry) => entry.status === 'available')).toBe(true);
    expect((await library.read(first.id)).chain.name).toBe('Shared review');
    const content = await readFile(join(directory, first.filename), 'utf8');
    expect(JSON.parse(content)).toMatchObject({ format: 'skill-loom-chain', version: 1 });
  });

  it('reports corrupt and linked files instead of following or hiding them', async () => {
    const { library } = createLibrary();
    await library.configure(directory);
    await writeFile(join(directory, 'broken.loom.json'), '{');
    const external = join(root, 'external.loom.json');
    await writeFile(external, JSON.stringify(bundle));
    await symlink(external, join(directory, 'linked.loom.json'));

    const listed = await library.list();
    expect(listed.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'broken', status: 'invalid' }),
      expect.objectContaining({ id: 'linked', status: 'unsafe' }),
    ]));
    await expect(library.read('linked')).rejects.toMatchObject({
      code: SHARED_LIBRARY_ERROR_CODES.BUNDLE_INVALID,
    });
  });

  it('requires configuration and rejects an invalid configured directory', async () => {
    const { library } = createLibrary();
    await expect(library.publish(bundle, 'Review')).rejects.toMatchObject({
      code: SHARED_LIBRARY_ERROR_CODES.NOT_CONFIGURED,
    } satisfies Partial<SharedLibraryError>);
    await expect(library.configure(join(root, 'missing'))).rejects.toMatchObject({
      code: SHARED_LIBRARY_ERROR_CODES.DIRECTORY_INVALID,
    });
  });
});
