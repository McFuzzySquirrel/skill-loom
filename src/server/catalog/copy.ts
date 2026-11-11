import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { publishSkillEntry } from '../../portable/install-skill.js';
import {
  discardInstalledModeIndex, installedExecutableFlag, readInstalledModeIndex, writeInstalledModeIndex,
  type InstalledModeIndex, type InstalledModeReceipt,
} from '../../portable/installed-modes.js';
import { treeFingerprint, type PackageTreeEntry } from '../../portable/runtime.js';
import { readGitExecutablePaths } from '../chains/git-file-modes.js';
import { readBundledSkillModes } from './bundled-modes.js';
import type { ScenarioSkillSource } from '../../shared/presets.js';
import { SHARED_PROJECT_SKILLS_SEGMENTS, sharedProjectSkillRoot } from './project-paths.js';
import { snapshotPackageFingerprint, snapshotReviewFingerprint } from './snapshot-fingerprint.js';
import { REMOTE_SNAPSHOT_CONTENT, type SkillEntry, type SkillHarness } from './types.js';

/**
 * Copy a discovered skill package into the current project.
 *
 * The source is always an entry produced by a fresh server-side discovery
 * pass, never a client path. Only non-project sources can be copied. The copy
 * is bounded and refuses symlinks so a skill package cannot smuggle a link to
 * an arbitrary location into the project.
 */

export const CATALOG_COPY_ERROR_CODES = {
  SOURCE_ALREADY_PROJECT: 'SKILL_ALREADY_IN_PROJECT',
  SOURCE_UNAVAILABLE: 'SKILL_SOURCE_UNAVAILABLE',
  SOURCE_NOT_DIRECTORY: 'SKILL_SOURCE_NOT_DIRECTORY',
  SOURCE_UNSAFE: 'SKILL_SOURCE_UNSAFE',
  DESTINATION_UNAVAILABLE: 'SKILL_DESTINATION_UNAVAILABLE',
  SYMLINK_UNSUPPORTED: 'SKILL_SYMLINK_UNSUPPORTED',
  TOO_LARGE: 'SKILL_PACKAGE_TOO_LARGE',
  COPY_FAILED: 'SKILL_COPY_FAILED',
} as const;

export type CatalogCopyErrorCode =
  (typeof CATALOG_COPY_ERROR_CODES)[keyof typeof CATALOG_COPY_ERROR_CODES];

