import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { syncDirectory } from '../shared/sync-directory.js';
import { BundleError, MAX_BUNDLE_FILES, validatePackagePath } from './bundle.js';

const MAX_METADATA_BYTES = 2 * 1024 * 1024;
export const InstalledModeIndexSchema = z.strictObject({
  version: z.literal(1),
  installationId: z.uuid(),
  packagePath: z.string().max(512),
  files: z.array(z.strictObject({
    path: z.string().min(1).max(512),
    executable: z.boolean(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1).max(MAX_BUNDLE_FILES),
});
export type InstalledModeIndex = z.infer<typeof InstalledModeIndexSchema>;

export type InstalledModeReceipt = { registryPath: string; content: string };

function unsafe(): never {
  throw new BundleError(
    'BUNDLE_SOURCE_UNAVAILABLE',
    'Installed executable-mode metadata is missing, unsafe, or changed. Restore the complete reviewed package before retrying.',
  );
}

function paths(directory: string) {
  if (basename(dirname(directory)) !== 'skills' || basename(dirname(dirname(directory))) !== '.agents') unsafe();
  const project = resolve(directory, '../../..');
  const packagePath = relative(project, directory).split(sep).join('/');
  const key = createHash('sha256').update(packagePath).digest('hex');
  return {
    project, packagePath, metadata: join(directory, '.loom'),
    registry: join(project, '.loom', 'package-modes'),
    key: `${key}.json`,
  };
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) unsafe();
}

async function readMetadata(path: string): Promise<string | null> {
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(MAX_METADATA_BYTES)) unsafe();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    if (info.dev !== before.dev || info.ino !== before.ino || !info.isFile() || info.size !== before.size) unsafe();
    const data = Buffer.alloc(Number(info.size) + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    if (offset !== Number(info.size) || after.size !== info.size || after.mtimeNs !== info.mtimeNs ||
        after.ctimeNs !== info.ctimeNs || current.dev !== info.dev || current.ino !== info.ino ||
        current.isSymbolicLink() || current.nlink !== 1n) unsafe();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, offset));
    } catch {
      unsafe();
    }
  } finally {
    await handle.close();
  }
}

async function publishNew(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.modes-${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, path);
  } finally {
    await unlink(temporary);
  }
}

/** Reserve non-overwriting mode records before publishing any SKILL.md entry. */
export async function writeInstalledModeIndex(
  directory: string,
  files: ReadonlyArray<{ path: string; content: Uint8Array; executable: boolean }>,
): Promise<InstalledModeReceipt> {
  const location = paths(directory);
  const document = InstalledModeIndexSchema.parse({
    version: 1,
    installationId: randomUUID(),
    packagePath: location.packagePath,
    files: files.map((file) => ({
      path: file.path, executable: file.executable,
      sha256: createHash('sha256').update(file.content).digest('hex'),
    })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  });
  for (const file of document.files) validatePackagePath(file.path);
  if (new Set(document.files.map((file) => file.path.toLowerCase())).size !== files.length) unsafe();
  const text = `${JSON.stringify(document)}\n`;
  if (Buffer.byteLength(text) > MAX_METADATA_BYTES) unsafe();
  await ensureDirectory(join(location.project, '.loom'));
  await ensureDirectory(location.registry);
  await ensureDirectory(location.metadata);
  // The registry survives deletion of the package-local metadata directory.
  const receipt = { registryPath: join(location.registry, location.key), content: text };
  await publishNew(receipt.registryPath, text);
  try {
    await publishNew(join(location.metadata, 'installed-modes.json'), text);
    await syncDirectory(location.registry);
    await syncDirectory(location.metadata);
    await syncDirectory(join(location.project, '.loom'));
    await syncDirectory(directory);
    await syncDirectory(location.project);
  } catch (error) {
    await discardInstalledModeIndex(receipt);
    throw error;
  }
  return receipt;
}

/** Only an installer that created the registry entry may roll it back. */
export async function discardInstalledModeIndex(receipt: InstalledModeReceipt): Promise<void> {
  const parent = dirname(receipt.registryPath);
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) unsafe();
  const current = await readMetadata(receipt.registryPath);
  if (current === null) return;
  if (current !== receipt.content) unsafe();
  await unlink(receipt.registryPath);
  await syncDirectory(dirname(receipt.registryPath));
}

/** Read both copies; neither missing metadata nor a partial install is repaired. */
export async function readInstalledModeIndex(directory: string): Promise<InstalledModeIndex | null> {
  if (basename(dirname(directory)) !== 'skills' || basename(dirname(dirname(directory))) !== '.agents') return null;
  const location = paths(directory);
  for (const parent of [join(location.project, '.loom'), location.registry, location.metadata]) {
    try {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) unsafe();
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  const [local, registered] = await Promise.all([
    readMetadata(join(location.metadata, 'installed-modes.json')),
    readMetadata(join(location.registry, location.key)),
  ]);
  if (local === null && registered === null) {
    try {
      await lstat(location.metadata);
      unsafe();
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (process.platform === 'win32') {
      try {
        await lstat(join(directory, 'SKILL.md'));
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
      unsafe();
    }
    return null;
  }
  if (local === null || registered === null || local !== registered) unsafe();
  for await (const entry of await opendir(location.metadata)) {
    if (entry.name !== 'installed-modes.json') unsafe();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(local) as unknown;
  } catch {
    unsafe();
  }
  const result = InstalledModeIndexSchema.safeParse(raw);
  if (!result.success || result.data.packagePath !== location.packagePath) unsafe();
  const seen = new Set<string>();
  for (const file of result.data.files) {
    validatePackagePath(file.path);
    const key = file.path.toLowerCase();
    if (seen.has(key)) unsafe();
    seen.add(key);
  }
  return result.data;
}

// Original hashes are install receipts; subsequent reviews bind current bytes to path intent.
export function installedExecutableFlag(
  index: InstalledModeIndex,
  path: string,
  physicalExecutable: boolean,
): boolean {
  const file = index.files.find((file) => file.path === path);
  if (file === undefined ||
      (process.platform !== 'win32' && file.executable !== physicalExecutable)) unsafe();
  return file.executable;
}
