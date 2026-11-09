import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { frontmatterString, parseSkillFrontmatter } from './frontmatter.js';
import { createGitBlobReader, GitBatchError } from './git-batch.js';
import { MAX_SNAPSHOT_INDEX_BYTES, readSnapshotIndex, SnapshotIndexTooLarge, writeSnapshotIndex } from './snapshot-index.js';
import { exceedsStagingLimits, type StagingLimit } from './staging-limits.js';
import {
  REMOTE_CATALOG_DEFAULT_LIMITS,
  REMOTE_CATALOG_HARD_LIMITS,
  RemoteCatalogLimitOverridesSchema,
  RemoteCatalogLimitsSchema,
  RemoteSkillSourceSchema,
  type RemoteCatalogLimits,
  type RemoteSkillSource,
} from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';

export const REMOTE_SOURCE_LIMITS = REMOTE_CATALOG_DEFAULT_LIMITS;

const snapshotManifestSchema = z.strictObject({
  version: z.literal(1),
  sourceId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  repository: z.string().min(1).max(2_048),
  revision: z.string().regex(/^[a-f0-9]{40,64}$/),
  packages: z.array(z.strictObject({
    name: z.string().min(1).max(255),
    description: z.string().max(4_096),
    repositoryPath: z.string().min(1).max(4_096),
    directory: z.string().regex(/^[a-f0-9]{64}$/),
    files: z.number().int().min(1).max(REMOTE_CATALOG_HARD_LIMITS.maxFiles),
    bytes: z.number().int().min(1).max(REMOTE_CATALOG_HARD_LIMITS.maxPackageBytes),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })).max(REMOTE_CATALOG_HARD_LIMITS.maxPackages),
  agents: z.array(z.strictObject({
    harness: z.enum(['opencode', 'copilot']),
    name: z.string().min(1).max(255),
    description: z.string().max(4_096),
    repositoryPath: z.string().min(1).max(4_096),
    agentPath: z.string().min(1).max(4_096),
    directory: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().min(1).max(REMOTE_CATALOG_HARD_LIMITS.maxPackageBytes),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(['available', 'disabled', 'invalid', 'unsupported']),
    statusReason: z.string().max(256).nullable(),
  })).max(REMOTE_CATALOG_HARD_LIMITS.maxAgents).default([]),
});
const MAX_SNAPSHOT_MANIFEST_BYTES = 256 * 1024 * 1024;

export type RemoteSkillSnapshot = z.infer<typeof snapshotManifestSchema>;
export type RemoteNativeAgent = RemoteSkillSnapshot['agents'][number];

export type RemoteSourceGitRunner = (
  args: string[],
  cwd: string,
  timeoutMs: number,
  maxOutputBytes?: number,
) => Promise<{ stdout: string | Buffer }>;

export interface RemoteSourceOptions {
  /** Test seam; production always uses shell-free `git` execution. */
  gitRunner?: RemoteSourceGitRunner;
  /** Staging root seam for isolated tests. */
  temporaryDirectory?: string;
  /** Cancel work before snapshot publication. */
  signal?: AbortSignal;
}

export const REMOTE_SOURCE_ERROR_CODES = {
  INVALID: 'REMOTE_SOURCE_INVALID',
  NOT_FOUND: 'REMOTE_SOURCE_NOT_FOUND',
  DUPLICATE: 'REMOTE_SOURCE_DUPLICATE',
  CLONE_FAILED: 'REMOTE_SOURCE_CLONE_FAILED',
  TIMEOUT: 'REMOTE_SOURCE_TIMEOUT',
  CANCELLED: 'REMOTE_SOURCE_CANCELLED',
  TOO_LARGE: 'REMOTE_SOURCE_TOO_LARGE',
  INVALID_PACKAGE: 'REMOTE_SOURCE_INVALID_PACKAGE',
  SNAPSHOT_CORRUPT: 'REMOTE_SOURCE_SNAPSHOT_CORRUPT',
} as const;

export class RemoteSourceError extends Error {
  constructor(
    readonly code: (typeof REMOTE_SOURCE_ERROR_CODES)[keyof typeof REMOTE_SOURCE_ERROR_CODES],
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

const sourceQueues = new Map<string, Promise<void>>();

function withSourceLock<T>(configStore: ConfigStore, sourceId: string, operation: () => Promise<T>): Promise<T> {
  const key = `${resolve(configStore.getConfigDir())}\0${sourceId}`;
  const previous = sourceQueues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  sourceQueues.set(key, settled);
  void settled.then(() => {
    if (sourceQueues.get(key) === settled) sourceQueues.delete(key);
  });
  return result;
}

export async function listRemoteSkillSources(configStore: ConfigStore): Promise<RemoteSkillSource[]> {
  return (await configStore.get()).remoteSkillSources;
}

export async function getRemoteCatalogSettings(configStore: ConfigStore) {
  return {
    global: (await configStore.get()).remoteCatalogLimits,
    defaults: REMOTE_CATALOG_DEFAULT_LIMITS,
    maximums: REMOTE_CATALOG_HARD_LIMITS,
  };
}

export async function setRemoteCatalogLimits(configStore: ConfigStore, raw: unknown) {
  const parsed = RemoteCatalogLimitOverridesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.INVALID, 'The remote catalog limits are not valid.');
  }
  await configStore.update({ remoteCatalogLimits: parsed.data });
  return getRemoteCatalogSettings(configStore);
}

