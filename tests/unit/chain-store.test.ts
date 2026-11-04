import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_VERSION, type Chain } from '../../src/server/chains/model.js';
import {
  CHAINS_DIRECTORY_NAME,
  CHAIN_STORE_ERROR_CODES,
  CHAIN_STORE_WARNING_CODES,
  ChainStoreError,
  atomicWriteChainJson,
  chainsDirectoryFor,
  createChainStore,
  isSafeChainId,
  type ChainStore,
} from '../../src/server/chains/store.js';

const CREATED_AT = '2026-11-04T10:00:00.000Z';

let root: string;
let projectPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slan-chain-store-'));
  projectPath = join(root, 'project');
  await mkdir(projectPath);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeChain(overrides: Record<string, unknown> = {}): Chain {
  return {
    version: CHAIN_VERSION,
    id: 'chain-alpha',
    name: 'Alpha chain',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      {
        id: 'step-1',
        skillName: 'brainstorm',
        instruction: 'Plan the task for {{task}}.',
      },
    ],
    inputs: [{ name: 'task', required: true }],
    automaticPermissionOptIn: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  } as unknown as Chain;
}

function storeFor(overrides: Partial<Parameters<typeof createChainStore>[0]> = {}): ChainStore {
  return createChainStore({ projectPath, ...overrides });
}

function chainDirectory(): string {
  return join(projectPath, '.slan', CHAINS_DIRECTORY_NAME);
}

