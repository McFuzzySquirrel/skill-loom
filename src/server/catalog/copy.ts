import {
  copyFile,
  chmod,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ScenarioSkillSource } from '../../shared/presets.js';
import type { SkillEntry, SkillHarness } from './types.js';

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

export interface CopySkillIntoProjectInput {
  /** Canonical project directory. */
  projectPath: string;
  /** Harness that reported the catalog entry. */
  harness: SkillHarness;
  /** Entry from the fresh server-side catalog discovery. */
  entry: SkillEntry;
  /** Whether to suffix the destination if the skill directory already exists. */
  allowNameSuffix?: boolean;
}

export interface CopySkillIntoProjectResult {
  name: string;
  source: SkillEntry['source'];
  destinationPath: string;
}

/** Project-local root the harness will discover on its next scan. */
export function projectSkillRootFor(harness: SkillHarness, projectPath: string): string {
  return harness === 'opencode'
    ? join(projectPath, '.opencode', 'skills')
    : join(projectPath, '.github', 'skills');
}

export async function copySkillIntoProject(
  input: CopySkillIntoProjectInput,
): Promise<CopySkillIntoProjectResult> {
  const { entry, projectPath, harness, allowNameSuffix = true } = input;

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

  const destinationRoot = await createProjectSkillRoot(harness, projectPath);

  const destination = await reserveDestination(
    destinationRoot,
    safePackageName(entry.name || basename(sourceDirectory)),
    allowNameSuffix,
  );

  const budget = { files: 0, bytes: 0 };
  try {
    await copyDirectory(sourceDirectory, destination, budget);
  } catch (error) {
    await removePartialCopy(
      destination,
      entry.id,
      'A partial skill package could not be removed after copy failed.',
      error,
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

  return {
    name: entry.name,
    source: entry.source,
    destinationPath: destination,
  };
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

  const result = await copySkillIntoProject({
    ...input,
    allowNameSuffix: false,
  });
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

  try {
    await writeFile(join(result.destinationPath, 'SKILL-LOOM-SOURCE.md'), notice, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
  } catch (error) {
    await removePartialCopy(
      result.destinationPath,
      input.entry.id,
      'A bundled skill package could not be removed after its attribution notice failed.',
      error,
    );
    throw new CatalogCopyError(
      CATALOG_COPY_ERROR_CODES.COPY_FAILED,
      'The bundled skill attribution notice could not be written.',
      { skillId: input.entry.id, reason: errnoCode(error) },
      { cause: error },
    );
  }

  return result;
}

async function removePartialCopy(
  destination: string,
  skillId: string,
  message: string,
  cause: unknown,
): Promise<void> {
  try {
    await rm(destination, { recursive: true, force: true });
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

async function createProjectSkillRoot(
  harness: SkillHarness,
  projectPath: string,
): Promise<string> {
  const segments = harness === 'opencode'
    ? ['.opencode', 'skills']
    : ['.github', 'skills'];
  let directory = projectPath;

  for (const segment of segments) {
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

async function copyDirectory(
  source: string,
  destination: string,
  budget: { files: number; bytes: number },
): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);

    if (entry.isSymbolicLink()) {
      throw new CatalogCopyError(
        CATALOG_COPY_ERROR_CODES.SYMLINK_UNSUPPORTED,
        'A skill package contains a symbolic link and was not copied.',
        { path: sourcePath, reason: 'SYMLINK' },
      );
    }

    if (entry.isDirectory()) {
      await mkdir(destinationPath, { mode: 0o755 });
      await copyDirectory(sourcePath, destinationPath, budget);
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

    await copyFile(sourcePath, destinationPath);
    if ((info.mode & 0o111) !== 0) {
      await chmod(destinationPath, info.mode & 0o777);
    }
  }
}

function safePackageName(value: string): string {
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