export async function setRemoteSourceLimits(configStore: ConfigStore, sourceId: string, raw: unknown) {
  const parsed = RemoteCatalogLimitOverridesSchema.nullable().safeParse(raw);
  if (!parsed.success) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.INVALID, 'The remote source limits are not valid.');
  }
  return withSourceLock(configStore, sourceId, async () => {
    const config = await configStore.update((current) => {
      if (!current.remoteSkillSources.some((source) => source.id === sourceId)) {
        throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.NOT_FOUND, 'The configured remote skill source was not found.');
      }
      return {
        remoteSkillSources: current.remoteSkillSources.map((source) => {
          if (source.id !== sourceId) return source;
          const { limits: _limits, ...rest } = source;
          return parsed.data === null ? rest : { ...rest, limits: parsed.data };
        }),
      };
    });
    const source = config.remoteSkillSources.find((candidate) => candidate.id === sourceId);
    if (source === undefined) {
      throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.NOT_FOUND, 'The configured remote skill source was not found.');
    }
    return source;
  });
}

export async function registerRemoteSkillSource(
  configStore: ConfigStore,
  input: { repository: string; ref?: string },
): Promise<RemoteSkillSource> {
  const parsed = RemoteSkillSourceSchema.safeParse({
    id: `git-${createHash('sha256')
      .update(input.repository.trim())
      .update('\0')
      .update(input.ref?.trim() ?? '')
      .digest('hex')
      .slice(0, 20)}`,
    repository: input.repository,
    ...(input.ref === undefined ? {} : { ref: input.ref }),
  });
  if (!parsed.success) {
    throw new RemoteSourceError(
      REMOTE_SOURCE_ERROR_CODES.INVALID,
      'The repository URL or ref is invalid. Use HTTPS or SSH without embedded credentials.',
    );
  }

  return withSourceLock(configStore, parsed.data.id, async () => {
    let duplicate = false;
    await configStore.update((current) => {
      duplicate = current.remoteSkillSources.some((source) =>
        source.repository === parsed.data.repository && source.ref === parsed.data.ref,
      );
      if (duplicate) return {};
      return { remoteSkillSources: [...current.remoteSkillSources, parsed.data] };
    });
    if (duplicate) {
      throw new RemoteSourceError(
        REMOTE_SOURCE_ERROR_CODES.DUPLICATE,
        'That repository and ref are already registered.',
        { sourceId: parsed.data.id },
      );
    }
    return parsed.data;
  });
}

export async function unregisterRemoteSkillSource(
  configStore: ConfigStore,
  sourceId: string,
): Promise<void> {
  return withSourceLock(configStore, sourceId, async () => {
    let removed = false;
    await configStore.update((current) => {
      const remaining = current.remoteSkillSources.filter((source) => source.id !== sourceId);
      removed = remaining.length !== current.remoteSkillSources.length;
      return removed ? { remoteSkillSources: remaining } : {};
    });
    if (!removed) {
      throw new RemoteSourceError(
        REMOTE_SOURCE_ERROR_CODES.NOT_FOUND,
        'The configured remote skill source was not found.',
        { sourceId },
      );
    }
  });
}

/**
 * Fetch a pinned repository snapshot without checking out or executing repository
 * files. Only regular files belonging to discovered SKILL.md packages are kept.
 */