export class CatalogCopyError extends Error {
  readonly code: CatalogCopyErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: CatalogCopyErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Maximum bytes copied for one skill package. */
export const MAX_SKILL_PACKAGE_BYTES = 10 * 1024 * 1024;
/** Maximum files copied for one skill package. */
export const MAX_SKILL_PACKAGE_FILES = 1_000;
/** Bounded unique-directory attempts when the target name is already used. */
const MAX_NAME_ATTEMPTS = 100;
const MAX_COPY_DEPTH = 32;
const MAX_COPY_ENTRIES = MAX_SKILL_PACKAGE_FILES * (MAX_COPY_DEPTH + 1);

export interface CopySkillIntoProjectInput {
  /** Canonical project directory. */
  projectPath: string;
  /** Harness that reported the catalog entry. */
  harness: SkillHarness;
  /** Entry from the fresh server-side catalog discovery. */
  entry: SkillEntry;
  /**
   * Exact destination directory name. Defaults to a slug of the skill name.
   * The value is slugged again, so callers cannot escape the skill root.
   */
  destinationName?: string;
  /** Whether to suffix the destination if the skill directory already exists. */
  allowNameSuffix?: boolean;
}

export interface CopySkillIntoProjectResult {
  name: string;
  source: SkillEntry['source'];
  destinationPath: string;
  /** Fingerprint of the installed package tree, after publication. */
  fingerprint: string;
}

/** Shared project-local root discovered by both supported harnesses. */
export function projectSkillRootFor(_harness: SkillHarness, projectPath: string): string {
  return sharedProjectSkillRoot(projectPath);
}

export async function copySkillIntoProject(
  input: CopySkillIntoProjectInput,
): Promise<CopySkillIntoProjectResult> {
  return copySkillIntoProjectWithNotice(input);
}

async function copySkillIntoProjectWithNotice(
  input: CopySkillIntoProjectInput,
  notice?: string,
): Promise<CopySkillIntoProjectResult> {
  const { entry, projectPath, harness, destinationName, allowNameSuffix = true } = input;

  const remoteContent = entry[REMOTE_SNAPSHOT_CONTENT];
  if (entry.source === 'remote' && remoteContent === undefined) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
      'The remote package has no verified snapshot fingerprint. Refresh the source and retry.',
      { skillId: entry.id },
    );
  }
  if (process.platform === 'win32' && entry.source === 'remote' &&
      remoteContent?.executablePaths === undefined) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
      'Windows requires verified executable-mode metadata for this remote package. Refresh the source and retry.',
      { skillId: entry.id },
    );
  }

  if (entry.source === 'project') {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_ALREADY_PROJECT,
      'This skill is already part of the current project.',
      { skillId: entry.id, source: entry.source },
    );
  }

  if (entry.packagePath.trim() === '') {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_UNAVAILABLE,
      'The harness did not report a package directory for this skill.',
      { skillId: entry.id, source: entry.source },
    );
  }

  let sourceInfo;
  try {
    sourceInfo = await lstat(entry.packagePath);
  } catch (error) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_UNAVAILABLE,
      'The skill package directory could not be inspected.',
      { skillId: entry.id, reason: errnoCode(error) },
      { cause: error },
    );
  }

  if (sourceInfo.isSymbolicLink()) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SYMLINK_UNSUPPORTED,
      'The skill package path is a symbolic link and was not copied.',
      { path: entry.packagePath, reason: 'SYMLINK' },
    );
  }

  if (!sourceInfo.isDirectory()) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_NOT_DIRECTORY,
      'The skill package path is not a directory.',
      { skillId: entry.id },
    );
  }

  let sourceDirectory: string;
  try {
    sourceDirectory = await realpath(entry.packagePath);
  } catch (error) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_UNAVAILABLE,
      'The skill package directory could not be resolved.',
      { skillId: entry.id, reason: errnoCode(error) },
      { cause: error },
    );
  }

  const destinationRoot = await createProjectSkillRoot(projectPath);

  const destination = await reserveDestination(
    destinationRoot,
    safePackageName(destinationName ?? (entry.name || basename(sourceDirectory))),
    allowNameSuffix,
  );

  const budget: CopyBudget = { files: 0, bytes: 0, entries: 0, skillEntries: [], copiedFiles: [] };
  let modeReceipt: InstalledModeReceipt | undefined;
  let installedFingerprint = '';
  try {
    const sourceModes = await readInstalledModeIndex(sourceDirectory);
    await copyDirectory(sourceDirectory, destination, budget, 0, '', sourceModes);
    if (sourceModes !== null && sourceModes.files.length !== budget.copiedFiles.length) {
      throw new CatalogCopyError(CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE, 'The source package no longer matches its installed-mode inventory.');
    }
    if (!budget.skillEntries.some((item) => item.path === 'SKILL.md')) {
      throw new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
        'The skill package no longer contains its SKILL.md entry.',
        { skillId: entry.id },
      );
    }
    if (notice !== undefined) {
      await writeFile(join(destination, 'SKILL-LOOM-SOURCE.md'), notice, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o644,
      });
    }
    let verifiedFiles: Array<{ path: string; content: Buffer; executable: boolean }> | undefined;
    if (entry.source === 'remote' && remoteContent !== undefined) {
      verifiedFiles = await verifyRemoteCopy(destination, remoteContent, entry.id, budget.skillEntries);
    } else if (process.platform === 'win32') {
      if (sourceModes !== null) {
        verifiedFiles = budget.copiedFiles;
      } else if (entry.source === 'builtin') {
        const recorded = await readBundledSkillModes(entry.name);
        const seen = new Set<string>();
        if (recorded.length !== budget.copiedFiles.length) {
          throw new CatalogCopyError(CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE, 'The bundled package no longer matches its mode manifest.');
        }
        verifiedFiles = budget.copiedFiles.map((file) => {
          const expected = recorded.find((item) => item.path === file.path);
          if (seen.has(file.path) || expected === undefined ||
              expected.sha256 !== createHash('sha256').update(file.content).digest('hex')) {
            throw new CatalogCopyError(CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE, 'The bundled package no longer matches its mode manifest.');
          }
          seen.add(file.path);
          return { ...file, executable: expected.executable };
        });
      } else {
        const executable = await readGitExecutablePaths(sourceDirectory, budget.copiedFiles.map((file) => file.path));
        verifiedFiles = budget.copiedFiles.map((file) => ({ ...file, executable: executable.has(file.path) }));
      }
      if (notice !== undefined) verifiedFiles.push({ path: 'SKILL-LOOM-SOURCE.md', content: Buffer.from(notice), executable: false });
    }
    if (process.platform === 'win32' && verifiedFiles !== undefined) {
      modeReceipt = await writeInstalledModeIndex(destination, verifiedFiles);
    }
    budget.skillEntries.sort((left, right) => right.path.split('/').length - left.path.split('/').length);
    for (const skillEntry of budget.skillEntries) {
      const target = join(destination, ...skillEntry.path.split('/'));
      await publishSkillEntry(dirname(target), skillEntry.content, Number(skillEntry.mode & 0o777n), {
        enforceFileMode: true,
        temporaryRoot: destinationRoot,
      });
    }
    if (verifiedFiles !== undefined) {
      const inventory: PackageTreeEntry[] = [];
      await treeFingerprint(destination, inventory);
      const installedFiles = inventory.filter((item) => item.kind === 'file');
      const expected = new Map(verifiedFiles.map((file) => [file.path, file]));
      if (installedFiles.length !== expected.size || installedFiles.some((file) => {
        const original = expected.get(file.path);
        return original === undefined || original.executable !== file.executable ||
          original.content.length !== file.bytes ||
          createHash('sha256').update(original.content).digest('hex') !== file.fingerprint;
      })) {
        throw new CatalogCopyError(
          CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
          'The installed package changed during publication. Refresh and review it again.',
          { skillId: entry.id },
        );
      }
    }
    installedFingerprint = await treeFingerprint(destination);
  } catch (error) {
    await removePartialCopy(
      destination,
      entry.id,
      'A partial skill package could not be removed after copy failed.',
      error,
      modeReceipt,
    );
    if (error instanceof CatalogCopyError) {
      throw error;
    }
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.COPY_FAILED,
      'The skill package could not be copied into the project.',
      { skillId: entry.id, reason: errnoCode(error) },
      { cause: error },
    );
  }

  async function verifyRemoteCopy(
    root: string,
    snapshot: NonNullable<SkillEntry[typeof REMOTE_SNAPSHOT_CONTENT]>,
    skillId: string,
    skillEntries: Array<{ path: string; content: Buffer; mode: bigint }>,
  ): Promise<Array<{ path: string; content: Buffer; executable: boolean }>> {
    const files: Array<{ path: string; content: Buffer; executable: boolean }> = [];
    const remainingExecutables = snapshot.executablePaths === undefined
      ? undefined : new Set(snapshot.executablePaths);
    let bytes = skillEntries.reduce((total, item) => total + item.content.length, 0);
    let entries = skillEntries.length;
    const unsafe = () => new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
      'The copied remote package differs from the verified snapshot. Refresh and review it again.',
      { skillId },
    );
    async function visit(directory: string, prefix: string, depth: number): Promise<void> {
      const directoryInfo = await lstat(directory);
      if (depth > 32 || !directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw unsafe();
      for await (const entry of await opendir(directory)) {
        entries += 1;
        if (entries > MAX_COPY_ENTRIES) throw unsafe();
        const path = join(directory, entry.name);
        const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        const before = await lstat(path, { bigint: true });
        if (before.isSymbolicLink()) throw unsafe();
        if (before.isDirectory()) {
          await visit(path, relativePath, depth + 1);
          continue;
        }
        if (!before.isFile() || files.length >= MAX_SKILL_PACKAGE_FILES) throw unsafe();
        const { content, mode } = await readCheckedCopyFile(path, MAX_SKILL_PACKAGE_BYTES - bytes, unsafe);
        const executable = (mode & 0o111n) !== 0n;
        const recordedExecutable = remainingExecutables?.delete(relativePath);
        if (recordedExecutable !== undefined && process.platform !== 'win32' &&
            executable !== recordedExecutable) throw unsafe();
        bytes += content.length;
        files.push({ path: relativePath, content, executable: recordedExecutable ?? executable });
      }
    }
    for (const entry of skillEntries) {
      const recordedExecutable = remainingExecutables?.delete(entry.path);
      const executable = (entry.mode & 0o111n) !== 0n;
      if (recordedExecutable !== undefined && process.platform !== 'win32' &&
          executable !== recordedExecutable) throw unsafe();
      files.push({ path: entry.path, content: entry.content, executable: recordedExecutable ?? executable });
    }
    await visit(root, '', 0);
    if ((remainingExecutables?.size ?? 0) !== 0 ||
        snapshotPackageFingerprint(files) !== snapshot.fingerprint ||
        snapshotReviewFingerprint(files) !== snapshot.reviewFingerprint) {
      throw unsafe();
    }
    return files;
  }

  return {
    name: entry.name,
    source: entry.source,
    destinationPath: destination,
    fingerprint: installedFingerprint,
  };
}

