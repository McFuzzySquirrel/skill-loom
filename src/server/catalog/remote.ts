import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  opendir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { frontmatterString, parseSkillFrontmatter } from './frontmatter.js';
import {
  RemoteSkillSourceSchema,
  type RemoteSkillSource,
} from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import {
  createRemoteCloneStagingDirectory,
  retainRemoteClone,
} from './remote-clones.js';

export const REMOTE_SOURCE_LIMITS = {
  cloneTimeoutMs: 120_000,
  commandTimeoutMs: 15_000,
  maxCommandOutputBytes: 2 * 1024 * 1024,
  maxFiles: 2_000,
  maxPackages: 100,
  maxAgents: 100,
  maxPackageBytes: 20 * 1024 * 1024,
  maxStagingBytes: 128 * 1024 * 1024,
  maxStagingEntries: 10_000,
} as const;

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
    files: z.number().int().min(1).max(REMOTE_SOURCE_LIMITS.maxFiles),
    bytes: z.number().int().min(1).max(REMOTE_SOURCE_LIMITS.maxPackageBytes),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })).max(REMOTE_SOURCE_LIMITS.maxPackages),
  agents: z.array(z.strictObject({
    harness: z.enum(['opencode', 'copilot']),
    name: z.string().min(1).max(255),
    description: z.string().max(4_096),
    repositoryPath: z.string().min(1).max(4_096),
    agentPath: z.string().min(1).max(4_096),
    directory: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().min(1).max(REMOTE_SOURCE_LIMITS.maxPackageBytes),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(['available', 'disabled', 'invalid', 'unsupported']),
    statusReason: z.string().max(256).nullable(),
  })).max(REMOTE_SOURCE_LIMITS.maxAgents).default([]),
});

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
}

