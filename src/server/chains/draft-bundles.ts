import { constants } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { Chain } from './model.js';
import { parseBundle } from '../../portable/bundle.js';
import type { ChainBundleV1 } from '../../shared/bundles.js';
import { atomicWriteJson } from '../config/store.js';

const DRAFT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DRAFT_PACKAGE_DIRECTORY = 'draft-packages';
const MAX_STORED_BUNDLE_BYTES = 32 * 1024 * 1024;
const StoredDraftBundleSchema = z.strictObject({
  version: z.literal(1),
  draftId: z.string().regex(DRAFT_ID_PATTERN),
  bundle: z.unknown(),
});

export class DraftBundleStoreError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export async function saveDraftBundle(
  configDirectory: string,
  draftId: string,
  chain: Chain,
  rawBundle: unknown,
): Promise<void> {
  const bundle = parseDraftBundle(rawBundle, draftId, chain);
  const root = await ensureDraftPackageRoot(configDirectory);
  await atomicWriteJson(join(root, `${draftId}.json`), {
    version: 1,
    draftId,
    bundle,
  });
}

export async function readDraftBundle(
  configDirectory: string,
  draftId: string,
): Promise<ChainBundleV1 | null> {
  assertDraftId(draftId);
  const root = await ensureDraftPackageRoot(configDirectory);
  const path = join(root, `${draftId}.json`);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw new DraftBundleStoreError('The saved draft package bundle could not be opened safely.', {
      cause: error,
    });
  }
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > MAX_STORED_BUNDLE_BYTES ||
      await realpath(path) !== path
    ) {
      throw new DraftBundleStoreError('The saved draft package bundle path is unsafe or too large.');
    }
    const contents = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(contents, 0, contents.length, 0);
    if (bytesRead !== info.size) {
      throw new DraftBundleStoreError('The saved draft package bundle changed while being read.');
    }
    const raw: unknown = JSON.parse(contents.subarray(0, bytesRead).toString('utf8'));
    const stored = StoredDraftBundleSchema.safeParse(raw);
    if (!stored.success || stored.data.draftId !== draftId) {
      throw new DraftBundleStoreError('The saved draft package bundle is invalid.');
    }
    const bundle = parseBundle(stored.data.bundle);
    if (bundle.version !== 1) {
      throw new DraftBundleStoreError('Saved draft packages must use a version 1 bundle.');
    }
    return bundle;
  } catch (error) {
    if (error instanceof DraftBundleStoreError) throw error;
    throw new DraftBundleStoreError('The saved draft package bundle could not be read.', {
      cause: error,
    });
  } finally {
    await handle.close();
  }
}

export async function removeDraftBundle(
  configDirectory: string,
  draftId: string,
): Promise<void> {
  assertDraftId(draftId);
  const root = await ensureDraftPackageRoot(configDirectory);
  const path = join(root, `${draftId}.json`);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
      throw new DraftBundleStoreError('The saved draft package bundle path is unsafe.');
    }
    await rm(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return;
    if (error instanceof DraftBundleStoreError) throw error;
    throw new DraftBundleStoreError('The saved draft package bundle could not be removed.', {
      cause: error,
    });
  }
}

export function updateDraftBundleChain(
  bundle: ChainBundleV1,
  chain: Chain,
): ChainBundleV1 {
  return {
    ...bundle,
    chain: {
      name: chain.name,
      harness: chain.harness,
      sessionMode: chain.sessionMode,
      steps: chain.steps,
      inputs: inputsWithoutDefaults(chain.inputs),
    },
  };
}

export function draftBundleMatchesChain(bundle: ChainBundleV1, chain: Chain): boolean {
  return bundle.chain.name === chain.name &&
    bundle.chain.harness === chain.harness &&
    bundle.chain.sessionMode === chain.sessionMode &&
    isDeepStrictEqual(bundle.chain.steps, chain.steps) &&
    isDeepStrictEqual(
      inputsWithoutDefaults(bundle.chain.inputs),
      inputsWithoutDefaults(chain.inputs),
    );
}

function inputsWithoutDefaults(inputs: Chain['inputs']): Chain['inputs'] {
  return inputs.map(({ defaultValue: _defaultValue, ...input }) => input);
}

function parseDraftBundle(raw: unknown, draftId: string, chain: Chain): ChainBundleV1 {
  assertDraftId(draftId);
  let bundle;
  try {
    bundle = parseBundle(raw);
  } catch (error) {
    throw new DraftBundleStoreError('The discovery proposal is not a valid Skill Loom bundle.', {
      cause: error,
    });
  }
  if (bundle.version !== 1 || !draftBundleMatchesChain(bundle, chain)) {
    throw new DraftBundleStoreError(
      'The discovery proposal does not match the saved global draft.',
    );
  }
  return bundle;
}

async function ensureDraftPackageRoot(configDirectory: string): Promise<string> {
  const configRoot = resolve(configDirectory);
  await mkdir(configRoot, { recursive: true, mode: 0o700 });
  const canonicalConfigRoot = await realpath(configRoot);
  const configInfo = await lstat(canonicalConfigRoot);
  if (!configInfo.isDirectory()) {
    throw new DraftBundleStoreError('The global configuration path is not a directory.');
  }
  const root = join(canonicalConfigRoot, DRAFT_PACKAGE_DIRECTORY);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    await realpath(root) !== root
  ) {
    throw new DraftBundleStoreError('The saved draft package directory is unsafe.');
  }
  return root;
}

function assertDraftId(draftId: string): void {
  if (!DRAFT_ID_PATTERN.test(draftId)) {
    throw new DraftBundleStoreError('The global draft id is invalid.');
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    error.code === code;
}