async function readCheckedCopyFile(
  path: string,
  limit: number,
  unsafe: () => CatalogCopyError,
): Promise<{ content: Buffer; mode: bigint }> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.ino === 0n || before.size > BigInt(limit)) throw unsafe();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size) {
      throw unsafe();
    }
    const content = Buffer.alloc(Number(info.size) + 1);
    let length = 0;
    while (length < content.length) {
      const result = await handle.read(content, length, content.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    if (length !== Number(info.size) || after.size !== info.size || after.mtimeNs !== info.mtimeNs ||
        after.mode !== info.mode || !current.isFile() || current.isSymbolicLink() ||
        current.dev !== info.dev || current.ino !== info.ino) throw unsafe();
    return { content: content.subarray(0, length), mode: info.mode };
  } finally {
    await handle.close();
  }
}

export async function copyBundledScenarioSkill(
  input: CopySkillIntoProjectInput & { source: ScenarioSkillSource },
): Promise<CopySkillIntoProjectResult> {
  if (
    !input.source.bundled ||
    input.entry.source !== 'builtin' ||
    input.entry.name !== input.source.name
  ) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
      'The bundled skill source does not match the allowlisted package.',
      { skillId: input.entry.id, name: input.entry.name },
    );
  }

  const notice = [
    '# Skill source and attribution',
    '',
    `- Skill: ${input.source.name}`,
    `- Upstream repository: ${input.source.repositoryUrl}`,
    `- Source revision: ${input.source.revision}`,
    `- Upstream skill listing: ${input.source.skillUrl}`,
    `- Upstream skill file: ${input.source.skillFileUrl}`,
    `- Upstream license declaration: ${input.source.license}`,
    '',
    'This package is a pinned snapshot copied by explicit user request. Skill Loom did not execute its scripts or contact the upstream source during this copy.',
    'Upstream files and any license notices supplied with the package are retained. This attribution file was added by Skill Loom.',
    '',
  ].join('\n');

  return copySkillIntoProjectWithNotice({ ...input, allowNameSuffix: false }, notice);
}