export async function refreshRemoteSkillSource(
  configStore: ConfigStore,
  sourceId: string,
  options: RemoteSourceOptions = {},
): Promise<RemoteSkillSnapshot> {
  const cancelled = (): RemoteSourceError => new RemoteSourceError(
    REMOTE_SOURCE_ERROR_CODES.CANCELLED, 'The remote catalog refresh was cancelled.', { sourceId },
  );
  if (options.signal?.aborted) throw cancelled();
  let started = false;
  const result = withSourceLock(configStore, sourceId, () => {
    started = true;
    return refreshRemoteSkillSourceUnlocked(configStore, sourceId, options);
  });
  const signal = options.signal;
  if (signal === undefined) return result;
  return new Promise<RemoteSkillSnapshot>((resolve, reject) => {
    const onAbort = (): void => {
      if (!started) {
        signal.removeEventListener('abort', onAbort);
        reject(cancelled());
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void result.then(
      (snapshot) => { signal.removeEventListener('abort', onAbort); resolve(snapshot); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

async function refreshRemoteSkillSourceUnlocked(
  configStore: ConfigStore,
  sourceId: string,
  options: RemoteSourceOptions,
): Promise<RemoteSkillSnapshot> {
  const checkCancelled = (): void => {
    if (options.signal?.aborted) {
      throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.CANCELLED, 'The remote catalog refresh was cancelled.', { sourceId });
    }
  };
  checkCancelled();
  const config = await configStore.get();
  const source = config.remoteSkillSources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) {
    throw new RemoteSourceError(
      REMOTE_SOURCE_ERROR_CODES.NOT_FOUND,
      'The configured remote skill source was not found.',
      { sourceId },
    );
  }
  const limits = RemoteCatalogLimitsSchema.parse({
    ...config.remoteCatalogLimits,
    ...Object.fromEntries(Object.entries(source.limits ?? {}).filter(([, value]) => value !== undefined)),
  });

  const workRoot = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'skill-loom-source-'));
  const clonePath = join(workRoot, 'repository');
  const git: RemoteSourceGitRunner = async (args, cwd, timeoutMs, maxOutputBytes) => {
    try {
      checkCancelled();
      const result = options.gitRunner === undefined
        ? await runGit(args, cwd, timeoutMs, maxOutputBytes, limits, options.signal)
        : await options.gitRunner(args, cwd, timeoutMs, maxOutputBytes);
      checkCancelled();
      return result;
    } catch (error) {
      if (!(error instanceof RemoteSourceError)) throw error;
      throw new RemoteSourceError(error.code, error.message, { ...error.details, sourceId });
    }
  };
  try {
    await git(
      [
        'clone',
        '--no-checkout',
        '--depth=1',
        '--filter=blob:none',
        '--no-tags',
        ...(source.ref === undefined || isCommit(source.ref) ? [] : [`--branch=${source.ref}`]),
        '--',
        source.repository,
        clonePath,
      ],
      workRoot,
      limits.cloneTimeoutMs,
      limits.maxCommandOutputBytes,
    );

    if (source.ref !== undefined && isCommit(source.ref)) {
      await git(['-C', clonePath, 'fetch', '--depth=1', 'origin', source.ref], workRoot,
        limits.commandTimeoutMs, limits.maxCommandOutputBytes);
    }

    const revisionResult = await git(
      ['-C', clonePath, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
      workRoot,
      limits.commandTimeoutMs,
      limits.maxCommandOutputBytes,
    ).catch(async (error: unknown) => {
      checkCancelled();
      if (error instanceof RemoteSourceError && error.code !== REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED) throw error;
      return git(
        ['-C', clonePath, 'rev-parse', '--verify', 'HEAD^{commit}'],
        workRoot,
        limits.commandTimeoutMs,
        limits.maxCommandOutputBytes,
      );
    });
    checkCancelled();
    const revision = outputText(revisionResult.stdout).trim();
    if (!/^[a-f0-9]{40,64}$/.test(revision)) {
      throw new RemoteSourceError(
        REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED,
        'Git did not resolve the remote source to a valid commit.',
        { sourceId },
      );
    }

    const tree = await git(
      ['-C', clonePath, 'ls-tree', '-rz', '--full-tree', revision],
      workRoot,
      limits.commandTimeoutMs,
      limits.maxCommandOutputBytes,
    );
    const files = parseTree(decodeTreeOutput(tree.stdout, sourceId));
    const packages = findSkillPackages(files);
    const agents = findNativeAgentFiles(files);
    if (packages.length > limits.maxPackages) throw tooLarge(sourceId, 'maxPackages', limits.maxPackages);
    if (agents.length > limits.maxAgents) throw tooLarge(sourceId, 'maxAgents', limits.maxAgents);
    const indexedPackages = indexPackageFiles(files, packages, sourceId, limits.maxFiles);
    checkCancelled();

    const snapshotRoot = await ensureSnapshotRoot(configStore.getConfigDir(), sourceId, revision);
    const temporarySnapshot = join(dirname(snapshotRoot), `.${revision}.${randomUUID()}.tmp`);
    await mkdir(temporarySnapshot, { recursive: false, mode: 0o700 });
    const blobReader = options.gitRunner === undefined
      ? createGitBlobReader({
          repository: clonePath,
          cwd: workRoot,
          timeoutMs: limits.commandTimeoutMs,
          maxStderrBytes: limits.maxCommandOutputBytes,
          exceedsStagingLimits: () => exceedsStagingLimits(workRoot, limits),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
      : undefined;
    const readBlob = async (object: string, packageBytes: number, snapshotBytes: number): Promise<Buffer> => {
      checkCancelled();
      if (blobReader === undefined) {
        const content = await git(
          ['-C', clonePath, 'cat-file', 'blob', object],
          workRoot,
          limits.commandTimeoutMs,
          limits.maxPackageBytes,
        );
        return outputBuffer(content.stdout);
      }
      const packageRemaining = limits.maxPackageBytes - packageBytes;
      const snapshotRemaining = limits.maxSnapshotBytes - snapshotBytes;
      try {
        return await blobReader.read(object, Math.min(packageRemaining, snapshotRemaining));
      } catch (error) {
        if (!(error instanceof GitBatchError)) throw error;
        if (error.code === 'CANCELLED') checkCancelled();
        if (error.code === 'TOO_LARGE' && 'bytes' in error.details) {
          const dimension = packageRemaining <= snapshotRemaining ? 'maxPackageBytes' : 'maxSnapshotBytes';
          throw tooLarge(sourceId, dimension, limits[dimension]);
        }
        throw new RemoteSourceError(
          error.code === 'TIMEOUT' ? REMOTE_SOURCE_ERROR_CODES.TIMEOUT :
            error.code === 'TOO_LARGE' ? REMOTE_SOURCE_ERROR_CODES.TOO_LARGE : REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED,
          error.message,
          { sourceId, ...error.details },
        );
      }
    };
    try {
      const packageManifests: RemoteSkillSnapshot['packages'] = [];
      const agentManifests: RemoteNativeAgent[] = [];
      let totalFiles = indexedPackages.totalFiles;
      let totalBytes = 0;
      for (const packagePath of packages) {
        checkCancelled();
        const packageFiles = indexedPackages.files.get(packagePath)!;

        const skillFile = packageFiles.find((file) =>
          file.path === (packagePath === '.' ? 'SKILL.md' : `${packagePath}/SKILL.md`),
        );
        if (skillFile === undefined) continue;

        const packageDirectory = createHash('sha256').update(packagePath).digest('hex');
        const destination = join(temporarySnapshot, 'packages', packageDirectory);
        await mkdir(destination, { recursive: true, mode: 0o700 });
        const fingerprint = createHash('sha256');
        const fingerprintFiles: Array<{ path: string; mode: string; content: Buffer }> = [];
        let packageBytes = 0;
        let skillText = '';

        for (const file of packageFiles) {
          if (file.mode === '120000' || file.mode !== '100644' && file.mode !== '100755') {
            throw invalidPackage(sourceId, packagePath);
          }
          const packageRelative = packagePath === '.' ? file.path : file.path.slice(packagePath.length + 1);
          validateRelativePackagePath(packageRelative, sourceId, packagePath);
          const bytes = await readBlob(file.object, packageBytes, totalBytes);
          packageBytes += bytes.byteLength;
          totalBytes += bytes.byteLength;
          if (packageBytes > limits.maxPackageBytes) throw tooLarge(sourceId, 'maxPackageBytes', limits.maxPackageBytes);
          if (totalBytes > limits.maxSnapshotBytes) throw tooLarge(sourceId, 'maxSnapshotBytes', limits.maxSnapshotBytes);
          fingerprintFiles.push({
            path: packageRelative,
            mode: file.mode === '100755' ? 'x' : '-',
            content: bytes,
          });
          const target = join(destination, ...packageRelative.split('/'));
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await writeFile(target, bytes, { flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644 });
          if (file.mode === '100755') await chmod(target, 0o755);
          if (file.path === skillFile.path) skillText = bytes.toString('utf8');
        }

        for (const file of fingerprintFiles.sort((a, b) => comparePaths(a.path, b.path))) {
          fingerprint
            .update(file.path)
            .update('\0')
            .update(file.mode)
            .update('\0')
            .update(file.content);
        }
        const metadata = parseSkillFrontmatter(skillText);
        packageManifests.push({
          name: frontmatterString(metadata.data, 'name') ?? basename(packagePath),
          description: frontmatterString(metadata.data, 'description') ?? '',
          repositoryPath: packagePath,
          directory: packageDirectory,
          files: packageFiles.length,
          bytes: packageBytes,
          fingerprint: fingerprint.digest('hex'),
        });
      }

      totalFiles += agents.length;
      if (totalFiles > limits.maxFiles) throw tooLarge(sourceId, 'maxFiles', limits.maxFiles);
      for (const file of agents) {
        checkCancelled();
        if (file.mode !== '100644') throw invalidPackage(sourceId, file.repositoryPath);
        const content = await readBlob(file.object, 0, totalBytes);
        if (content.byteLength > limits.maxPackageBytes) {
          throw tooLarge(sourceId, 'maxPackageBytes', limits.maxPackageBytes);
        }
        totalBytes += content.byteLength;
        if (totalBytes > limits.maxSnapshotBytes) throw tooLarge(sourceId, 'maxSnapshotBytes', limits.maxSnapshotBytes);
        validateRelativePackagePath(file.agentPath, sourceId, file.repositoryPath);
        const inspected = inspectNativeAgent(file, content.toString('utf8'));
        const directory = createHash('sha256')
          .update(file.harness)
          .update('\0')
          .update(file.repositoryPath)
          .digest('hex');
        const destination = join(temporarySnapshot, 'agents', directory);
        await mkdir(destination, { recursive: true, mode: 0o700 });
        await writeFile(join(destination, 'agent.md'), content, { flag: 'wx', mode: 0o600 });
        agentManifests.push({
          ...inspected,
          directory,
          bytes: content.byteLength,
          fingerprint: createHash('sha256').update(content).digest('hex'),
        });
      }

      try {
        await blobReader?.close();
      } catch (error) {
        if (!(error instanceof GitBatchError)) throw error;
        if (error.code === 'CANCELLED') checkCancelled();
        throw new RemoteSourceError(
          error.code === 'TIMEOUT' ? REMOTE_SOURCE_ERROR_CODES.TIMEOUT :
            error.code === 'TOO_LARGE' ? REMOTE_SOURCE_ERROR_CODES.TOO_LARGE : REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED,
          error.message,
          { sourceId, ...error.details },
        );
      }
      const stagingExceeded = await exceedsStagingLimits(workRoot, limits);
      if (stagingExceeded !== null) {
        throw tooLarge(sourceId, stagingExceeded.dimension, stagingExceeded.limit);
      }
      const manifest = snapshotManifestSchema.parse({
        version: 1,
        sourceId,
        repository: source.repository,
        revision,
        packages: packageManifests,
        agents: agentManifests,
      });
      await writeFile(
        join(temporarySnapshot, 'snapshot.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      try {
        await writeSnapshotIndex(temporarySnapshot, manifest);
      } catch (error) {
        if (error instanceof SnapshotIndexTooLarge) {
          throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.TOO_LARGE, error.message, {
            sourceId, dimension: 'snapshotIndexBytes', limit: MAX_SNAPSHOT_INDEX_BYTES,
          });
        }
        throw error;
      }
      await mkdir(dirname(snapshotRoot), { recursive: true, mode: 0o700 });
      checkCancelled();
      try {
        await rename(temporarySnapshot, snapshotRoot);
      } catch (error) {
        if (!isErrno(error, 'EEXIST') && !isErrno(error, 'ENOTEMPTY')) throw error;
        await rm(temporarySnapshot, { recursive: true, force: true });
      }
      return await readSnapshot(snapshotRoot);
    } catch (error) {
      try {
        await blobReader?.close(true);
      } finally {
        await rm(temporarySnapshot, { recursive: true, force: true });
      }
      throw error;
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

export async function listRemoteSkillSnapshots(
  configDirectory: string,
  sourceId: string,
): Promise<RemoteSkillSnapshot[]> {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceId)) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.NOT_FOUND, 'The remote source id is invalid.');
  }
  const root = join(resolve(configDirectory), 'catalog-sources', sourceId);
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return [];
    throw error;
  }
  const snapshots: RemoteSkillSnapshot[] = [];
  for (const name of names.sort()) {
    if (!/^[a-f0-9]{40,64}$/.test(name)) continue;
    snapshots.push(await readSnapshot(join(root, name)));
  }
  return snapshots;
}

export async function findRemoteSkillSnapshot(
  configDirectory: string,
  sourceId: string,
  revision: string,
): Promise<RemoteSkillSnapshot | undefined> {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceId) || !/^[a-f0-9]{40,64}$/.test(revision)) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.NOT_FOUND, 'The remote source identity is invalid.');
  }
  let configRoot: string;
  try {
    configRoot = await realpath(configDirectory);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
  const root = join(configRoot, 'catalog-sources', sourceId, revision);
  try {
    await lstat(root);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
  const snapshot = await readSnapshot(root);
  if (snapshot.sourceId !== sourceId || snapshot.revision !== revision) throw snapshotCorrupt();
  return snapshot;
}

const snapshotPageSchema = z.strictObject({
  kind: z.enum(['skill', 'agent']),
  search: z.string().trim().max(500).default(''),
  offset: z.number().int().min(0).max(REMOTE_CATALOG_HARD_LIMITS.maxPackages + REMOTE_CATALOG_HARD_LIMITS.maxAgents).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listRemoteSnapshotPage(
  configDirectory: string,
  sourceId: string,
  revision: string,
  raw: unknown,
) {
  const parsed = snapshotPageSchema.safeParse(raw);
  if (!parsed.success || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceId) ||
      !/^[a-f0-9]{40,64}$/.test(revision)) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.INVALID, 'The remote snapshot page request is not valid.');
  }
  const root = join(resolve(configDirectory), 'catalog-sources', sourceId, revision);
  const { kind, offset, limit, search } = parsed.data;
  let indexed;
  try {
    indexed = await readSnapshotIndex(root, sourceId, revision, { kind, offset, limit, search });
  } catch {
    throw snapshotCorrupt('INDEX_INVALID');
  }
  if (indexed !== null && !('stale' in indexed)) {
    const schema = kind === 'skill' ? snapshotManifestSchema.shape.packages : snapshotManifestSchema.shape.agents;
    const parsedItems = schema.safeParse(indexed.items);
    if (!parsedItems.success) throw snapshotCorrupt('INDEX_INVALID');
    const items = parsedItems.data;
    if (indexed.total > (kind === 'skill' ? REMOTE_CATALOG_HARD_LIMITS.maxPackages : REMOTE_CATALOG_HARD_LIMITS.maxAgents) ||
        items.length !== Math.min(limit, Math.max(0, indexed.total - offset))) throw snapshotCorrupt('INDEX_INVALID');
    return {
      sourceId, revision, repository: indexed.repository, kind, search, total: indexed.total, items,
      nextOffset: offset + items.length < indexed.total ? offset + items.length : null,
    };
  }
  const snapshot = await readSnapshot(root);
  if (snapshot.sourceId !== sourceId || snapshot.revision !== revision) throw snapshotCorrupt();
  const needle = search.toLowerCase();
  const entries = (kind === 'skill' ? snapshot.packages : snapshot.agents)
    .filter((entry) => `${entry.name}\n${entry.description}\n${entry.repositoryPath}`.toLowerCase().includes(needle))
    .sort((a, b) => comparePaths(a.name, b.name) ||
      comparePaths(a.repositoryPath, b.repositoryPath) || comparePaths(a.directory, b.directory));
  const items = entries.slice(offset, offset + limit);
  const nextOffset = offset + items.length < entries.length ? offset + items.length : null;
  return {
    sourceId,
    revision,
    repository: snapshot.repository,
    kind,
    search,
    total: entries.length,
    items,
    nextOffset,
    ...(indexed !== null && 'stale' in indexed ? {
      warning: { code: 'REMOTE_SOURCE_INDEX_STALE', message: 'The snapshot index is stale; this page was read from the validated manifest.' },
    } : {}),
  };
}

export async function inspectRemoteSnapshotCandidate(
  configDirectory: string,
  sourceId: string,
  revision: string,
  raw: unknown,
) {
  const parsed = z.strictObject({
    kind: z.enum(['skill', 'agent']),
    repositoryPath: z.string().min(1).max(4096),
  }).safeParse(raw);
  if (!parsed.success || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceId) ||
      !/^[a-f0-9]{40,64}$/.test(revision)) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.INVALID, 'The remote candidate request is not valid.');
  }
  const snapshot = await readSnapshot(join(resolve(configDirectory), 'catalog-sources', sourceId, revision));
  if (snapshot.sourceId !== sourceId || snapshot.revision !== revision) throw snapshotCorrupt();
  const candidates = parsed.data.kind === 'skill' ? snapshot.packages : snapshot.agents;
  const matches = candidates.filter((candidate) => candidate.repositoryPath === parsed.data.repositoryPath);
  if (matches.length === 0) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.NOT_FOUND, 'The candidate is not present in the pinned snapshot.');
  }
  if (matches.length !== 1) throw snapshotCorrupt();
  if (parsed.data.kind === 'skill') {
    const skill = snapshot.packages.find((candidate) => candidate.repositoryPath === parsed.data.repositoryPath);
    if (skill === undefined) throw snapshotCorrupt();
    return {
      sourceId, revision, repository: snapshot.repository, kind: 'skill' as const,
      candidate: skill, path: await resolveSnapshotPackagePath(configDirectory, snapshot, skill),
    };
  }
  const agent = snapshot.agents.find((candidate) => candidate.repositoryPath === parsed.data.repositoryPath);
  if (agent === undefined) throw snapshotCorrupt();
  return {
    sourceId, revision, repository: snapshot.repository, kind: 'agent' as const,
    candidate: agent, path: await resolveSnapshotAgentPath(configDirectory, snapshot, agent),
  };
}

