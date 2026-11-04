import type { Dirent, Stats } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import {
  FrontmatterError,
  frontmatterString,
  parseSkillFrontmatter,
  type SkillFrontmatter,
} from './frontmatter.js';
import {
  CATALOG_ERROR_CODES,
  CATALOG_WARNING_CODES,
  CatalogError,
  compareSkillEntries,
  createSkillId,
  type CatalogWarning,
  type CatalogWarningCode,
  type SkillDiscoveryResult,
  type SkillEntry,
  type SkillSource,
} from './types.js';

/** OpenCode discovers skills from filesystem packages, never from a CLI. */
export const OPENCODE_HARNESS = 'opencode' as const;

/** The single file that identifies a skill package. */
export const SKILL_FILE_NAME = 'SKILL.md';

/** Project-local discovery root, relative to the canonical project directory. */
export const OPENCODE_PROJECT_SKILLS_SEGMENTS = ['.opencode', 'skills'] as const;

/** Personal discovery root, relative to the user's home directory. */
export const OPENCODE_PERSONAL_SKILLS_SEGMENTS = ['.config', 'opencode', 'skills'] as const;

/**
 * Defensive recursion cap. Real skill trees are shallow; the cap keeps a
 * pathological or accidentally linked tree from turning discovery into a
 * filesystem walk.
 */
export const DEFAULT_MAX_SKILL_DEPTH = 16;

export interface OpenCodeScanOptions {
  /** Canonical absolute project directory. */
  projectPath: string;
  /** Home directory seam for tests. Defaults to `os.homedir()`. */
  homeDirectory?: string;
  /** Slan-configured extra skill directories from global config. */
  extraDirectories?: readonly string[];
  /** Recursion cap. Defaults to `DEFAULT_MAX_SKILL_DEPTH`. */
  maxDepth?: number;
}

interface ScanRoot {
  source: SkillSource;
  path: string;
  /**
   * True for the two documented native roots. A missing native root is a
   * normal empty source; a missing configured extra directory is a warning.
   */
  optional: boolean;
}

/**
 * Discover OpenCode skill packages.
 *
 * The scanner reads `SKILL.md` metadata only. It does not execute a skill,
 * invoke the OpenCode CLI, call a model, or read anything outside the three
 * documented roots. Filesystem and frontmatter problems become warnings so
 * one broken package or directory cannot hide the rest of the catalog.
 */
export async function scanOpenCodeSkills(
  options: OpenCodeScanOptions,
): Promise<SkillDiscoveryResult> {
  const projectPath = validateProjectPath(options.projectPath);
  const home = options.homeDirectory ?? homedir();
  const maxDepth = normalizeMaxDepth(options.maxDepth);
  const roots = buildRoots(projectPath, home, options.extraDirectories ?? []);

  const entries: SkillEntry[] = [];
  const warnings: CatalogWarning[] = [];

  for (const root of roots) {
    await scanRoot(root, maxDepth, entries, warnings);
  }

  entries.sort(compareSkillEntries);
  return { entries, warnings };
}

function validateProjectPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    throw new CatalogError(
      CATALOG_ERROR_CODES.PROJECT_PATH_INVALID,
      'OpenCode discovery requires an absolute project directory.',
      { path: typeof value === 'string' ? value : String(value) },
    );
  }
  return value;
}

function normalizeMaxDepth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_SKILL_DEPTH;
  }
  return Math.max(0, Math.floor(value));
}

function buildRoots(
  projectPath: string,
  homeDirectory: string,
  extraDirectories: readonly string[],
): ScanRoot[] {
  const roots: ScanRoot[] = [
    {
      source: 'project',
      path: join(projectPath, ...OPENCODE_PROJECT_SKILLS_SEGMENTS),
      optional: true,
    },
    {
      source: 'personal',
      path: join(homeDirectory, ...OPENCODE_PERSONAL_SKILLS_SEGMENTS),
      optional: true,
    },
  ];

  for (const extra of extraDirectories) {
    roots.push({
      source: 'slan-extra',
      path: typeof extra === 'string' ? extra.trim() : String(extra),
      optional: false,
    });
  }

  return roots;
}

async function scanRoot(
  root: ScanRoot,
  maxDepth: number,
  entries: SkillEntry[],
  warnings: CatalogWarning[],
): Promise<void> {
  if (!isAbsolute(root.path) || root.path.includes('\0')) {
    pushWarning(warnings, {
      code: CATALOG_WARNING_CODES.DIRECTORY_PATH_INVALID,
      message: 'A skill directory must be an absolute path; it was skipped.',
      source: root.source,
      path: root.path,
      reason: 'PATH_NOT_ABSOLUTE',
    });
    return;
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root.path);
  } catch (error) {
    const reason = errnoCode(error);
    if (!(root.optional && reason === 'ENOENT')) {
      pushWarning(warnings, {
        code:
          reason === 'ENOENT'
            ? CATALOG_WARNING_CODES.DIRECTORY_NOT_FOUND
            : reason === 'ENOTDIR'
              ? CATALOG_WARNING_CODES.DIRECTORY_NOT_A_DIRECTORY
              : CATALOG_WARNING_CODES.DIRECTORY_UNREADABLE,
        message: 'A skill directory could not be resolved; it was skipped.',
        source: root.source,
        path: root.path,
        reason,
      });
    }
    return;
  }

  let info: Stats;
  try {
    info = await stat(canonicalRoot);
  } catch (error) {
    pushWarning(warnings, {
      code: CATALOG_WARNING_CODES.DIRECTORY_UNREADABLE,
      message: 'A skill directory could not be inspected; it was skipped.',
      source: root.source,
      path: canonicalRoot,
      reason: errnoCode(error),
    });
    return;
  }

  if (!info.isDirectory()) {
    pushWarning(warnings, {
      code: CATALOG_WARNING_CODES.DIRECTORY_NOT_A_DIRECTORY,
      message: 'A skill directory path is not a directory; it was skipped.',
      source: root.source,
      path: canonicalRoot,
      reason: 'ENOTDIR',
    });
    return;
  }

  await walkDirectory(canonicalRoot, root, 0, maxDepth, entries, warnings);
}