async function removePartialCopy(
  destination: string,
  skillId: string,
  message: string,
  cause: unknown,
  modeReceipt?: InstalledModeReceipt,
): Promise<void> {
  try {
    await rm(destination, { recursive: true, force: true });
    if (modeReceipt !== undefined) await discardInstalledModeIndex(modeReceipt);
  } catch (error) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.COPY_FAILED,
      message,
      {
        skillId,
        path: destination,
        copyFailure: errnoCode(cause),
        cleanupFailure: errnoCode(error),
      },
      { cause: error },
    );
  }
}

async function createProjectSkillRoot(projectPath: string): Promise<string> {
  let directory = projectPath;

  for (const segment of SHARED_PROJECT_SKILLS_SEGMENTS) {
    directory = join(directory, segment);
    try {
      await mkdir(directory, { mode: 0o755 });
    } catch (error) {
      if (errnoCode(error) !== 'EEXIST') {
        throw new CatalogCopyError(
          CATALOG_COPY_ERROR_CODES.DESTINATION_UNAVAILABLE,
          'The project skill directory could not be created.',
          { path: directory, reason: errnoCode(error) },
          { cause: error },
        );
      }
    }

    let info;
    try {
      info = await lstat(directory);
    } catch (error) {
      throw new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.DESTINATION_UNAVAILABLE,
        'The project skill directory could not be inspected.',
        { path: directory, reason: errnoCode(error) },
        { cause: error },
      );
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.DESTINATION_UNAVAILABLE,
        'A project skill directory component is not a real directory.',
        { path: directory, reason: info.isSymbolicLink() ? 'SYMLINK' : 'NOT_DIRECTORY' },
      );
    }
  }

  return directory;
}