export async function resolveSnapshotPackagePath(
  configDirectory: string,
  snapshot: RemoteSkillSnapshot,
  packageInfo: RemoteSkillSnapshot['packages'][number],
): Promise<string> {
  const parsedSnapshot = snapshotManifestSchema.parse(snapshot);
  const registeredPackage = parsedSnapshot.packages.find((candidate) =>
    candidate.directory === packageInfo.directory &&
    candidate.fingerprint === packageInfo.fingerprint,
  );
  if (registeredPackage === undefined) {
    throw snapshotCorrupt();
  }
  const selectedPackage = registeredPackage;
  try {
    const configRoot = await realpath(configDirectory);
    const sourceRoot = join(configRoot, 'catalog-sources', parsedSnapshot.sourceId);
    const snapshotRoot = join(sourceRoot, parsedSnapshot.revision);
    const packageRoot = join(snapshotRoot, 'packages', selectedPackage.directory);
    for (const directory of [sourceRoot, snapshotRoot, join(snapshotRoot, 'packages'), packageRoot]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
        throw snapshotCorrupt();
      }
    }

    const fingerprint = createHash('sha256');
    const fingerprintFiles: Array<{ path: string; mode: string; content: Buffer }> = [];
    let files = 0;
    let bytes = 0;
    async function walk(directory: string, prefix: string): Promise<void> {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        comparePaths(a.name, b.name))) {
        const path = join(directory, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) throw snapshotCorrupt();
        if (info.isDirectory()) {
          await walk(path, prefix === '' ? entry.name : `${prefix}/${entry.name}`);
          continue;
        }
        if (!info.isFile()) throw snapshotCorrupt();
        const filePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        validateRelativePackagePath(filePath, parsedSnapshot.sourceId, selectedPackage.repositoryPath);
        if (files >= selectedPackage.files) throw snapshotCorrupt('CONTENT_MISMATCH');
        const { content, executable } = await readBoundedSnapshotFile(path, selectedPackage.bytes - bytes);
        files += 1;
        bytes += content.byteLength;
        fingerprintFiles.push({
          path: filePath,
          mode: executable ? 'x' : '-',
          content,
        });
      }
    }
    await walk(packageRoot, '');
    for (const file of fingerprintFiles.sort((a, b) => comparePaths(a.path, b.path))) {
      fingerprint
        .update(file.path)
        .update('\0')
        .update(file.mode)
        .update('\0')
        .update(file.content);
    }
    const actualFingerprint = fingerprint.digest('hex');
    if (files !== selectedPackage.files || bytes !== selectedPackage.bytes ||
        actualFingerprint !== selectedPackage.fingerprint) {
      throw snapshotCorrupt('CONTENT_MISMATCH', {
        files,
        expectedFiles: selectedPackage.files,
        bytes,
        expectedBytes: selectedPackage.bytes,
        fingerprintMatches: actualFingerprint === selectedPackage.fingerprint,
        actualFingerprint,
        expectedFingerprint: selectedPackage.fingerprint,
      });
    }
    return packageRoot;
  } catch (error) {
    if (error instanceof RemoteSourceError) throw error;
    throw snapshotCorrupt();
  }
}

