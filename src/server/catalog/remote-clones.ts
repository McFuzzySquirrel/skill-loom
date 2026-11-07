import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const cloneRecordSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(/^[a-f0-9-]{36}$/),
  sourceId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  ref: z.string().max(255).nullable(),
  revision: z.string().regex(/^[a-f0-9]{40,64}$/),
  createdAt: z.string().datetime(),
});

export type RetainedRemoteClone = z.infer<typeof cloneRecordSchema> & {
  path: string;
};

const CLONE_DIRECTORY_NAME = 'catalog-clones';
const RECORD_NAME = 'retained-clone.json';

export function remoteCloneRootFor(configDirectory: string): string {
  return join(resolve(configDirectory), CLONE_DIRECTORY_NAME);
}

export async function createRemoteCloneStagingDirectory(
  configDirectory: string,
): Promise<string> {
  const root = await ensureCloneRoot(configDirectory);
  return await mkdtemp(join(root, '.refresh-'));
}

export async function retainRemoteClone(
  configDirectory: string,
  input: {
    stagingDirectory: string;
    sourceId: string;
    ref?: string;
    revision: string;
  },
): Promise<RetainedRemoteClone> {
  const root = await ensureCloneRoot(configDirectory);
  const stagingDirectory = resolve(input.stagingDirectory);
  assertContained(root, stagingDirectory);
  const stagingInfo = await lstat(stagingDirectory);
  if (!stagingInfo.isDirectory() || stagingInfo.isSymbolicLink() ||
      await realpath(stagingDirectory) !== stagingDirectory) {
    throw new Error('Remote clone staging directory is unsafe.');
  }
  const repositoryPath = join(stagingDirectory, 'repository');
  await assertRepository(repositoryPath);

  const record = cloneRecordSchema.parse({
    version: 1,
    id: randomUUID(),
    sourceId: input.sourceId,
    ref: input.ref ?? null,
    revision: input.revision,
    createdAt: new Date().toISOString(),
  });
  await writeFile(join(stagingDirectory, RECORD_NAME), `${JSON.stringify(record, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  const retainedDirectory = join(root, `clone-${record.id}`);
  await rename(stagingDirectory, retainedDirectory);
  return { ...record, path: join(retainedDirectory, 'repository') };
}

export async function listRetainedRemoteClones(
  configDirectory: string,
): Promise<RetainedRemoteClone[]> {
  const root = await ensureCloneRoot(configDirectory);
  const entries = await readdir(root, { withFileTypes: true });
  const clones: RetainedRemoteClone[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.name.startsWith('clone-')) continue;
    const directory = join(root, entry.name);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        await realpath(directory) !== directory) {
      throw new Error(`Retained remote clone ownership path is unsafe: ${directory}`);
    }
    const raw: unknown = JSON.parse(await readFile(join(directory, RECORD_NAME), 'utf8'));
    const record = cloneRecordSchema.parse(raw);
    if (entry.name !== `clone-${record.id}`) {
      throw new Error(`Retained remote clone record does not match its directory: ${directory}`);
    }
    const path = join(directory, 'repository');
    await assertRepository(path);
    clones.push({ ...record, path });
  }
  return clones;
}

export async function removeRetainedRemoteClones(
  configDirectory: string,
): Promise<void> {
  const root = await ensureCloneRoot(configDirectory);
  const clones = await listRetainedRemoteClones(configDirectory);
  for (const clone of clones) {
    const directory = resolve(clone.path, '..');
    assertContained(root, directory);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        await realpath(directory) !== directory) {
      throw new Error(`Retained remote clone ownership path changed before deletion: ${directory}`);
    }
    await assertRepository(clone.path);
    await rm(directory, { recursive: true });
  }
}

export async function resolveRetainedRemoteCloneShutdown(
  configDirectory: string,
  options: {
    interactive: boolean;
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
  },
): Promise<void> {
  const clones = await listRetainedRemoteClones(configDirectory);
  if (clones.length === 0) return;

  options.output.write(`Retained ${clones.length} remote Git clone(s):\n`);
  for (const clone of clones) {
    options.output.write(
      `- ${clone.path} (source ${clone.sourceId}, ref ${clone.ref ?? 'default'}, revision ${clone.revision})\n`,
    );
  }
  if (!options.interactive) {
    options.output.write('They were kept; stop Skill Loom before removing these listed directories manually.\n');
    return;
  }

  const prompt = createInterface({ input: options.input, output: options.output });
  let answer = '';
  try {
    answer = await prompt.question('Delete these retained clones? [y/N] ');
  } catch {
    options.output.write('No shutdown choice was received; the clones were kept.\n');
  } finally {
    prompt.close();
  }
  if (answer.trim().toLowerCase() !== 'y') {
    options.output.write('Kept the retained remote clones.\n');
    return;
  }
  await removeRetainedRemoteClones(configDirectory);
  options.output.write('Deleted the retained remote clones. Pinned snapshots and saved work were not changed.\n');
}

async function ensureCloneRoot(configDirectory: string): Promise<string> {
  const configRoot = resolve(configDirectory);
  await mkdir(configRoot, { recursive: true, mode: 0o700 });
  const canonicalConfigRoot = await realpath(configRoot);
  const configInfo = await lstat(canonicalConfigRoot);
  if (!configInfo.isDirectory()) {
    throw new Error('Remote clone storage config path is not a directory.');
  }
  const root = remoteCloneRootFor(canonicalConfigRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() ||
      (rootInfo.mode & 0o077) !== 0) {
    throw new Error('Remote clone storage path is unsafe.');
  }
  if (await realpath(root) !== root) throw new Error('Remote clone storage path is unsafe.');
  return root;
}

async function assertRepository(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error(`Retained remote clone is not a real repository directory: ${path}`);
  }
  const gitDirectory = join(path, '.git');
  let gitInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    gitInfo = await lstat(gitDirectory);
  } catch (error) {
    throw new Error(`Retained remote clone has no safe Git metadata directory: ${path}`, {
      cause: error,
    });
  }
  if (!gitInfo.isDirectory() || gitInfo.isSymbolicLink() ||
      await realpath(gitDirectory) !== gitDirectory) {
    throw new Error(`Retained remote clone has no safe Git metadata directory: ${path}`);
  }
}

function assertContained(root: string, candidate: string): void {
  const path = relative(root, candidate);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Remote clone path is outside its managed root: ${basename(candidate)}`);
  }
}