async function reserveDestination(
  root: string,
  baseName: string,
  allowNameSuffix: boolean,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    if (attempt > 0 && !allowNameSuffix) {
      break;
    }
    const candidate = join(root, attempt === 0 ? baseName : `${baseName}-${String(attempt + 1)}`);
    try {
      await mkdir(candidate, { mode: 0o755 });
      return candidate;
    } catch (error) {
      if (errnoCode(error) !== 'EEXIST') {
        throw new CatalogCopyError(
          CATALOG_COPY_ERROR_CODES.DESTINATION_UNAVAILABLE,
          'A project skill directory could not be created.',
          { path: candidate, reason: errnoCode(error) },
          { cause: error },
        );
      }
      if (!allowNameSuffix) {
        throw new CatalogCopyError(
          CATALOG_COPY_ERROR_CODES.SOURCE_ALREADY_PROJECT,
          'A skill package with this name already exists in the project.',
          { path: candidate, name: baseName },
        );
      }
    }
  }

  if (!allowNameSuffix) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_ALREADY_PROJECT,
      'A skill package with this name already exists in the project.',
      { path: join(root, baseName), name: baseName },
    );
  }

  throw new CatalogCopyError(
    CATALOG_COPY_ERROR_CODES.DESTINATION_UNAVAILABLE,
    'A unique project skill directory name could not be created.',
    { path: root, baseName, attempts: MAX_NAME_ATTEMPTS },
  );
}

interface CopyBudget {
  files: number;
  bytes: number;
  entries: number;
  skillEntries: Array<{ path: string; content: Buffer; mode: bigint }>;
  copiedFiles: Array<{ path: string; content: Buffer; executable: boolean }>;
}

async function copyDirectory(
  source: string,
  destination: string,
  budget: CopyBudget,
  depth = 0,
  prefix = '',
  sourceModes: InstalledModeIndex | null = null,
): Promise<void> {
  const directory = await lstat(source);
  if (!directory.isDirectory() || directory.isSymbolicLink() || await realpath(source) !== source) {
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
      'A skill package directory changed during copying.',
      { path: source },
    );
  }
  if (depth > MAX_COPY_DEPTH) {
    throw new CatalogCopyError(CATALOG_COPY_ERROR_CODES.TOO_LARGE, 'The skill package exceeds the directory depth limit.');
  }
  for await (const entry of await opendir(source)) {
    budget.entries += 1;
    if (budget.entries > MAX_COPY_ENTRIES) {
      throw new CatalogCopyError(CATALOG_COPY_ERROR_CODES.TOO_LARGE, 'The skill package exceeds the entry limit.');
    }
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    const packagePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (prefix === '' && entry.name === '.loom' && sourceModes?.metadataDirectory === join(source, '.loom')) continue;

    if (entry.isSymbolicLink()) {
      throw new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.SYMLINK_UNSUPPORTED,
        'A skill package contains a symbolic link and was not copied.',
        { path: sourcePath, reason: 'SYMLINK' },
      );
    }

    if (entry.isDirectory()) {
      await mkdir(destinationPath, { mode: 0o755 });
      await copyDirectory(sourcePath, destinationPath, budget, depth + 1, packagePath, sourceModes);
      continue;
    }

    if (!entry.isFile()) {
      throw new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
        'The skill package contains an unsupported filesystem entry and was not copied.',
        { path: sourcePath, reason: 'UNSUPPORTED_FILE_TYPE' },
      );
    }

    const info = await lstat(sourcePath);
    budget.files += 1;
    budget.bytes += info.size;
    if (budget.files > MAX_SKILL_PACKAGE_FILES || budget.bytes > MAX_SKILL_PACKAGE_BYTES) {
      throw new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.TOO_LARGE,
        'The skill package exceeds the copy size limit.',
        {
          files: budget.files,
          bytes: budget.bytes,
          maxFiles: MAX_SKILL_PACKAGE_FILES,
          maxBytes: MAX_SKILL_PACKAGE_BYTES,
        },
      );
    }

    const checked = await readCheckedCopyFile(sourcePath, MAX_SKILL_PACKAGE_BYTES - (budget.bytes - info.size),
      () => new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
        'The skill package changed during copying or contains an unsafe file.',
        { path: sourcePath },
      ));
    if (checked.content.length !== info.size) {
      throw new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.SOURCE_UNSAFE,
        'The skill package changed during copying.',
        { path: sourcePath },
      );
    }
    budget.copiedFiles.push({
      path: packagePath, content: checked.content,
      executable: sourceModes === null ? (checked.mode & 0o111n) !== 0n :
        installedExecutableFlag(sourceModes, packagePath, (checked.mode & 0o111n) !== 0n),
    });
    if (entry.name === 'SKILL.md') {
      budget.skillEntries.push({ path: packagePath, ...checked });
      continue;
    }
    await writeFile(destinationPath, checked.content, {
      flag: 'wx',
      mode: Number(checked.mode & 0o777n),
    });
    await chmod(destinationPath, Number(checked.mode & 0o777n));
  }
}

export function safePackageName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug === '' ? 'skill' : slug;
}

function errnoCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return 'UNKNOWN';
}