export async function resolveSnapshotAgentPath(
  configDirectory: string,
  snapshot: RemoteSkillSnapshot,
  agent: RemoteNativeAgent,
): Promise<string> {
  const parsedSnapshot = snapshotManifestSchema.parse(snapshot);
  const registeredAgent = parsedSnapshot.agents.find((candidate) =>
    candidate.harness === agent.harness &&
    candidate.directory === agent.directory &&
    candidate.fingerprint === agent.fingerprint &&
    candidate.repositoryPath === agent.repositoryPath,
  );
  if (registeredAgent === undefined) throw snapshotCorrupt();

  try {
    const configRoot = await realpath(configDirectory);
    const sourceRoot = join(configRoot, 'catalog-sources', parsedSnapshot.sourceId);
    const snapshotRoot = join(sourceRoot, parsedSnapshot.revision);
    const agentsRoot = join(snapshotRoot, 'agents');
    const agentRoot = join(agentsRoot, registeredAgent.directory);
    const agentPath = join(agentRoot, 'agent.md');
    for (const directory of [sourceRoot, snapshotRoot, agentsRoot, agentRoot]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
        throw snapshotCorrupt();
      }
    }
    const info = await lstat(agentPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== registeredAgent.bytes) {
      throw snapshotCorrupt();
    }
    const { content } = await readBoundedSnapshotFile(agentPath, registeredAgent.bytes);
    if (content.byteLength !== registeredAgent.bytes) throw snapshotCorrupt();
    const fingerprint = createHash('sha256').update(content).digest('hex');
    if (fingerprint !== registeredAgent.fingerprint) {
      throw snapshotCorrupt('CONTENT_MISMATCH', {
        actualFingerprint: fingerprint,
        expectedFingerprint: registeredAgent.fingerprint,
      });
    }
    return agentPath;
  } catch (error) {
    if (error instanceof RemoteSourceError) throw error;
    throw snapshotCorrupt();
  }
}