export const REMOTE_SOURCE_ERROR_CODES = {
  INVALID: 'REMOTE_SOURCE_INVALID',
  NOT_FOUND: 'REMOTE_SOURCE_NOT_FOUND',
  DUPLICATE: 'REMOTE_SOURCE_DUPLICATE',
  CLONE_FAILED: 'REMOTE_SOURCE_CLONE_FAILED',
  TIMEOUT: 'REMOTE_SOURCE_TIMEOUT',
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

export async function listRemoteSkillSources(configStore: ConfigStore): Promise<RemoteSkillSource[]> {
  return (await configStore.get()).remoteSkillSources;
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
}

export async function unregisterRemoteSkillSource(
  configStore: ConfigStore,
  sourceId: string,
): Promise<void> {
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
  const config = await configStore.get();
  const source = config.remoteSkillSources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) {
    throw new RemoteSourceError(
      REMOTE_SOURCE_ERROR_CODES.NOT_FOUND,
      'The configured remote skill source was not found.',
      { sourceId },
    );
  }

  const configDirectory = configStore.getConfigDir();
  const workRoot = await createRemoteCloneStagingDirectory(configDirectory);
  const clonePath = join(workRoot, 'repository');
  const git = options.gitRunner ?? runGit;
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
      REMOTE_SOURCE_LIMITS.cloneTimeoutMs,
      REMOTE_SOURCE_LIMITS.maxCommandOutputBytes,
    );

    if (source.ref !== undefined && isCommit(source.ref)) {
      await git(['-C', clonePath, 'fetch', '--depth=1', 'origin', source.ref], workRoot,
        REMOTE_SOURCE_LIMITS.commandTimeoutMs, REMOTE_SOURCE_LIMITS.maxCommandOutputBytes);
    }

    const revisionResult = await git(
      ['-C', clonePath, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
      workRoot,
      REMOTE_SOURCE_LIMITS.commandTimeoutMs,
      REMOTE_SOURCE_LIMITS.maxCommandOutputBytes,
    ).catch(async () => git(
      ['-C', clonePath, 'rev-parse', '--verify', 'HEAD^{commit}'],
      workRoot,
      REMOTE_SOURCE_LIMITS.commandTimeoutMs,
      REMOTE_SOURCE_LIMITS.maxCommandOutputBytes,
    ));
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
      REMOTE_SOURCE_LIMITS.commandTimeoutMs,
      REMOTE_SOURCE_LIMITS.maxCommandOutputBytes,
    );
    const files = parseTree(outputText(tree.stdout));
    const packages = findSkillPackages(files);
    const agents = findNativeAgentFiles(files);
    if (packages.length > REMOTE_SOURCE_LIMITS.maxPackages ||
        agents.length > REMOTE_SOURCE_LIMITS.maxAgents) {
      throw tooLarge(sourceId);
    }

    const snapshotRoot = await ensureSnapshotRoot(configDirectory, sourceId, revision);
    const temporarySnapshot = join(dirname(snapshotRoot), `.${revision}.${randomUUID()}.tmp`);
    await mkdir(temporarySnapshot, { recursive: false, mode: 0o700 });
    try {
      const packageManifests: RemoteSkillSnapshot['packages'] = [];
      const agentManifests: RemoteNativeAgent[] = [];
      let totalFiles = 0;
      let totalBytes = 0;
      for (const packagePath of packages) {
        const packageFiles = files.filter((file) =>
          file.path.startsWith(packagePath === '.' ? '' : `${packagePath}/`),
        );
        totalFiles += packageFiles.length;
        if (totalFiles > REMOTE_SOURCE_LIMITS.maxFiles) throw tooLarge(sourceId);

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
          const content = await git(
            ['-C', clonePath, 'cat-file', 'blob', file.object],
            workRoot,
            REMOTE_SOURCE_LIMITS.commandTimeoutMs,
            REMOTE_SOURCE_LIMITS.maxPackageBytes,
          );
          const bytes = outputBuffer(content.stdout);
          packageBytes += bytes.byteLength;
          totalBytes += bytes.byteLength;
          if (packageBytes > REMOTE_SOURCE_LIMITS.maxPackageBytes ||
              totalBytes > REMOTE_SOURCE_LIMITS.maxPackageBytes) {
            throw tooLarge(sourceId);
          }
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
      if (totalFiles > REMOTE_SOURCE_LIMITS.maxFiles) throw tooLarge(sourceId);
      for (const file of agents) {
        if (file.mode !== '100644') throw invalidPackage(sourceId, file.repositoryPath);
        const contentResult = await git(
          ['-C', clonePath, 'cat-file', 'blob', file.object],
          workRoot,
          REMOTE_SOURCE_LIMITS.commandTimeoutMs,
          REMOTE_SOURCE_LIMITS.maxPackageBytes,
        );
        const content = outputBuffer(contentResult.stdout);
        totalBytes += content.byteLength;
        if (totalBytes > REMOTE_SOURCE_LIMITS.maxPackageBytes) throw tooLarge(sourceId);
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
      await mkdir(dirname(snapshotRoot), { recursive: true, mode: 0o700 });
      try {
        await rename(temporarySnapshot, snapshotRoot);
      } catch (error) {
        if (!isErrno(error, 'EEXIST') && !isErrno(error, 'ENOTEMPTY')) throw error;
        await rm(temporarySnapshot, { recursive: true, force: true });
      }
      const snapshot = await readSnapshot(snapshotRoot);
      await retainRemoteClone(configDirectory, {
        stagingDirectory: workRoot,
        sourceId,
        ...(source.ref === undefined ? {} : { ref: source.ref }),
        revision,
      });
      return snapshot;
    } catch (error) {
      await rm(temporarySnapshot, { recursive: true, force: true });
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
        const content = await readFile(path);
        files += 1;
        bytes += content.byteLength;
        fingerprintFiles.push({
          path: filePath,
          mode: info.mode & 0o111 ? 'x' : '-',
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
    const content = await readFile(agentPath);
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

async function readSnapshot(root: string): Promise<RemoteSkillSnapshot> {
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) {
      throw new Error('unsafe');
    }
    return snapshotManifestSchema.parse(
      JSON.parse(await readFile(join(root, 'snapshot.json'), 'utf8')) as unknown,
    );
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

function tooLarge(sourceId: string): RemoteSourceError {
  return new RemoteSourceError(
    REMOTE_SOURCE_ERROR_CODES.TOO_LARGE,
    'The remote repository exceeds the configured skill snapshot limits.',
    { sourceId },
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
): Promise<{ stdout: string | Buffer }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let finished = false;
    let tooLarge = false;
    let monitorError: unknown;
    let timer: NodeJS.Timeout | undefined;

    const child = execFileCallback(
      'git',
      args,
      {
        cwd,
        encoding: 'buffer',
        timeout,
        maxBuffer: maxOutputBytes,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout) => {
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        if (monitorError !== undefined) {
          rejectPromise(monitorError);
          return;
        }
        if (tooLarge) {
          rejectPromise(tooLargeError());
          return;
        }
        if (error !== null) {
          const code = isRecord(error) ? error.code : undefined;
          if (code === 'ETIMEDOUT' || code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            rejectPromise(new RemoteSourceError(
              code === 'ETIMEDOUT' ? REMOTE_SOURCE_ERROR_CODES.TIMEOUT : REMOTE_SOURCE_ERROR_CODES.TOO_LARGE,
              code === 'ETIMEDOUT'
                ? 'The Git operation timed out; check repository access and retry.'
                : 'The Git operation exceeded its output limit.',
            ));
            return;
          }
          rejectPromise(new RemoteSourceError(
            REMOTE_SOURCE_ERROR_CODES.CLONE_FAILED,
            'The Git operation failed. Check the repository URL, ref, authentication, and network access.',
          ));
          return;
        }
        resolvePromise({ stdout });
      },
    );

    const monitorStaging = async (): Promise<void> => {
      try {
        if (await exceedsStagingLimits(cwd)) {
          tooLarge = true;
          child.kill('SIGTERM');
        }
      } catch (error) {
        monitorError = error;
        child.kill('SIGTERM');
      }
      if (!finished) timer = setTimeout(() => void monitorStaging(), 250);
    };
    timer = setTimeout(() => void monitorStaging(), 250);
  });
}

async function exceedsStagingLimits(root: string): Promise<boolean> {
  const pending = [root];
  let entries = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      entries += 1;
      if (entries > REMOTE_SOURCE_LIMITS.maxStagingEntries) return true;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        bytes += (await lstat(path)).size;
        if (bytes > REMOTE_SOURCE_LIMITS.maxStagingBytes) return true;
      }
    }
  }
  return false;
}

function tooLargeError(): RemoteSourceError {
  return new RemoteSourceError(
    REMOTE_SOURCE_ERROR_CODES.TOO_LARGE,
    'The remote repository exceeds the configured skill snapshot limits.',
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