async function walkDirectory(
  directory: string,
  root: ScanRoot,
  depth: number,
  maxDepth: number,
  entries: SkillEntry[],
  warnings: CatalogWarning[],
): Promise<void> {
  if (depth > maxDepth) {
    pushWarning(warnings, {
      code: CATALOG_WARNING_CODES.DEPTH_EXCEEDED,
      message: `Skill discovery stopped at depth ${String(maxDepth)}; deeper directories were not scanned.`,
      source: root.source,
      path: directory,
      reason: 'MAX_DEPTH',
    });
    return;
  }

  let dirents: Dirent[];
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    pushWarning(warnings, {
      code: CATALOG_WARNING_CODES.DIRECTORY_UNREADABLE,
      message: 'A skill directory could not be read; its contents were skipped.',
      source: root.source,
      path: directory,
      reason: errnoCode(error),
    });
    return;
  }

  // Sorted traversal keeps entry and warning order deterministic.
  dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const skillFile = dirents.find(
    (dirent) => dirent.name === SKILL_FILE_NAME && !dirent.isDirectory(),
  );
  if (skillFile) {
    const entry = await readSkillPackage(directory, root, warnings);
    if (entry) {
      entries.push(entry);
    }
  }

  // Directory symlinks are intentionally not followed. A cycle through a
  // symlinked skill root cannot then loop, and canonical package paths are
  // still recorded for the files that are read.
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue;
    }
    await walkDirectory(join(directory, dirent.name), root, depth + 1, maxDepth, entries, warnings);
  }
}

async function readSkillPackage(
  packageDirectory: string,
  root: ScanRoot,
  warnings: CatalogWarning[],
): Promise<SkillEntry | undefined> {
  const candidate = join(packageDirectory, SKILL_FILE_NAME);

  let canonicalFile: string;
  try {
    canonicalFile = await realpath(candidate);
  } catch (error) {
    pushWarning(warnings, {
      code: CATALOG_WARNING_CODES.FILE_UNREADABLE,
      message: 'A SKILL.md file could not be resolved; the package was skipped.',
      source: root.source,
      path: candidate,
      reason: errnoCode(error),
    });
    return undefined;
  }

  let content: string;
  try {
    content = await readFile(canonicalFile, 'utf8');
  } catch (error) {
    pushWarning(warnings, {
      code: CATALOG_WARNING_CODES.FILE_UNREADABLE,
      message: 'A SKILL.md file could not be read; the package was skipped.',
      source: root.source,
      path: canonicalFile,
      reason: errnoCode(error),
    });
    return undefined;
  }

  let frontmatter: SkillFrontmatter;
  let malformed = false;
  try {
    frontmatter = parseSkillFrontmatter(content);
  } catch (error) {
    malformed = true;
    pushWarning(warnings, {
      code: CATALOG_WARNING_CODES.FRONTMATTER_INVALID,
      message:
        'A SKILL.md frontmatter block is malformed; its metadata was ignored and the directory name was used.',
      source: root.source,
      path: canonicalFile,
      reason: error instanceof FrontmatterError ? error.code : 'FRONTMATTER_INVALID',
    });
    frontmatter = { present: false, data: {}, body: content };
  }

  const explicitName = frontmatterString(frontmatter.data, 'name');
  const fallbackName = basename(packageDirectory) || 'skill';
  const name = explicitName ?? fallbackName;

  if (!explicitName && !malformed) {
    pushWarning(
      warnings,
      frontmatter.present
        ? {
            code: CATALOG_WARNING_CODES.NAME_MISSING,
            message:
              'A SKILL.md has no nonempty frontmatter name; the package directory name was used.',
            source: root.source,
            path: canonicalFile,
            reason: 'NAME_MISSING',
          }
        : {
            code: CATALOG_WARNING_CODES.FRONTMATTER_MISSING,
            message:
              'A SKILL.md has no YAML frontmatter; the package directory name was used.',
            source: root.source,
            path: canonicalFile,
            reason: 'FRONTMATTER_MISSING',
          },
    );
  }

  const description = frontmatterString(frontmatter.data, 'description') ?? '';
  const packagePath = dirname(canonicalFile);

  return {
    id: createSkillId({
      harness: OPENCODE_HARNESS,
      source: root.source,
      path: canonicalFile,
      name,
    }),
    harness: OPENCODE_HARNESS,
    source: root.source,
    name,
    description,
    path: canonicalFile,
    packagePath,
    enabled: true,
  };
}

interface WarningInput {
  code: CatalogWarningCode;
  message: string;
  source: SkillSource;
  path: string;
  reason?: string;
}

function pushWarning(warnings: CatalogWarning[], input: WarningInput): void {
  const warning: CatalogWarning = {
    code: input.code,
    message: input.message,
    harness: OPENCODE_HARNESS,
    source: input.source,
    path: input.path,
  };
  if (input.reason !== undefined) {
    warning.reason = input.reason;
  }
  warnings.push(warning);
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