async function readBoundedSnapshotFile(path: string, maximumBytes: number): Promise<{ content: Buffer; executable: boolean }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximumBytes) throw snapshotCorrupt('CONTENT_MISMATCH');
    const buffer = Buffer.alloc(info.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (read.bytesRead === 0) break;
      bytes += read.bytesRead;
    }
    if (bytes !== info.size) throw snapshotCorrupt('CONTENT_MISMATCH');
    return { content: buffer.subarray(0, bytes), executable: (info.mode & 0o111) !== 0 };
  } finally {
    await file.close();
  }
}

async function readSnapshot(root: string): Promise<RemoteSkillSnapshot> {
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) {
      throw new Error('unsafe');
    }
    const manifest = join(root, 'snapshot.json');
    const manifestInfo = await lstat(manifest);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > MAX_SNAPSHOT_MANIFEST_BYTES) {
      throw new Error('unsafe');
    }
    const { content } = await readBoundedSnapshotFile(manifest, MAX_SNAPSHOT_MANIFEST_BYTES);
    return snapshotManifestSchema.parse(JSON.parse(content.toString('utf8')) as unknown);
  } catch {
    throw snapshotCorrupt();
  }
}

function snapshotCorrupt(reason = 'INVALID', details: Record<string, unknown> = {}): RemoteSourceError {
  return new RemoteSourceError(
    REMOTE_SOURCE_ERROR_CODES.SNAPSHOT_CORRUPT,
    'A saved remote source snapshot is unavailable or invalid; it was not modified.',
    { reason, ...details },
  );
}