function chainFile(chainId: string): string {
  return join(chainDirectory(), `${chainId}.json`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function temporaryFiles(directory: string): Promise<string[]> {
  const names = await readdir(directory);
  return names.filter((name) => name.endsWith('.tmp'));
}

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to reject.');
}

async function expectChainError(
  operation: Promise<unknown>,
  code: string,
): Promise<ChainStoreError> {
  const captured = await captureError(operation);
  expect(captured).toBeInstanceOf(ChainStoreError);
  const error = captured as ChainStoreError;
  expect(error.code).toBe(code);
  return error;
}

describe('chain storage layout', () => {
  it('creates .slan/chains on demand and writes only inside the project directory', async () => {
    const store = storeFor();

    const created = await store.create(makeChain());

    expect(created).toEqual(makeChain());
    expect(chainsDirectoryFor(projectPath)).toBe(chainDirectory());
    expect(await fileExists(chainDirectory())).toBe(true);
    expect(await fileExists(chainFile('chain-alpha'))).toBe(true);
    expect(await readdir(join(projectPath, '.slan'))).toEqual([CHAINS_DIRECTORY_NAME]);

    const onDisk = JSON.parse(await readFile(chainFile('chain-alpha'), 'utf8')) as Chain;
    expect(onDisk).toEqual(makeChain());
    expect((await stat(chainFile('chain-alpha'))).mode & 0o777).toBe(0o600);
    expect(await temporaryFiles(chainDirectory())).toEqual([]);
  });

  it('does not create .slan when reading or listing a project with no chains', async () => {
    const store = storeFor();

    await expectChainError(store.read('chain-missing'), CHAIN_STORE_ERROR_CODES.NOT_FOUND);
    expect(await fileExists(join(projectPath, '.slan'))).toBe(false);

    expect(await store.list()).toEqual({ chains: [], warnings: [] });
    expect(await fileExists(join(projectPath, '.slan'))).toBe(false);
  });
});

describe('create, read, update, and delete', () => {
  it('round-trips a chain by id and rejects a duplicate create without overwriting', async () => {
    const store = storeFor();
    const original = makeChain();
    await store.create(original);

    expect(await store.read(original.id)).toEqual(original);

    const duplicateError = await expectChainError(
      store.create(makeChain({ name: 'Replacement name' })),
      CHAIN_STORE_ERROR_CODES.ALREADY_EXISTS,
    );
    expect(duplicateError.details).toMatchObject({
      chainId: original.id,
      path: chainFile(original.id),
    });
    expect(await store.read(original.id)).toEqual(original);
  });

  it('replaces an existing chain document and preserves the new content', async () => {
    const store = storeFor();
    await store.create(makeChain());

    const updated = makeChain({
      name: 'Renamed chain',
      updatedAt: '2026-11-04T12:30:00.000Z',
    });
    await store.update(updated);

    expect(await store.read(updated.id)).toEqual(updated);
    expect(JSON.parse(await readFile(chainFile(updated.id), 'utf8'))).toEqual(updated);
    expect(await temporaryFiles(chainDirectory())).toEqual([]);
  });

  it('returns CHAIN_NOT_FOUND for a missing read or update', async () => {
    const store = storeFor();

    const readError = await expectChainError(
      store.read('chain-missing'),
      CHAIN_STORE_ERROR_CODES.NOT_FOUND,
    );
    expect(readError.details.chainId).toBe('chain-missing');

    await expectChainError(
      store.update(makeChain({ id: 'chain-missing' })),
      CHAIN_STORE_ERROR_CODES.NOT_FOUND,
    );
  });

  it('deletes only the requested chain', async () => {
    const store = storeFor();
    await store.create(makeChain({ id: 'chain-alpha' }));
    await store.create(makeChain({ id: 'chain-bravo' }));

    await store.delete('chain-alpha');

    expect(await fileExists(chainFile('chain-alpha'))).toBe(false);
    expect(await fileExists(chainFile('chain-bravo'))).toBe(true);
    await expectChainError(store.read('chain-alpha'), CHAIN_STORE_ERROR_CODES.NOT_FOUND);
    expect((await store.list()).chains.map((chain) => chain.id)).toEqual(['chain-bravo']);
  });
});

describe('listing', () => {
  it('orders valid chains by updatedAt descending', async () => {
    const store = storeFor();
    await store.create(
      makeChain({ id: 'chain-oldest', updatedAt: '2026-11-04T10:00:00.000Z' }),
    );
    await store.create(
      makeChain({ id: 'chain-newest', updatedAt: '2026-11-04T12:00:00.000Z' }),
    );
    await store.create(
      makeChain({ id: 'chain-middle', updatedAt: '2026-11-04T11:00:00.000Z' }),
    );

    const listed = await store.list();

    expect(listed.warnings).toEqual([]);
    expect(listed.chains.map((chain) => chain.id)).toEqual([
      'chain-newest',
      'chain-middle',
      'chain-oldest',
    ]);
  });

  it('reports corrupt, invalid, and unsupported files as warnings while keeping valid chains', async () => {
    const store = storeFor();
    await store.create(makeChain({ id: 'chain-valid' }));

    const brokenPath = chainFile('broken');
    const brokenBytes = '{"version":1,"id":"broken"';
    await writeFile(brokenPath, brokenBytes, 'utf8');

    const invalidPath = chainFile('invalid');
    await writeFile(
      invalidPath,
      JSON.stringify({
        version: CHAIN_VERSION,
        id: 'invalid',
        name: '',
        harness: 'opencode',
        sessionMode: 'shared',
        steps: [],
        inputs: [],
        automaticPermissionOptIn: false,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
      'utf8',
    );

    const futurePath = chainFile('future');
    await writeFile(
      futurePath,
      JSON.stringify(makeChain({ id: 'future', version: CHAIN_VERSION + 1 })),
      'utf8',
    );

    const listed = await store.list();

    expect(listed.chains.map((chain) => chain.id)).toEqual(['chain-valid']);
    expect(listed.warnings.map((warning) => warning.code)).toEqual([
      CHAIN_STORE_WARNING_CODES.FILE_CORRUPT,
      CHAIN_STORE_WARNING_CODES.UNSUPPORTED_VERSION,
      CHAIN_STORE_WARNING_CODES.FILE_CORRUPT,
    ]);
    expect(listed.warnings.map((warning) => warning.path)).toEqual([
      brokenPath,
      futurePath,
      invalidPath,
    ]);
    expect(listed.warnings[0]).toMatchObject({ chainId: 'broken', reason: 'INVALID_JSON' });
    expect(listed.warnings[1]).toMatchObject({
      chainId: 'future',
      version: CHAIN_VERSION + 1,
    });
    const invalidWarning = listed.warnings[2];
    expect(invalidWarning?.issues?.length ?? 0).toBeGreaterThan(0);

    // Corrupt files are quarantined, never deleted or rewritten.
    expect(await fileExists(brokenPath)).toBe(true);
    expect(await readFile(brokenPath, 'utf8')).toBe(brokenBytes);
    expect(await fileExists(invalidPath)).toBe(true);
    expect(await fileExists(futurePath)).toBe(true);
  });

  it('reports a filename/id mismatch instead of exposing an ambiguous id', async () => {
    const store = storeFor();
    await store.create(makeChain({ id: 'chain-alpha' }));
    await writeFile(
      chainFile('chain-other'),
      JSON.stringify(makeChain({ id: 'chain-alpha' })),
      'utf8',
    );

    const listed = await store.list();

    expect(listed.chains.map((chain) => chain.id)).toEqual(['chain-alpha']);
    expect(listed.warnings).toEqual([
      expect.objectContaining({
        code: CHAIN_STORE_WARNING_CODES.FILE_ID_MISMATCH,
        chainId: 'chain-other',
      }),
    ]);
  });

  it('ignores non-JSON and temporary files without warnings', async () => {
    const store = storeFor();
    await store.create(makeChain());

    await writeFile(join(chainDirectory(), 'notes.txt'), 'not a chain\n', 'utf8');
    await writeFile(join(chainDirectory(), '.chain-alpha.json.123.tmp'), 'partial', 'utf8');

    const listed = await store.list();

    expect(listed.chains.map((chain) => chain.id)).toEqual(['chain-alpha']);
    expect(listed.warnings).toEqual([]);
  });
});

describe('identifier safety', () => {
  it('rejects traversal and separator ids before any filesystem access', async () => {
    const realpathSpy = vi.fn(async (path: string) => realpath(path));
    const store = createChainStore({ projectPath, realpathPath: realpathSpy });

    const unsafeIds = [
      '../escape',
      '..',
      '.',
      'a/b',
      'a\\b',
      '/absolute',
      'has space',
      'UPPERCASE',
      '%2e%2e%2fescape',
      'nul\0byte',
      'x'.repeat(65),
      '',
    ];

    for (const chainId of unsafeIds) {
      const error = await expectChainError(
        store.read(chainId),
        CHAIN_STORE_ERROR_CODES.ID_INVALID,
      );
      expect(error.details.chainId).toBe(chainId);
    }

    await expectChainError(
      store.create(makeChain({ id: '../escape' })),
      CHAIN_STORE_ERROR_CODES.ID_INVALID,
    );
    await expectChainError(
      store.update(makeChain({ id: 'a/b' })),
      CHAIN_STORE_ERROR_CODES.ID_INVALID,
    );
    await expectChainError(
      store.delete('..\\escape'),
      CHAIN_STORE_ERROR_CODES.ID_INVALID,
    );

    expect(realpathSpy).not.toHaveBeenCalled();
    expect(await fileExists(join(projectPath, '.slan'))).toBe(false);
    expect(await fileExists(join(root, 'escape.json'))).toBe(false);
  });

  it('accepts only lowercase filename-safe ids', () => {
    expect(isSafeChainId('chain-alpha_123')).toBe(true);
    expect(isSafeChainId('0chain')).toBe(true);
    expect(isSafeChainId('Chain')).toBe(false);
    expect(isSafeChainId('../chain')).toBe(false);
    expect(isSafeChainId('')).toBe(false);
    expect(isSafeChainId(42)).toBe(false);
  });
});

describe('atomic replacement', () => {
  it('keeps the previous chain and removes the temporary file when rename fails', async () => {
    const store = storeFor();
    const original = makeChain();
    await store.create(original);
    const originalBytes = await readFile(chainFile(original.id), 'utf8');

    const failingWrite = (target: string, chain: Chain) =>
      atomicWriteChainJson(target, chain, {
        renameFile: async () => {
          throw Object.assign(new Error('simulated rename failure'), { code: 'EIO' });
        },
      });

    const failingStore = createChainStore({
      projectPath,
      atomicWrite: failingWrite,
    });

    const error = await expectChainError(
      failingStore.update(makeChain({ name: 'Changed name' })),
      CHAIN_STORE_ERROR_CODES.WRITE_FAILED,
    );
    expect(error.details).toMatchObject({
      path: chainFile(original.id),
      chainId: original.id,
      reason: 'EIO',
    });

    expect(await readFile(chainFile(original.id), 'utf8')).toBe(originalBytes);
    expect(await failingStore.read(original.id)).toEqual(original);
    expect(await temporaryFiles(chainDirectory())).toEqual([]);
  });

  it('leaves no target at all when a create write fails before rename', async () => {
    const store = createChainStore({
      projectPath,
      atomicWrite: (target, chain) =>
        atomicWriteChainJson(target, chain, {
          renameFile: async () => {
            throw Object.assign(new Error('simulated rename failure'), { code: 'EXDEV' });
          },
        }),
    });

    const error = await expectChainError(
      store.create(makeChain({ id: 'chain-new' })),
      CHAIN_STORE_ERROR_CODES.WRITE_FAILED,
    );
    expect(error.details.reason).toBe('EXDEV');

    expect(await fileExists(chainFile('chain-new'))).toBe(false);
    expect(await temporaryFiles(chainDirectory())).toEqual([]);
    expect(await store.list()).toEqual({ chains: [], warnings: [] });
  });

  it('surfaces a non-atomic cross-device rename as a typed failure', async () => {
    const store = storeFor();
    await store.create(makeChain());

    const error = await expectChainError(
      atomicWriteChainJson(
        chainFile('chain-alpha'),
        makeChain({ name: 'Cross device' }),
        {
          renameFile: async () => {
            throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
          },
        },
      ),
      CHAIN_STORE_ERROR_CODES.WRITE_FAILED,
    );

    expect(error.details.reason).toBe('EXDEV');
    expect(await store.read('chain-alpha')).toEqual(makeChain());
    expect(await temporaryFiles(chainDirectory())).toEqual([]);
  });
});

describe('containment', () => {
  it('rejects a symlinked .slan directory before creating anything outside the project', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(projectPath, '.slan'), 'dir');
    const store = storeFor();

    const listError = await expectChainError(
      store.list(),
      CHAIN_STORE_ERROR_CODES.PATH_ESCAPED,
    );
    expect(listError.details).toMatchObject({ name: '.slan', reason: 'SYMLINK' });

    await expectChainError(
      store.create(makeChain()),
      CHAIN_STORE_ERROR_CODES.PATH_ESCAPED,
    );
    expect(await readdir(outside)).toEqual([]);
  });

  it('rejects a symlinked chains directory', async () => {
    const outside = join(root, 'outside-chains');
    await mkdir(outside);
    await mkdir(join(projectPath, '.slan'));
    await symlink(outside, chainDirectory(), 'dir');
    const store = storeFor();

    await expectChainError(store.list(), CHAIN_STORE_ERROR_CODES.PATH_ESCAPED);
    await expectChainError(store.create(makeChain()), CHAIN_STORE_ERROR_CODES.PATH_ESCAPED);
    expect(await readdir(outside)).toEqual([]);
  });

  it('does not follow a symlinked chain file', async () => {
    const store = storeFor();
    await store.create(makeChain({ id: 'chain-real' }));

    const outside = join(root, 'outside-chain.json');
    await writeFile(outside, JSON.stringify(makeChain({ id: 'chain-link' })), 'utf8');
    await symlink(outside, chainFile('chain-link'));

    await expectChainError(store.read('chain-link'), CHAIN_STORE_ERROR_CODES.PATH_ESCAPED);
    expect((await store.list()).chains.map((chain) => chain.id)).toEqual(['chain-real']);
  });

  it('rejects a project path that is missing without scaffolding it', async () => {
    const store = createChainStore({ projectPath: join(root, 'missing-project') });

    await expectChainError(store.list(), CHAIN_STORE_ERROR_CODES.PROJECT_NOT_FOUND);
    expect(await fileExists(join(root, 'missing-project'))).toBe(false);
  });
});

describe('directory-backed chain store', () => {
  it('creates and lists chains in an explicit directory without a project path', async () => {
    const directory = join(root, 'config', 'chains');
    const store = createChainStore({ chainsDirectory: directory });

    expect(await store.list()).toEqual({ chains: [], warnings: [] });
    expect(await fileExists(directory)).toBe(false);

    const created = await store.create(makeChain({ id: 'template-alpha' }));
    expect(created.id).toBe('template-alpha');
    expect(await fileExists(join(directory, 'template-alpha.json'))).toBe(true);
    expect((await store.list()).chains.map((chain) => chain.id)).toEqual([
      'template-alpha',
    ]);
  });

  it('rejects a relative or symlinked directory root', async () => {
    const relative = createChainStore({ chainsDirectory: 'relative/chains' });
    await expectChainError(relative.list(), CHAIN_STORE_ERROR_CODES.PROJECT_INVALID);

    const outside = join(root, 'outside-root');
    const linked = join(root, 'linked-chains');
    await mkdir(outside);
    await symlink(outside, linked, 'dir');
    const store = createChainStore({ chainsDirectory: linked });
    await expectChainError(store.list(), CHAIN_STORE_ERROR_CODES.PATH_ESCAPED);
  });
});