async function ensureSnapshotRoot(configDirectory: string, sourceId: string, revision: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceId) || !/^[a-f0-9]{40,64}$/.test(revision)) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.NOT_FOUND, 'The remote source identity is invalid.');
  }
  const root = resolve(configDirectory);
  const sources = join(root, 'catalog-sources');
  const sourceDirectory = join(sources, sourceId);
  const snapshot = join(sourceDirectory, revision);
  if (relative(root, snapshot).startsWith(`..${sep}`)) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.NOT_FOUND, 'The remote source path is unsafe.');
  }
  await mkdir(sources, { recursive: true, mode: 0o700 });
  await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
  for (const directory of [sources, sourceDirectory]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.NOT_FOUND, 'The remote source storage path is unsafe.');
    }
  }
  return snapshot;
}

interface TreeFile {
  mode: string;
  object: string;
  path: string;
}

interface NativeAgentFile extends TreeFile {
  harness: RemoteNativeAgent['harness'];
  repositoryPath: string;
  agentPath: string;
}

function decodeTreeOutput(output: string | Buffer, sourceId: string): string {
  if (typeof output === 'string') return output;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(output);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new RemoteSourceError(
      REMOTE_SOURCE_ERROR_CODES.INVALID_PACKAGE,
      'The remote tree contains a path that is not valid UTF-8.',
      { sourceId },
    );
  }
}

function parseTree(output: string): TreeFile[] {
  return output.split('\0').filter(Boolean).map((entry) => {
    const match = /^(100644|100755|120000|040000) (?:blob|tree) ([a-f0-9]{40,64})\t(.+)$/.exec(entry);
    if (match === null) {
      throw new RemoteSourceError(
        REMOTE_SOURCE_ERROR_CODES.INVALID_PACKAGE,
        'The remote tree contains an unsupported entry.',
      );
    }
    return { mode: match[1]!, object: match[2]!, path: match[3]! };
  });
}

function findSkillPackages(files: readonly TreeFile[]): string[] {
  const packages = new Set<string>();
  for (const file of files) {
    if (file.mode === '100644' && basename(file.path) === 'SKILL.md') {
      packages.add(dirname(file.path) === '.' ? '.' : dirname(file.path));
    }
  }
  return [...packages].sort();
}

function indexPackageFiles(
  files: readonly TreeFile[],
  packages: readonly string[],
  sourceId: string,
  maxFiles: number,
): { files: Map<string, TreeFile[]>; totalFiles: number } {
  const grouped = new Map(packages.map((path) => [path, [] as TreeFile[]]));
  interface PackageNode {
    children: Map<string, PackageNode>;
    packagePath?: string;
  }
  const root: PackageNode = { children: new Map() };
  for (const path of packages) {
    if (path === '.') continue;
    let node = root;
    for (const segment of path.split('/')) {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = { children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.packagePath = path;
  }
  let totalFiles = 0;
  const add = (path: string, file: TreeFile): void => {
    const entries = grouped.get(path);
    if (entries === undefined) return;
    totalFiles += 1;
    if (totalFiles > maxFiles) throw tooLarge(sourceId, 'maxFiles', maxFiles);
    entries.push(file);
  };
  for (const file of files) {
    add('.', file);
    let node = root;
    let start = 0;
    for (let slash = file.path.indexOf('/'); slash !== -1; slash = file.path.indexOf('/', start)) {
      const child = node.children.get(file.path.slice(start, slash));
      if (child === undefined) break;
      node = child;
      if (node.packagePath !== undefined) add(node.packagePath, file);
      start = slash + 1;
    }
  }
  return { files: grouped, totalFiles };
}

function findNativeAgentFiles(files: readonly TreeFile[]): NativeAgentFile[] {
  const found: NativeAgentFile[] = [];
  for (const file of files) {
    const openCodePrefix = '.opencode/agents/';
    const copilotPrefix = '.github/agents/';
    if (file.path.startsWith(openCodePrefix) && file.path.endsWith('.md')) {
      found.push({
        ...file,
        harness: 'opencode',
        repositoryPath: file.path,
        agentPath: file.path.slice(openCodePrefix.length),
      });
    } else if (file.path.startsWith(copilotPrefix) && file.path.endsWith('.agent.md')) {
      found.push({
        ...file,
        harness: 'copilot',
        repositoryPath: file.path,
        agentPath: file.path.slice(copilotPrefix.length),
      });
    }
  }
  return found.sort((a, b) => comparePaths(a.repositoryPath, b.repositoryPath));
}

function inspectNativeAgent(
  file: NativeAgentFile,
  text: string,
): Pick<
  RemoteNativeAgent,
  'harness' | 'name' | 'description' | 'repositoryPath' | 'agentPath' | 'status' | 'statusReason'
> {
  const fallbackName = file.harness === 'opencode'
    ? file.agentPath.slice(0, -'.md'.length)
    : basename(file.agentPath, '.agent.md');
  try {
    const metadata = parseSkillFrontmatter(text);
    const declaredName = frontmatterString(metadata.data, 'name');
    const name = file.harness === 'opencode' ? fallbackName : declaredName ?? fallbackName;
    const description = frontmatterString(metadata.data, 'description') ?? '';
    const disabled = metadata.data.disabled === true || metadata.data.hidden === true;
    const mode = frontmatterString(metadata.data, 'mode');
    const status = disabled
      ? 'disabled'
      : file.harness === 'opencode' && mode !== undefined && mode !== 'primary' && mode !== 'all'
        ? 'unsupported'
        : file.harness === 'copilot' && declaredName === undefined
          ? 'invalid'
          : 'available';
    const statusReason = status === 'disabled'
      ? 'This definition is hidden or disabled by its native metadata.'
      : status === 'unsupported'
        ? 'Only primary-capable OpenCode agents can be selected for a chain.'
        : status === 'invalid'
          ? 'A Copilot agent definition requires a name in its frontmatter.'
          : null;
    return {
      harness: file.harness,
      name,
      description,
      repositoryPath: file.repositoryPath,
      agentPath: file.agentPath,
      status,
      statusReason,
    };
  } catch {
    return {
      harness: file.harness,
      name: fallbackName,
      description: '',
      repositoryPath: file.repositoryPath,
      agentPath: file.agentPath,
      status: 'invalid',
      statusReason: 'The agent frontmatter is invalid.',
    };
  }
}

function validateRelativePackagePath(path: string, sourceId: string, packagePath: string): void {
  if (
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) =>
      part === '' ||
      part === '.' ||
      part === '..' ||
      /[. ]$/.test(part) ||
      /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i.test(part) ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw invalidPackage(sourceId, packagePath);
  }
}

function invalidPackage(sourceId: string, packagePath: string): RemoteSourceError {
  return new RemoteSourceError(
    REMOTE_SOURCE_ERROR_CODES.INVALID_PACKAGE,
    'A remote skill package contains an unsafe path or unsupported file type.',
    { sourceId, packagePath },
  );
}

function tooLarge(sourceId: string, dimension: keyof RemoteCatalogLimits, limit: number): RemoteSourceError {
  return new RemoteSourceError(
    REMOTE_SOURCE_ERROR_CODES.TOO_LARGE,
    `The remote repository exceeds the ${dimension} limit (${String(limit)}). Adjust the catalog limits or narrow the source.`,
    { sourceId, dimension, limit },
  );
}

function isCommit(ref: string): boolean {
  return /^[a-f0-9]{40,64}$/i.test(ref);
}

async function runGit(
  args: string[],
  cwd: string,
  timeout: number = REMOTE_SOURCE_LIMITS.commandTimeoutMs,
  maxOutputBytes: number = REMOTE_SOURCE_LIMITS.maxCommandOutputBytes,
  limits: RemoteCatalogLimits = REMOTE_SOURCE_LIMITS,
  signal?: AbortSignal,
): Promise<{ stdout: string | Buffer }> {
  if (signal?.aborted) {
    throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.CANCELLED, 'The remote catalog refresh was cancelled.');
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let finished = false;
    let stagingLimit: StagingLimit | null = null;
    let monitorError: unknown;
    let timer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let escalation: NodeJS.Timeout | undefined;
    let monitorPromise: Promise<void> | undefined;
    let timedOut = false;
    let outputExceeded = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;

    let processError: unknown;
    const stdout: Buffer[] = [];
    const child = spawn('git', args, {
      cwd,
      detached: process.platform !== 'win32',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.once('error', (error) => {
      processError = error;
    });
    child.once('close', (code, signal) => {
        finished = true;
        abortSignal?.removeEventListener('abort', cancel);
        if (timer !== undefined) clearTimeout(timer);
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        if (escalation !== undefined) {
          clearTimeout(escalation);
          signalProcess('SIGKILL');
        }
        void (async () => {
          await monitorPromise;
          if (monitorError !== undefined) throw monitorError;
          const exceeded = stagingLimit ?? await exceedsStagingLimits(cwd, limits);
          if (exceeded !== null) throw tooLargeError(exceeded);
          if (cancelled) {
            throw new RemoteSourceError(REMOTE_SOURCE_ERROR_CODES.CANCELLED, 'The remote catalog refresh was cancelled.');
          }
          if (outputExceeded || timedOut) {
            throw new RemoteSourceError(
              outputExceeded ? REMOTE_SOURCE_ERROR_CODES.TOO_LARGE : REMOTE_SOURCE_ERROR_CODES.TIMEOUT,
              outputExceeded
                ? `The Git operation exceeded the maxCommandOutputBytes limit (${String(maxOutputBytes)}). Adjust the catalog limits or narrow the source.`
                : 'The Git operation timed out; check repository access and retry.',
              outputExceeded ? { dimension: 'maxCommandOutputBytes', limit: maxOutputBytes } : {},
            );
          }
          if (processError !== undefined || code !== 0 || signal !== null) {
            throw new RemoteSourceError(
              REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED,
              'The Git operation failed. Check the repository URL, ref, authentication, and network access.',
            );
          }
          return { stdout: Buffer.concat(stdout) };
        })().then(resolvePromise, rejectPromise);
    });

    const signalProcess = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid !== undefined) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        if (!isErrno(error, 'ESRCH')) {
          monitorError ??= new RemoteSourceError(
            REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED,
            'The Git process could not be terminated safely.',
          );
        }
      }
    };
    const terminate = (): void => {
      signalProcess('SIGTERM');
      if (escalation === undefined) {
        escalation = setTimeout(() => signalProcess('SIGKILL'), 1_000);
        escalation.unref();
      }
    };
    const abortSignal = signal;
    let cancelled = false;
    const cancel = (): void => {
      cancelled = true;
      terminate();
    };
    abortSignal?.addEventListener('abort', cancel, { once: true });
    if (abortSignal?.aborted) cancel();
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes && !outputExceeded) {
        outputExceeded = true;
        terminate();
      }
      if (!outputExceeded) stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxOutputBytes && !outputExceeded) {
        outputExceeded = true;
        terminate();
      }
    });

    const monitorStaging = async (): Promise<void> => {
      try {
        const exceeded = await exceedsStagingLimits(cwd, limits);
        if (exceeded !== null) {
          stagingLimit = exceeded;
          if (!finished) terminate();
        }
      } catch (error) {
        monitorError = error;
        if (!finished) terminate();
      }
      if (!finished) timer = setTimeout(runMonitor, 250);
    };
    const runMonitor = (): void => {
      monitorPromise = monitorStaging();
    };
    timer = setTimeout(runMonitor, 250);
  });
}

function tooLargeError(exceeded: StagingLimit): RemoteSourceError {
  return new RemoteSourceError(
    REMOTE_SOURCE_ERROR_CODES.TOO_LARGE,
    `The Git staging directory exceeds the ${exceeded.dimension} limit (${String(exceeded.limit)}).`,
    { ...exceeded },
  );
}

function outputText(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8');
}

function outputBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
