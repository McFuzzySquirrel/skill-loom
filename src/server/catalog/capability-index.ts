import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { Dirent } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  REMOTE_SNAPSHOT_CONTENT,
  SKILL_SOURCES,
  createSkillId,
  type CatalogWarning,
  type SkillEntry,
  type SkillHarness,
  type SkillSource,
} from './types.js';
import { frontmatterString, parseSkillFrontmatter } from './frontmatter.js';
import { extractSkillMetadata, type SkillMetadata } from './skill-metadata.js';
import type { CatalogService } from './merge.js';
import {
  OPENCODE_PERSONAL_SKILLS_SEGMENTS,
  OPENCODE_PROJECT_SKILLS_SEGMENTS,
} from './opencode.js';
import { SHARED_PROJECT_SKILLS_SEGMENTS, SHARED_SKILLS_SEGMENTS } from './project-paths.js';
import type { RemoteSkillSource } from '../config/schema.js';
import {
  RemoteSourceError,
  listRemoteSkillSnapshots,
  resolveSnapshotPackage,
} from './remote.js';

/**
 * The capability index is a derived, disposable search cache for chain
 * authoring. Package files remain authoritative: every row is keyed by the
 * canonical `SKILL.md` path and validated against a cheap stat check plus a
 * content hash before it is served.
 *
 * The index never executes a skill, follows its instructions, or calls a model.
 * It stores only bounded excerpts and file names. A missing, corrupt, unsafe,
 * unsupported, or unreadable index falls back to the existing fresh scan.
 */

export const CAPABILITY_INDEX_FILE_NAME = 'capability-index.sqlite';
/** Structured metadata added in Phase 3; older indexes rebuild on read. */
export const CAPABILITY_INDEX_SCHEMA_VERSION = 2;
/** "SLOM" as a SQLite application id. */
export const CAPABILITY_INDEX_APPLICATION_ID = 0x534c4f4d;
export const CAPABILITY_INDEX_MAX_BYTES = 64 * 1024 * 1024;
export const CAPABILITY_BODY_EXCERPT_BYTES = 32 * 1024;
export const CAPABILITY_FRONTMATTER_BYTES = 8 * 1024;
export const CAPABILITY_FILE_PATHS_BYTES = 8 * 1024;
export const CAPABILITY_MAX_FILE_PATHS = 500;
export const CAPABILITY_MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024;
export const CAPABILITY_MAX_PACKAGES = 10_000;
export const CAPABILITY_MAX_QUERY_LENGTH = 500;
export const CAPABILITY_MAX_QUERY_TERMS = 16;
export const CAPABILITY_MAX_RESULTS = 50;
export const CAPABILITY_DEFAULT_RESULTS = 10;
export const CAPABILITY_MAX_OFFSET = 10_000;
export const CAPABILITY_MAX_SNIPPET_CHARS = 240;
export const CAPABILITY_MAX_FILTER_VALUES = 20;
export const CAPABILITY_MAX_FILTER_VALUE_LENGTH = 120;
export const CAPABILITY_MAX_FACET_VALUES = 100;
export const CAPABILITY_QUERY_BUDGET_MS = 250;

const DEFAULT_MAX_DEPTH = 12;
const MAX_HEADINGS = 100;
const MAX_HEADING_CHARS = 200;
const FTS_RANKING = 'fts5' as const;
const TOKEN_RANKING = 'tokens' as const;
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', 'node_modules',
  'dist', 'build', 'target', 'bin', 'obj', 'vendor', 'coverage',
]);
const INDEXED_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.go', '.rs', '.java', '.kt',
  '.cs', '.c', '.h', '.cc', '.cpp', '.hpp', '.rb', '.php', '.swift', '.sql', '.html',
  '.css', '.scss', '.less', '.xml', '.csv', '.tsv',
]);

export type CapabilityRanking = typeof FTS_RANKING | typeof TOKEN_RANKING;

export type CapabilityFallbackReason =
  | 'disabled'
  | 'missing'
  | 'stale'
  | 'corrupt'
  | 'unsafe'
  | 'unsupported'
  | 'uncovered'
  | 'too_large'
  | 'error';

export interface CapabilitySourceRoot {
  /** Absolute canonical package discovery directory. */
  directory: string;
  harness: SkillHarness;
  source: SkillSource;
  /** Canonical project path for project-scoped rows. */
  projectPath?: string;
  /** Loom-configured root recorded as provenance for extra directories. */
  sourceDirectory?: string;
  enabled?: boolean;
}

export interface CapabilityRemoteBinding {
  sourceId: string;
  revision: string;
  repositoryPath: string;
  repository?: string;
  /** Snapshot fingerprint from the validated remote manifest. */
  fingerprint: string;
}

export interface CapabilityPackageDescriptor {
  harness: SkillHarness;
  source: SkillSource;
  /** Canonical absolute path to the package `SKILL.md`. */
  path: string;
  /** Canonical absolute path to the package directory. */
  packagePath: string;
  /** Root the package was discovered from. */
  rootPath: string;
  projectPath?: string;
  sourceDirectory?: string;
  fallbackName?: string;
  fallbackDescription?: string;
  enabled?: boolean;
  /** Build remote descriptors from a verified snapshot manifest only. */
  remote?: CapabilityRemoteBinding;
}

export interface CapabilityCollection {
  roots: readonly CapabilitySourceRoot[];
  packages: readonly CapabilityPackageDescriptor[];
  warnings: CatalogWarning[];
}

/** Optional retrieval filters. Arrays require every listed value (AND). */
export interface CapabilitySearchFilters {
  /** Restrict results to these sources. Empty or absent means no source filter. */
  sources?: SkillSource[] | undefined;
  /** `true` (the default) returns enabled rows; `false` returns disabled rows. */
  enabled?: boolean | undefined;
  tags?: string[] | undefined;
  tools?: string[] | undefined;
  inputs?: string[] | undefined;
  outputs?: string[] | undefined;
  /** `true` requires at least one declared tag; `false` requires none. */
  hasTags?: boolean | undefined;
  hasTools?: boolean | undefined;
  hasInputs?: boolean | undefined;
  hasOutputs?: boolean | undefined;
}

export interface CapabilityIndexQuery extends CapabilitySearchFilters {
  harness: SkillHarness;
  projectPath: string;
  query?: string;
  offset?: number;
  limit?: number;
}

export interface CapabilityCandidate {
  id: string;
  harness: SkillHarness;
  source: SkillSource;
  name: string;
  description: string;
  path: string;
  packagePath: string;
  rootPath: string;
  projectPath?: string;
  sourceDirectory?: string;
  enabled: boolean;
  score: number;
  snippet: string;
  fingerprint: string;
  sourceId?: string;
  revision?: string;
  repositoryPath?: string;
  repository?: string;
  metadata?: SkillMetadata;
  /** Fields whose declared metadata was invalid or bounded away. */
  metadataIssues?: string[];
}

export interface CapabilityFacetValue {
  value: string;
  count: number;
}

/** Unique declared metadata values over the filtered scope. */
export interface CapabilityMetadataFacets {
  tags: CapabilityFacetValue[];
  tools: CapabilityFacetValue[];
  inputs: CapabilityFacetValue[];
  outputs: CapabilityFacetValue[];
}

/** Counts over every skill in the indexed scope, independent of the query or page. */
export interface CapabilityMetadataCoverage {
  total: number;
  withDescription: number;
  withHeadings: number;
  withTags: number;
  withTools: number;
  withInputs: number;
  withOutputs: number;
  withWhenToUse: number;
  withIssues: number;
  withoutStructuredMetadata: number;
}

export interface CapabilitySearchResponse {
  mode: 'index' | 'scan';
  reason?: CapabilityFallbackReason;
  harness: SkillHarness;
  query: string;
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  candidates: CapabilityCandidate[];
  warnings: CatalogWarning[];
  elapsedMs: number;
  ranking?: CapabilityRanking;
  /** Present only when the indexed path answered. */
  coverage?: CapabilityMetadataCoverage;
  /** Present only when the indexed path answered. */
  facets?: CapabilityMetadataFacets;
}

export type CapabilityFallback = (
  request: Required<Pick<CapabilityIndexQuery, 'harness' | 'projectPath'>> &
    CapabilitySearchFilters & {
      query: string;
      offset: number;
      limit: number;
    },
) => Promise<CapabilitySearchResponse>;

export interface CapabilityIndexOptions {
  /** Profile directory that holds the disposable database. */
  directory: string;
  maxBytes?: number;
  maxExcerptBytes?: number;
  now?: () => number;
  /** Force the deterministic token table even when FTS5 is available. */
  forceTokenSearch?: boolean;
  /** Optional validation of a remote row before it is served. */
  validateRemote?: (candidate: CapabilityCandidate) => Promise<boolean> | boolean;
}

export interface CapabilityIndexValidation {
  ok: boolean;
  reason?: Exclude<CapabilityFallbackReason, 'disabled' | 'uncovered' | 'error'>;
  ranking?: CapabilityRanking;
}

export class CapabilityIndexError extends Error {
  constructor(
    readonly code: CapabilityFallbackReason,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

interface SkillRow {
  id: string;
  harness: string;
  source: string;
  path: string;
  package_path: string;
  root_path: string;
  project_path: string | null;
  source_directory: string | null;
  name: string;
  description: string;
  frontmatter: string;
  headings: string;
  body_excerpt: string;
  file_paths: string;
  fingerprint: string;
  content_hash: string;
  size: string;
  mtime_ns: string;
  inode: string;
  license: string | null;
  enabled: number;
  remote_source_id: string | null;
  remote_revision: string | null;
  remote_repository_path: string | null;
  remote_repository: string | null;
}

interface IndexedPackage {
  row: SkillRow;
  tokens: Array<{ token: string; weight: number }>;
  metadata: SkillMetadata;
  metadataIssues: string[];
  metadataText: string;
}

interface ReadSkill {
  content: string;
  fingerprint: string;
  contentHash: string;
  size: string;
  mtimeNs: string;
  inode: string;
}

/**
 * The derived index is enabled by default. `LOOM_CAPABILITY_INDEX=0` forces
 * the fresh catalog scan and is the documented rollback.
 */
export function capabilityIndexEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOOM_CAPABILITY_INDEX !== '0';
}

/**
 * Default OpenCode discovery roots plus the packaged scenario skills. Copilot
 * discovery is CLI-authoritative, so this helper deliberately returns no roots
 * for it; the caller falls back to the existing catalog scan until Phase 2
 * supplies verified Copilot and remote descriptors.
 */
export function defaultCapabilitySourceRoots(options: {
  projectPath: string;
  harness: SkillHarness;
  homeDirectory?: string;
  extraDirectories?: readonly string[];
  includeBundled?: boolean;
}): CapabilitySourceRoot[] {
  if (options.harness !== 'opencode') return [];
  const home = options.homeDirectory ?? homedir();
  const roots: CapabilitySourceRoot[] = [
    {
      directory: join(options.projectPath, ...SHARED_PROJECT_SKILLS_SEGMENTS),
      harness: 'opencode',
      source: 'project',
      projectPath: options.projectPath,
    },
    {
      directory: join(options.projectPath, ...OPENCODE_PROJECT_SKILLS_SEGMENTS),
      harness: 'opencode',
      source: 'project',
      projectPath: options.projectPath,
    },
    {
      directory: join(home, ...SHARED_SKILLS_SEGMENTS),
      harness: 'opencode',
      source: 'personal',
    },
    {
      directory: join(home, ...OPENCODE_PERSONAL_SKILLS_SEGMENTS),
      harness: 'opencode',
      source: 'personal',
    },
  ];
  for (const directory of options.extraDirectories ?? []) {
    roots.push({
      directory,
      harness: 'opencode',
      source: 'loom-extra',
      sourceDirectory: directory,
    });
  }
  if (options.includeBundled !== false) {
    roots.push({
      directory: fileURLToPath(new URL('../chains/scenario-skills', import.meta.url)),
      harness: 'opencode',
      source: 'builtin',
    });
  }
  return roots;
}

/**
 * Discover package descriptors by walking roots. Only directories are
 * enumerated; `SKILL.md` content is read later by the index, so an unchanged
 * package can take the stat fast path. Symlinked roots, directories, and files
 * are never followed.
 */
export async function collectCapabilityPackages(
  roots: readonly CapabilitySourceRoot[],
): Promise<CapabilityCollection> {
  const packages: CapabilityPackageDescriptor[] = [];
  const warnings: CatalogWarning[] = [];
  for (const root of roots) {
    if (packages.length >= CAPABILITY_MAX_PACKAGES) break;
    await collectRoot(root, packages, warnings);
  }
  return { roots: [...roots], packages, warnings };
}

async function collectRoot(
  root: CapabilitySourceRoot,
  packages: CapabilityPackageDescriptor[],
  warnings: CatalogWarning[],
): Promise<void> {
  if (!isAbsolute(root.directory) || root.directory.includes('\0')) {
    warnings.push(rootWarning(root, 'SKILL_DIRECTORY_PATH_INVALID', 'A capability root must be an absolute path.'));
    return;
  }
  let canonical: string;
  try {
    canonical = await realpath(root.directory);
    const info = await stat(canonical);
    if (!info.isDirectory()) {
      warnings.push(rootWarning(root, 'SKILL_DIRECTORY_NOT_A_DIRECTORY', 'A capability root is not a directory.'));
      return;
    }
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return;
    warnings.push(rootWarning(root, 'SKILL_DIRECTORY_UNREADABLE', 'A capability root could not be read.'));
    return;
  }
  await walkRoot(canonical, root, 0, packages, warnings);
}

async function walkRoot(
  directory: string,
  root: CapabilitySourceRoot,
  depth: number,
  packages: CapabilityPackageDescriptor[],
  warnings: CatalogWarning[],
): Promise<void> {
  if (packages.length >= CAPABILITY_MAX_PACKAGES) return;
  if (depth > DEFAULT_MAX_DEPTH) {
    warnings.push(rootWarning(root, 'SKILL_DEPTH_EXCEEDED', 'Capability discovery stopped at its depth limit.'));
    return;
  }
  let dirents: Dirent[];
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch {
    warnings.push(rootWarning(root, 'SKILL_DIRECTORY_UNREADABLE', 'A capability directory could not be read.'));
    return;
  }
  dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const skillFile = dirents.find((entry) => entry.name === 'SKILL.md' && entry.isFile());
  if (skillFile !== undefined) {
    const path = join(directory, 'SKILL.md');
    try {
      const info = await lstat(path);
      if (info.isFile() && !info.isSymbolicLink()) {
        packages.push({
          harness: root.harness,
          source: root.source,
          path,
          packagePath: directory,
          rootPath: root.directory,
          ...(root.projectPath === undefined ? {} : { projectPath: root.projectPath }),
          ...(root.sourceDirectory === undefined ? {} : { sourceDirectory: root.sourceDirectory }),
          ...(root.enabled === undefined ? {} : { enabled: root.enabled }),
        });
      } else {
        warnings.push(rootWarning(root, 'SKILL_PATH_UNRESOLVED', 'A SKILL.md is not a regular file and was skipped.'));
      }
    } catch {
      warnings.push(rootWarning(root, 'SKILL_FILE_UNREADABLE', 'A SKILL.md could not be inspected and was skipped.'));
    }
    // A package is a leaf for indexing. Nested skill packages are not expected
    // inside an existing package and walking generated reference trees is costly.
    return;
  }
  for (const entry of dirents) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    await walkRoot(join(directory, entry.name), root, depth + 1, packages, warnings);
  }
}

/**
 * Resolve verified remote package descriptors from pinned snapshots. Every
 * package is checked against its snapshot manifest before it enters the index;
 * an unavailable or unsafe snapshot contributes a warning, never a row.
 */
export async function collectRemoteCapabilityPackages(options: {
  configDirectory: string;
  sources: readonly RemoteSkillSource[];
  harness: SkillHarness;
}): Promise<{ packages: CapabilityPackageDescriptor[]; warnings: CatalogWarning[] }> {
  const packages: CapabilityPackageDescriptor[] = [];
  const warnings: CatalogWarning[] = [];
  let configRoot: string;
  try {
    configRoot = await realpath(options.configDirectory);
  } catch {
    return { packages, warnings };
  }
  for (const source of options.sources) {
    try {
      const snapshots = await listRemoteSkillSnapshots(options.configDirectory, source.id);
      for (const snapshot of snapshots) {
        const rootPath = join(configRoot, 'catalog-sources', source.id, snapshot.revision);
        for (const packageInfo of snapshot.packages) {
          try {
            const resolved = await resolveSnapshotPackage(options.configDirectory, snapshot, packageInfo);
            packages.push({
              harness: options.harness,
              source: 'remote',
              path: join(resolved.path, 'SKILL.md'),
              packagePath: resolved.path,
              rootPath,
              fallbackName: packageInfo.name,
              fallbackDescription: packageInfo.description,
              remote: {
                sourceId: source.id,
                revision: snapshot.revision,
                repositoryPath: packageInfo.repositoryPath,
                repository: snapshot.repository,
                fingerprint: packageInfo.fingerprint,
              },
            });
          } catch (error) {
            warnings.push(remoteWarning(options.harness, source.id, error));
          }
        }
      }
    } catch (error) {
      warnings.push(remoteWarning(options.harness, source.id, error));
    }
  }
  return { packages, warnings };
}

function remoteWarning(harness: SkillHarness, sourceId: string, error: unknown): CatalogWarning {
  return {
    code: 'REMOTE_SOURCE_UNAVAILABLE',
    message: 'A saved remote skill snapshot could not be verified and was omitted from the capability index.',
    harness,
    source: 'remote',
    reason: error instanceof RemoteSourceError ? error.code : 'READ_FAILED',
    path: sourceId,
  };
}

function rootWarning(
  root: CapabilitySourceRoot,
  code: CatalogWarning['code'],
  message: string,
): CatalogWarning {
  return {
    code,
    message,
    harness: root.harness,
    source: root.source,
    path: root.directory,
  };
}

export class CapabilityIndex {
  private readonly indexPath: string;
  private readonly maxBytes: number;
  private readonly maxExcerptBytes: number;
  private readonly now: () => number;
  private readonly forceTokenSearch: boolean;
  private readonly validateRemote: CapabilityIndexOptions['validateRemote'];
  private closed = false;
  private syncing: Promise<CatalogWarning[]> | undefined;

  constructor(options: CapabilityIndexOptions) {
    this.indexPath = join(options.directory, CAPABILITY_INDEX_FILE_NAME);
    this.maxBytes = normalizePositive(options.maxBytes, CAPABILITY_INDEX_MAX_BYTES);
    this.maxExcerptBytes = normalizePositive(options.maxExcerptBytes, CAPABILITY_BODY_EXCERPT_BYTES);
    this.now = options.now ?? Date.now;
    this.forceTokenSearch = options.forceTokenSearch === true;
    this.validateRemote = options.validateRemote;
  }

  async validate(): Promise<CapabilityIndexValidation> {
    this.assertOpen();
    let info: Stats;
    try {
      info = await lstat(this.indexPath);
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return { ok: false, reason: 'missing' };
      return { ok: false, reason: 'unsafe' };
    }
    if (!info.isFile() || info.isSymbolicLink() || Number(info.nlink) !== 1 ||
        (process.platform !== 'win32' && (Number(info.mode) & 0o077) !== 0)) {
      return { ok: false, reason: 'unsafe' };
    }
    if (info.size > this.maxBytes) return { ok: false, reason: 'too_large' };

    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(this.indexPath, { readOnly: true });
      database.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON');
      const applicationId = pragmaNumber(database, 'application_id');
      if (applicationId !== CAPABILITY_INDEX_APPLICATION_ID) return { ok: false, reason: 'unsupported' };
      const version = pragmaNumber(database, 'user_version');
      if (version !== CAPABILITY_INDEX_SCHEMA_VERSION) {
        return {
          ok: false,
          reason: version !== undefined && version > CAPABILITY_INDEX_SCHEMA_VERSION ? 'unsupported' : 'corrupt',
        };
      }
      const metadata = readMetadata(database);
      if (metadata.get('schema') !== String(CAPABILITY_INDEX_SCHEMA_VERSION) ||
          metadata.get('application') !== 'skill-loom-capability-index') {
        return { ok: false, reason: 'corrupt' };
      }
      const ranking = metadata.get('ranking');
      if (ranking !== FTS_RANKING && ranking !== TOKEN_RANKING) {
        return { ok: false, reason: 'corrupt' };
      }
      const skillCount = scalarNumber(database.prepare('SELECT count(*) AS value FROM skills').get());
      if (skillCount === undefined || skillCount < 0) return { ok: false, reason: 'corrupt' };
      if (ranking === FTS_RANKING) {
        const ftsCount = scalarNumber(database.prepare('SELECT count(*) AS value FROM skill_fts').get());
        if (ftsCount !== skillCount) return { ok: false, reason: 'corrupt' };
      }
      return { ok: true, ranking };
    } catch {
      return { ok: false, reason: 'corrupt' };
    } finally {
      database?.close();
    }
  }

  /** Force a complete rebuild into a temporary file, then replace atomically. */
  async rebuild(collection: CapabilityCollection): Promise<void> {
    this.assertOpen();
    await this.writeDatabase(collection);
  }

  /**
   * Reconcile the index with the current package descriptors. Unchanged rows
   * keep their content through a size/mtime/inode stat fast path; changed rows
   * are re-read and re-fingerprinted.
   */
  async refresh(collection: CapabilityCollection): Promise<CatalogWarning[]> {
    this.assertOpen();
    if (this.syncing !== undefined) return this.syncing;
    const running = this.sync(collection);
    this.syncing = running;
    try {
      return await running;
    } finally {
      if (this.syncing === running) this.syncing = undefined;
    }
  }

  private async sync(collection: CapabilityCollection): Promise<CatalogWarning[]> {
    const validation = await this.validate();
    if (!validation.ok) {
      throw new CapabilityIndexError(validation.reason ?? 'error', 'The capability index is unavailable.');
    }
    const warnings: CatalogWarning[] = [];
    const database = new DatabaseSync(this.indexPath);
    try {
      database.exec('PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON');
      const existing = new Map<string, SkillRow>();
      for (const row of database.prepare('SELECT * FROM skills').all() as unknown as SkillRow[]) {
        existing.set(`${row.harness}\0${row.path}`, row);
      }
      const keep = new Set<string>();
      const roots = new Set(collection.roots.map((root) => root.directory));
      const harnesses = new Set(collection.roots.map((root) => root.harness));
      for (const descriptor of collection.packages) harnesses.add(descriptor.harness);
      const projects = new Set(collection.roots
        .map((root) => root.projectPath)
        .filter((value): value is string => value !== undefined));
      const descriptors = [...collection.packages].sort((left, right) =>
        left.harness === right.harness
          ? left.path < right.path ? -1 : left.path > right.path ? 1 : 0
          : left.harness < right.harness ? -1 : 1);

      database.exec('BEGIN IMMEDIATE');
      try {
        for (const descriptor of descriptors) {
          const key = `${descriptor.harness}\0${descriptor.path}`;
          const previous = existing.get(key);
          if (previous === undefined) {
            const indexed = await this.indexPackage(descriptor, this.maxExcerptBytes);
            if (indexed === undefined) {
              warnings.push(packageWarning(descriptor, 'SKILL_FILE_UNREADABLE', 'A SKILL.md could not be read and was not indexed.'));
              continue;
            }
            writeRow(database, indexed, validation.ranking ?? FTS_RANKING);
          } else if (await this.statMatches(previous, descriptor.path) && descriptorMatchesRow(previous, descriptor)) {
            keep.add(key);
            continue;
          } else {
            const read = await readSkillFile(descriptor.path);
            if (read === undefined) {
              warnings.push(packageWarning(descriptor, 'SKILL_FILE_UNREADABLE', 'A SKILL.md could not be read and was not indexed.'));
              continue;
            }
            if (read.contentHash === previous.content_hash && descriptorMatchesRow(previous, descriptor)) {
              database.prepare('UPDATE skills SET size = ?, mtime_ns = ?, inode = ? WHERE id = ?')
                .run(read.size, read.mtimeNs, read.inode, previous.id);
            } else {
              const indexed = await this.indexPackage(descriptor, this.maxExcerptBytes, read);
              if (indexed === undefined) {
                warnings.push(packageWarning(descriptor, 'SKILL_FILE_UNREADABLE', 'A SKILL.md could not be read and was not indexed.'));
                continue;
              }
              if (previous.id !== indexed.row.id) deleteRow(database, previous.id);
              writeRow(database, indexed, validation.ranking ?? FTS_RANKING);
            }
          }
          keep.add(key);
        }

        const currentRows = database.prepare('SELECT * FROM skills').all() as unknown as SkillRow[];
        for (const row of currentRows) {
          if (row.source !== 'remote' && !harnesses.has(row.harness as SkillHarness)) continue;
          const key = `${row.harness}\0${row.path}`;
          if (keep.has(key)) continue;
          const inScope = row.source === 'remote'
            ? true
            : row.source === 'project'
              ? row.project_path !== null && projects.has(row.project_path)
              : roots.has(row.root_path);
          if (!inScope) {
            if (await pathMissing(row.path)) deleteRow(database, row.id);
            continue;
          }
          deleteRow(database, row.id);
        }
        database.prepare('INSERT INTO metadata(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run('builtAt', new Date(this.now()).toISOString());
        database.prepare('INSERT INTO metadata(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run('roots', JSON.stringify([...roots].sort()));
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    } finally {
      database.close();
    }
    const after = await lstat(this.indexPath);
    if (after.size > this.maxBytes) {
      throw new CapabilityIndexError('too_large', 'The capability index exceeds its size limit.');
    }
    return [...collection.warnings, ...warnings];
  }

  async search(request: CapabilityIndexQuery): Promise<CapabilitySearchResponse> {
    this.assertOpen();
    const started = performance.now();
    const validation = await this.validate();
    if (!validation.ok) {
      throw new CapabilityIndexError(validation.reason ?? 'error', 'The capability index is unavailable.');
    }
    const query = normalizeQuery(request.query);
    const terms = queryTerms(query);
    const offset = normalizeOffset(request.offset);
    const limit = normalizeLimit(request.limit);
    const ranking = validation.ranking ?? FTS_RANKING;
    const database = new DatabaseSync(this.indexPath, { readOnly: true });
    try {
      database.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON');
      const filters = normalizeCapabilityFilters(request);
      const { sql: filter, bindings } = buildFilter(request, filters);
      let rows: SkillRow[];
      let total: number;
      if (terms.length === 0) {
        total = scalarNumber(database.prepare(`SELECT count(*) AS value FROM skills s WHERE ${filter}`)
          .get(...bindings)) ?? 0;
        rows = database.prepare(
          `SELECT s.* FROM skills s WHERE ${filter} ORDER BY ${sourceOrderSql()} s.name COLLATE NOCASE, s.path LIMIT ? OFFSET ?`,
        ).all(...bindings, limit, offset) as unknown as SkillRow[];
      } else if (ranking === FTS_RANKING) {
        const match = terms.map((term) => `"${term}"*`).join(' AND ');
        total = scalarNumber(database.prepare(
          `SELECT count(*) AS value FROM skill_fts JOIN skills s ON s.id = skill_fts.id WHERE skill_fts MATCH ? AND ${filter}`,
        ).get(match, ...bindings)) ?? 0;
        rows = database.prepare(
          `SELECT s.*, bm25(skill_fts, 0.0, 12.0, 8.0, 4.0, 6.0, 3.0, 2.0, 7.0) AS rank
           FROM skill_fts JOIN skills s ON s.id = skill_fts.id
           WHERE skill_fts MATCH ? AND ${filter}
           ORDER BY rank ASC, s.name COLLATE NOCASE, s.path LIMIT ? OFFSET ?`,
        ).all(match, ...bindings, limit, offset) as unknown as SkillRow[];
      } else {
        const placeholders = terms.map(() => '?').join(', ');
        total = scalarNumber(database.prepare(
          `SELECT count(*) AS value FROM (
             SELECT s.id FROM skill_tokens t JOIN skills s ON s.id = t.skill_id
             WHERE t.token IN (${placeholders}) AND ${filter}
             GROUP BY s.id HAVING count(DISTINCT t.token) = ?
           )`,
        ).get(...terms, ...bindings, terms.length)) ?? 0;
        rows = database.prepare(
          `SELECT s.*, sum(t.weight) AS rank FROM skill_tokens t JOIN skills s ON s.id = t.skill_id
           WHERE t.token IN (${placeholders}) AND ${filter}
           GROUP BY s.id HAVING count(DISTINCT t.token) = ?
           ORDER BY rank DESC, s.name COLLATE NOCASE, s.path LIMIT ? OFFSET ?`,
        ).all(...terms, ...bindings, terms.length, limit, offset) as unknown as SkillRow[];
      }
      const metadata = readCandidateMetadata(database, rows.map((row) => row.id));
      let candidates = rows.map((row) => toCandidate(row, terms, metadata.get(row.id)));
      if (this.validateRemote !== undefined) {
        const checked: CapabilityCandidate[] = [];
        for (const candidate of candidates) {
          if (candidate.source !== 'remote') {
            checked.push(candidate);
            continue;
          }
          try {
            if (await this.validateRemote(candidate)) checked.push(candidate);
            else total = Math.max(0, total - 1);
          } catch {
            total = Math.max(0, total - 1);
          }
        }
        candidates = checked;
      }
      return {
        mode: 'index',
        harness: request.harness,
        query,
        total,
        offset,
        limit,
        nextOffset: offset + candidates.length < total ? offset + candidates.length : null,
        candidates,
        warnings: [],
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        ranking,
        coverage: readCoverage(database, filter, bindings),
        facets: readFacets(database, filter, bindings),
      };
    } finally {
      database.close();
    }
  }

  async dispose(options: { deleteIndex?: boolean } = {}): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (options.deleteIndex === true) await unlinkIfPresent(this.indexPath);
  }

  private async writeDatabase(collection: CapabilityCollection): Promise<void> {
    const directory = dirname(this.indexPath);
    await ensurePrivateDirectory(directory);
    const temporary = join(directory, `.${CAPABILITY_INDEX_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
    const ranking = this.forceTokenSearch ? TOKEN_RANKING : await detectsFts5();
    let published = false;
    try {
      const database = new DatabaseSync(temporary);
      try {
        database.exec(`PRAGMA application_id = ${String(CAPABILITY_INDEX_APPLICATION_ID)}; PRAGMA user_version = ${String(CAPABILITY_INDEX_SCHEMA_VERSION)}; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON`);
        database.exec(SCHEMA_SQL);
        if (ranking === FTS_RANKING) {
          try {
            database.exec(FTS_SCHEMA_SQL);
          } catch {
            database.exec('DROP TABLE IF EXISTS skill_fts');
          }
        }
        const effectiveRanking = ranking === FTS_RANKING && tableExists(database, 'skill_fts')
          ? FTS_RANKING
          : TOKEN_RANKING;
        const insertMetadata = database.prepare('INSERT INTO metadata(key, value) VALUES(?, ?)');
        insertMetadata.run('schema', String(CAPABILITY_INDEX_SCHEMA_VERSION));
        insertMetadata.run('application', 'skill-loom-capability-index');
        insertMetadata.run('ranking', effectiveRanking);
        insertMetadata.run('builtAt', new Date(this.now()).toISOString());
        insertMetadata.run('roots', JSON.stringify(collection.roots.map((root) => root.directory).sort()));

        database.exec('BEGIN');
        try {
          for (const descriptor of collection.packages) {
            const indexed = await this.indexPackage(descriptor, this.maxExcerptBytes);
            if (indexed === undefined) continue;
            writeRow(database, indexed, effectiveRanking);
          }
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      } finally {
        database.close();
      }
      const info = await lstat(temporary);
      if (!info.isFile() || info.isSymbolicLink() || info.size > this.maxBytes) {
        throw new CapabilityIndexError('too_large', 'The capability index exceeds its size limit.');
      }
      await chmod(temporary, 0o600);
      await rename(temporary, this.indexPath);
      const after = await lstat(this.indexPath);
      if (!after.isFile() || after.isSymbolicLink() || Number(after.nlink) !== 1 ||
          (process.platform !== 'win32' && (Number(after.mode) & 0o077) !== 0)) {
        throw new CapabilityIndexError('unsafe', 'The capability index file is not private.');
      }
      published = true;
    } finally {
      if (!published) await rm(temporary, { force: true });
    }
  }

  private async statMatches(row: SkillRow, path: string): Promise<boolean> {
    try {
      const info = await lstat(path, { bigint: true });
      return info.isFile() && !info.isSymbolicLink() &&
        String(info.size) === row.size && String(info.mtimeNs) === row.mtime_ns &&
        String(info.ino) === row.inode;
    } catch {
      return false;
    }
  }

  private async indexPackage(
    descriptor: CapabilityPackageDescriptor,
    maxExcerptBytes: number,
    preRead?: ReadSkill,
  ): Promise<IndexedPackage | undefined> {
    const read = preRead ?? await readSkillFile(descriptor.path);
    if (read === undefined) return undefined;
    let frontmatter: ReturnType<typeof parseSkillFrontmatter>;
    try {
      frontmatter = parseSkillFrontmatter(read.content);
    } catch {
      frontmatter = { present: false, data: {}, body: read.content };
    }
    const name = frontmatterString(frontmatter.data, 'name') ??
      descriptor.fallbackName ?? basename(descriptor.packagePath);
    const description = frontmatterString(frontmatter.data, 'description') ??
      descriptor.fallbackDescription ?? '';
    const body = truncateUtf8(normalizeText(frontmatter.body), maxExcerptBytes);
    const headings = extractHeadings(frontmatter.body);
    const frontmatterText = truncateUtf8(describeFrontmatter(frontmatter.data), CAPABILITY_FRONTMATTER_BYTES);
    const extracted = extractSkillMetadata(frontmatter.data);
    const metadataText = truncateUtf8([
      ...extracted.metadata.tags,
      ...extracted.metadata.tools,
      ...extracted.metadata.inputs,
      ...extracted.metadata.outputs,
      extracted.metadata.whenToUse ?? '',
    ].join('\n'), CAPABILITY_FRONTMATTER_BYTES);
    const filePaths = truncateUtf8((await listPackageFiles(descriptor.packagePath)).join('\n'), CAPABILITY_FILE_PATHS_BYTES);
    const fingerprint = descriptor.remote?.fingerprint ?? read.fingerprint;
    const id = createSkillId({
      harness: descriptor.harness,
      source: descriptor.source,
      path: descriptor.path,
      name,
    });
    const row: SkillRow = {
      id,
      harness: descriptor.harness,
      source: descriptor.source,
      path: descriptor.path,
      package_path: descriptor.packagePath,
      root_path: descriptor.rootPath,
      project_path: descriptor.projectPath ?? null,
      source_directory: descriptor.sourceDirectory ?? null,
      name,
      description,
      frontmatter: frontmatterText,
      headings,
      body_excerpt: body,
      file_paths: filePaths,
      fingerprint,
      content_hash: read.contentHash,
      size: read.size,
      mtime_ns: read.mtimeNs,
      inode: read.inode,
      license: frontmatterString(frontmatter.data, 'license') ?? null,
      enabled: descriptor.enabled === false ? 0 : 1,
      remote_source_id: descriptor.remote?.sourceId ?? null,
      remote_revision: descriptor.remote?.revision ?? null,
      remote_repository_path: descriptor.remote?.repositoryPath ?? null,
      remote_repository: descriptor.remote?.repository ?? null,
    };
    const tokens = new Map<string, number>();
    const addTokens = (text: string, weight: number): void => {
      for (const token of tokenize(text)) {
        if (token.length > 80) continue;
        tokens.set(token, Math.max(tokens.get(token) ?? 0, weight));
      }
    };
    addTokens(name, 12);
    addTokens(description, 8);
    addTokens(frontmatterText, 4);
    addTokens(metadataText, 7);
    addTokens(headings, 6);
    addTokens(body, 3);
    addTokens(filePaths, 2);
    return {
      row,
      tokens: [...tokens].map(([token, weight]) => ({ token, weight })),
      metadata: extracted.metadata,
      metadataIssues: extracted.issues,
      metadataText,
    };
  }

  private assertOpen(): void {
    if (this.closed) throw new CapabilityIndexError('error', 'The capability index is closed.');
  }
}

const SCHEMA_SQL = `
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  harness TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  package_path TEXT NOT NULL,
  root_path TEXT NOT NULL,
  project_path TEXT,
  source_directory TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  frontmatter TEXT NOT NULL,
  headings TEXT NOT NULL,
  body_excerpt TEXT NOT NULL,
  file_paths TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size TEXT NOT NULL,
  mtime_ns TEXT NOT NULL,
  inode TEXT NOT NULL,
  license TEXT,
  enabled INTEGER NOT NULL,
  remote_source_id TEXT,
  remote_revision TEXT,
  remote_repository_path TEXT,
  remote_repository TEXT
);
CREATE INDEX skills_harness_path ON skills(harness, path);
CREATE TABLE capabilities (
  skill_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (skill_id, kind, value)
);
CREATE TABLE skill_tokens (
  skill_id TEXT NOT NULL,
  token TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (skill_id, token)
);
CREATE INDEX skill_tokens_token ON skill_tokens(token);
`;

const FTS_SCHEMA_SQL = `
CREATE VIRTUAL TABLE skill_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  frontmatter,
  headings,
  body_excerpt,
  file_paths,
  metadata,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

function writeRow(database: DatabaseSync, indexed: IndexedPackage, ranking: CapabilityRanking): void {
  const { row } = indexed;
  database.prepare(`
    INSERT INTO skills (
      id, harness, source, path, package_path, root_path, project_path, source_directory,
      name, description, frontmatter, headings, body_excerpt, file_paths,
      fingerprint, content_hash, size, mtime_ns, inode, license, enabled,
      remote_source_id, remote_revision, remote_repository_path, remote_repository
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      harness = excluded.harness, source = excluded.source, path = excluded.path,
      package_path = excluded.package_path, root_path = excluded.root_path,
      project_path = excluded.project_path, source_directory = excluded.source_directory,
      name = excluded.name, description = excluded.description, frontmatter = excluded.frontmatter,
      headings = excluded.headings, body_excerpt = excluded.body_excerpt, file_paths = excluded.file_paths,
      fingerprint = excluded.fingerprint, content_hash = excluded.content_hash,
      size = excluded.size, mtime_ns = excluded.mtime_ns, inode = excluded.inode,
      license = excluded.license, enabled = excluded.enabled,
      remote_source_id = excluded.remote_source_id, remote_revision = excluded.remote_revision,
      remote_repository_path = excluded.remote_repository_path, remote_repository = excluded.remote_repository
  `).run(
    row.id, row.harness, row.source, row.path, row.package_path, row.root_path, row.project_path,
    row.source_directory, row.name, row.description, row.frontmatter, row.headings, row.body_excerpt,
    row.file_paths, row.fingerprint, row.content_hash, row.size, row.mtime_ns, row.inode, row.license,
    row.enabled, row.remote_source_id, row.remote_revision, row.remote_repository_path,
    row.remote_repository,
  );
  if (ranking === FTS_RANKING) {
    database.prepare('DELETE FROM skill_fts WHERE id = ?').run(row.id);
    database.prepare(
      'INSERT INTO skill_fts (id, name, description, frontmatter, headings, body_excerpt, file_paths, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id, row.name, row.description, row.frontmatter, row.headings, row.body_excerpt,
      row.file_paths, indexed.metadataText,
    );
  }
  database.prepare('DELETE FROM skill_tokens WHERE skill_id = ?').run(row.id);
  const insertToken = database.prepare(
    'INSERT INTO skill_tokens(skill_id, token, weight) VALUES(?, ?, ?) ON CONFLICT(skill_id, token) DO UPDATE SET weight = MAX(weight, excluded.weight)',
  );
  for (const token of indexed.tokens) insertToken.run(row.id, token.token, token.weight);
  database.prepare('DELETE FROM capabilities WHERE skill_id = ?').run(row.id);
  const insertCapability = database.prepare(
    'INSERT INTO capabilities(skill_id, kind, value, ordinal) VALUES(?, ?, ?, ?) ON CONFLICT(skill_id, kind, value) DO NOTHING',
  );
  const { metadata } = indexed;
  for (const [kind, values] of [
    ['tag', metadata.tags],
    ['tool', metadata.tools],
    ['input', metadata.inputs],
    ['output', metadata.outputs],
  ] as const) {
    values.forEach((value, ordinal) => insertCapability.run(row.id, kind, value, ordinal));
  }
  if (metadata.whenToUse !== undefined) insertCapability.run(row.id, 'when_to_use', metadata.whenToUse, 0);
  indexed.metadataIssues.forEach((issue, ordinal) =>
    insertCapability.run(row.id, 'metadata_issue', issue, ordinal));
}

function descriptorMatchesRow(row: SkillRow, descriptor: CapabilityPackageDescriptor): boolean {
  const remote = descriptor.remote;
  return row.source === descriptor.source &&
    row.root_path === descriptor.rootPath &&
    row.project_path === (descriptor.projectPath ?? null) &&
    row.source_directory === (descriptor.sourceDirectory ?? null) &&
    row.enabled === (descriptor.enabled === false ? 0 : 1) &&
    row.remote_source_id === (remote?.sourceId ?? null) &&
    row.remote_revision === (remote?.revision ?? null) &&
    row.remote_repository_path === (remote?.repositoryPath ?? null) &&
    row.remote_repository === (remote?.repository ?? null) &&
    (remote?.fingerprint === undefined || row.fingerprint === remote.fingerprint);
}

function deleteRow(database: DatabaseSync, id: string): void {
  database.prepare('DELETE FROM skill_fts WHERE id = ?').run(id);
  database.prepare('DELETE FROM skill_tokens WHERE skill_id = ?').run(id);
  database.prepare('DELETE FROM capabilities WHERE skill_id = ?').run(id);
  database.prepare('DELETE FROM skills WHERE id = ?').run(id);
}

interface CandidateMetadata {
  metadata: SkillMetadata;
  issues: string[];
}

function toCandidate(
  row: SkillRow,
  terms: readonly string[],
  extra?: CandidateMetadata,
): CapabilityCandidate {
  return {
    id: row.id,
    harness: row.harness as SkillHarness,
    source: row.source as SkillSource,
    name: row.name,
    description: row.description,
    path: row.path,
    packagePath: row.package_path,
    rootPath: row.root_path,
    ...(row.project_path === null ? {} : { projectPath: row.project_path }),
    ...(row.source_directory === null ? {} : { sourceDirectory: row.source_directory }),
    enabled: row.enabled === 1,
    score: Math.round(((row as SkillRow & { rank?: number }).rank ?? 0) * 1000) / 1000,
    snippet: makeSnippet(row, terms),
    fingerprint: row.fingerprint,
    ...(row.remote_source_id === null ? {} : { sourceId: row.remote_source_id }),
    ...(row.remote_revision === null ? {} : { revision: row.remote_revision }),
    ...(row.remote_repository_path === null ? {} : { repositoryPath: row.remote_repository_path }),
    ...(row.remote_repository === null ? {} : { repository: row.remote_repository }),
    ...(extra === undefined ? {} : { metadata: extra.metadata }),
    ...(extra === undefined || extra.issues.length === 0 ? {} : { metadataIssues: extra.issues }),
  };
}

function makeSnippet(row: SkillRow, terms: readonly string[]): string {
  const fields = [row.body_excerpt, row.headings, row.description, row.frontmatter, row.file_paths];
  let source = '';
  let index = -1;
  const lowered = terms.map((term) => term.toLocaleLowerCase('en-US'));
  for (const field of fields) {
    if (field.trim() === '') continue;
    if (source === '') source = field;
    const haystack = field.toLocaleLowerCase('en-US');
    for (const term of lowered) {
      const found = haystack.indexOf(term);
      if (found !== -1 && (index === -1 || found < index)) {
        source = field;
        index = found;
      }
    }
    if (index !== -1) break;
  }
  if (source === '') source = `${row.name} ${row.description}`.trim();
  if (index === -1) index = 0;
  const windowStart = Math.max(0, index - 60);
  const windowEnd = Math.min(source.length, windowStart + CAPABILITY_MAX_SNIPPET_CHARS);
  const text = source.slice(windowStart, windowEnd).replace(/\s+/gu, ' ').trim();
  return `${windowStart > 0 ? '…' : ''}${text}${windowEnd < source.length ? '…' : ''}`;
}

async function readSkillFile(path: string): Promise<ReadSkill | undefined> {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(CAPABILITY_MAX_SKILL_FILE_BYTES)) {
      return undefined;
    }
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.size !== before.size || opened.size > BigInt(CAPABILITY_MAX_SKILL_FILE_BYTES)) {
      return undefined;
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let read = 0;
    while (read < bytes.length) {
      const result = await handle.read(bytes, read, bytes.length - read, read);
      if (result.bytesRead === 0) break;
      read += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (read !== bytes.length || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs) return undefined;
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    }
    return {
      content,
      fingerprint: createHash('sha256')
        .update('skill-loom-capability-index-v1\0')
        .update(path, 'utf8')
        .update('\0')
        .update(bytes)
        .digest('hex'),
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      size: String(opened.size),
      mtimeNs: String(opened.mtimeNs),
      inode: String(opened.ino),
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

async function listPackageFiles(packagePath: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, prefix: string, depth: number): Promise<void> {
    if (files.length >= CAPABILITY_MAX_FILE_PATHS || depth > 8) return;
    let dirents: Dirent[];
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of dirents) {
      if (files.length >= CAPABILITY_MAX_FILE_PATHS) return;
      if (entry.isSymbolicLink()) continue;
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        await visit(join(directory, entry.name), relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase() : '';
      if (extension !== '' && !INDEXED_EXTENSIONS.has(extension)) continue;
      files.push(relativePath);
    }
  }
  await visit(packagePath, '', 0);
  return files;
}

function extractHeadings(body: string): string {
  const headings: string[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/u)) {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || headings.length >= MAX_HEADINGS) continue;
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (match?.[1] !== undefined) headings.push(truncateUtf8(match[1], MAX_HEADING_CHARS));
  }
  return headings.join('\n');
}

function describeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const visit = (prefix: string, value: unknown, depth: number): void => {
    if (lines.length >= 200 || depth > 3) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${prefix}: ${String(value)}`);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) visit(prefix, item, depth + 1);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0)) {
        visit(prefix === '' ? key : `${prefix}.${key}`, item, depth + 1);
      }
    }
  };
  for (const [key, value] of Object.entries(data).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0)) {
    visit(key, value, 0);
  }
  return lines.join('\n');
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/\0/gu, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) {
    end -= Math.max(1, Math.floor(end / 20));
  }
  return value.slice(0, end);
}

function normalizeQuery(value: string | undefined): string {
  const trimmed = (value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  return trimmed.slice(0, CAPABILITY_MAX_QUERY_LENGTH);
}

function queryTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const token of tokenize(query)) {
    if (token.length === 0 || token.length > 80 || seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= CAPABILITY_MAX_QUERY_TERMS) break;
  }
  return terms;
}

function tokenize(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export interface NormalizedCapabilityFilters {
  sources: SkillSource[];
  enabled: boolean;
  tags: string[];
  tools: string[];
  inputs: string[];
  outputs: string[];
  hasTags?: boolean;
  hasTools?: boolean;
  hasInputs?: boolean;
  hasOutputs?: boolean;
}

export function normalizeCapabilityFilters(request: CapabilitySearchFilters): NormalizedCapabilityFilters {
  const sources = [...new Set(request.sources ?? [])]
    .filter((source): source is SkillSource => (SKILL_SOURCES as readonly string[]).includes(source));
  return {
    sources,
    enabled: request.enabled !== false,
    tags: normalizeFilterValues(request.tags),
    tools: normalizeFilterValues(request.tools),
    inputs: normalizeFilterValues(request.inputs),
    outputs: normalizeFilterValues(request.outputs),
    ...(typeof request.hasTags === 'boolean' ? { hasTags: request.hasTags } : {}),
    ...(typeof request.hasTools === 'boolean' ? { hasTools: request.hasTools } : {}),
    ...(typeof request.hasInputs === 'boolean' ? { hasInputs: request.hasInputs } : {}),
    ...(typeof request.hasOutputs === 'boolean' ? { hasOutputs: request.hasOutputs } : {}),
  };
}

function normalizeFilterValues(values: readonly string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const normalized = value
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, CAPABILITY_MAX_FILTER_VALUE_LENGTH)
      .toLocaleLowerCase('en-US');
    if (normalized === '' || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= CAPABILITY_MAX_FILTER_VALUES) break;
  }
  return result;
}

export function hasMetadataFilters(filters: CapabilitySearchFilters): boolean {
  return (filters.tags?.length ?? 0) > 0 || (filters.tools?.length ?? 0) > 0 ||
    (filters.inputs?.length ?? 0) > 0 || (filters.outputs?.length ?? 0) > 0 ||
    typeof filters.hasTags === 'boolean' || typeof filters.hasTools === 'boolean' ||
    typeof filters.hasInputs === 'boolean' || typeof filters.hasOutputs === 'boolean';
}

function buildFilter(
  request: Required<Pick<CapabilityIndexQuery, 'harness' | 'projectPath'>>,
  filters: NormalizedCapabilityFilters,
): { sql: string; bindings: Array<string | number> } {
  const clauses = [
    's.harness = ?',
    's.enabled = ?',
    `(s.source <> 'project' OR s.project_path = ?)`,
  ];
  const bindings: Array<string | number> = [
    request.harness,
    filters.enabled ? 1 : 0,
    request.projectPath,
  ];
  if (filters.sources.length > 0) {
    clauses.push(`s.source IN (${filters.sources.map(() => '?').join(', ')})`);
    bindings.push(...filters.sources);
  }
  for (const [kind, values] of [
    ['tag', filters.tags],
    ['tool', filters.tools],
    ['input', filters.inputs],
    ['output', filters.outputs],
  ] as const) {
    for (const value of values) {
      clauses.push(
        'EXISTS (SELECT 1 FROM capabilities c WHERE c.skill_id = s.id AND c.kind = ? AND lower(c.value) = ?)',
      );
      bindings.push(kind, value);
    }
  }
  for (const [kind, presence] of [
    ['tag', filters.hasTags],
    ['tool', filters.hasTools],
    ['input', filters.hasInputs],
    ['output', filters.hasOutputs],
  ] as const) {
    if (presence === undefined) continue;
    clauses.push(
      `${presence ? 'EXISTS' : 'NOT EXISTS'} (
        SELECT 1 FROM capabilities c WHERE c.skill_id = s.id AND c.kind = ?
      )`,
    );
    bindings.push(kind);
  }
  return { sql: clauses.join(' AND '), bindings };
}

function readCoverage(
  database: DatabaseSync,
  filter: string,
  bindings: Array<string | number>,
): CapabilityMetadataCoverage {
  const row = database.prepare(`
    SELECT
      count(*) AS total,
      sum(CASE WHEN s.description <> '' THEN 1 ELSE 0 END) AS with_description,
      sum(CASE WHEN s.headings <> '' THEN 1 ELSE 0 END) AS with_headings,
      sum(CASE WHEN EXISTS (SELECT 1 FROM capabilities c WHERE c.skill_id = s.id AND c.kind = 'tag') THEN 1 ELSE 0 END) AS with_tags,
      sum(CASE WHEN EXISTS (SELECT 1 FROM capabilities c WHERE c.skill_id = s.id AND c.kind = 'tool') THEN 1 ELSE 0 END) AS with_tools,
      sum(CASE WHEN EXISTS (SELECT 1 FROM capabilities c WHERE c.skill_id = s.id AND c.kind = 'input') THEN 1 ELSE 0 END) AS with_inputs,
      sum(CASE WHEN EXISTS (SELECT 1 FROM capabilities c WHERE c.skill_id = s.id AND c.kind = 'output') THEN 1 ELSE 0 END) AS with_outputs,
      sum(CASE WHEN EXISTS (SELECT 1 FROM capabilities c WHERE c.skill_id = s.id AND c.kind = 'when_to_use') THEN 1 ELSE 0 END) AS with_when_to_use,
      sum(CASE WHEN EXISTS (SELECT 1 FROM capabilities c WHERE c.skill_id = s.id AND c.kind = 'metadata_issue') THEN 1 ELSE 0 END) AS with_issues,
      sum(CASE WHEN NOT EXISTS (
        SELECT 1 FROM capabilities c WHERE c.skill_id = s.id
          AND c.kind IN ('tag', 'tool', 'input', 'output', 'when_to_use')
      ) THEN 1 ELSE 0 END) AS without_structured_metadata
    FROM skills s WHERE ${filter}
  `).get(...bindings) as Record<string, unknown> | undefined;
  const value = (name: string): number => {
    const number = row?.[name];
    return typeof number === 'number' ? number : typeof number === 'bigint' ? Number(number) : 0;
  };
  return {
    total: value('total'),
    withDescription: value('with_description'),
    withHeadings: value('with_headings'),
    withTags: value('with_tags'),
    withTools: value('with_tools'),
    withInputs: value('with_inputs'),
    withOutputs: value('with_outputs'),
    withWhenToUse: value('with_when_to_use'),
    withIssues: value('with_issues'),
    withoutStructuredMetadata: value('without_structured_metadata'),
  };
}

function readFacets(
  database: DatabaseSync,
  filter: string,
  bindings: Array<string | number>,
): CapabilityMetadataFacets {
  const facets: CapabilityMetadataFacets = {
    tags: [], tools: [], inputs: [], outputs: [],
  };
  const kinds = [
    ['tag', facets.tags],
    ['tool', facets.tools],
    ['input', facets.inputs],
    ['output', facets.outputs],
  ] as const;
  for (const [kind, target] of kinds) {
    const rows = database.prepare(`
      SELECT min(cap.value) AS value, count(*) AS count
      FROM skills s
      JOIN capabilities cap ON cap.skill_id = s.id
      WHERE cap.kind = ? AND ${filter}
      GROUP BY lower(cap.value)
      ORDER BY count DESC, value COLLATE NOCASE
      LIMIT ?
    `).all(kind, ...bindings, CAPABILITY_MAX_FACET_VALUES) as unknown as Array<{
      value: unknown;
      count: unknown;
    }>;
    for (const row of rows) {
      if (typeof row.value !== 'string') continue;
      const count = typeof row.count === 'number'
        ? row.count
        : typeof row.count === 'bigint' ? Number(row.count) : 0;
      if (count > 0) target.push({ value: row.value, count });
    }
  }
  return facets;
}

function readCandidateMetadata(
  database: DatabaseSync,
  ids: readonly string[],
): Map<string, CandidateMetadata> {
  const result = new Map<string, CandidateMetadata>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = database.prepare(
    `SELECT skill_id, kind, value FROM capabilities WHERE skill_id IN (${placeholders}) ORDER BY skill_id, kind, ordinal, value COLLATE NOCASE`,
  ).all(...ids) as unknown as Array<{ skill_id: string; kind: string; value: string }>;
  for (const row of rows) {
    if (typeof row.skill_id !== 'string' || typeof row.kind !== 'string' || typeof row.value !== 'string') continue;
    let entry = result.get(row.skill_id);
    if (entry === undefined) {
      entry = { metadata: { tags: [], tools: [], inputs: [], outputs: [] }, issues: [] };
      result.set(row.skill_id, entry);
    }
    switch (row.kind) {
      case 'tag': entry.metadata.tags.push(row.value); break;
      case 'tool': entry.metadata.tools.push(row.value); break;
      case 'input': entry.metadata.inputs.push(row.value); break;
      case 'output': entry.metadata.outputs.push(row.value); break;
      case 'when_to_use': entry.metadata.whenToUse = row.value; break;
      case 'metadata_issue': entry.issues.push(row.value); break;
    }
  }
  for (const [id, entry] of result) {
    if (entry.metadata.tags.length === 0 && entry.metadata.tools.length === 0 &&
        entry.metadata.inputs.length === 0 && entry.metadata.outputs.length === 0 &&
        entry.metadata.whenToUse === undefined && entry.issues.length === 0) {
      result.delete(id);
    }
  }
  return result;
}

function sourceOrderSql(): string {
  return `CASE s.source
    WHEN 'project' THEN 0 WHEN 'personal' THEN 1 WHEN 'custom' THEN 2
    WHEN 'plugin' THEN 3 WHEN 'builtin' THEN 4 WHEN 'loom-extra' THEN 5 WHEN 'remote' THEN 6
    ELSE 7 END,`;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return CAPABILITY_DEFAULT_RESULTS;
  return Math.min(CAPABILITY_MAX_RESULTS, Math.max(1, Math.floor(value)));
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(CAPABILITY_MAX_OFFSET, Math.max(0, Math.floor(value)));
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function pragmaNumber(database: DatabaseSync, name: string): number | undefined {
  const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  const value = row === undefined ? undefined : Object.values(row)[0];
  return typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : undefined;
}

function scalarNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const row = value as Record<string, unknown>;
  const number = Object.values(row)[0];
  return typeof number === 'number' ? number : typeof number === 'bigint' ? Number(number) : undefined;
}

function readMetadata(database: DatabaseSync): Map<string, string> {
  const metadata = new Map<string, string>();
  for (const row of database.prepare('SELECT key, value FROM metadata').all() as unknown as Array<{ key: string; value: string }>) {
    if (typeof row.key === 'string' && typeof row.value === 'string') metadata.set(row.key, row.value);
  }
  return metadata;
}

async function detectsFts5(): Promise<CapabilityRanking> {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec("CREATE VIRTUAL TABLE probe USING fts5(value, tokenize = 'unicode61 remove_diacritics 2')");
    return FTS_RANKING;
  } catch {
    return TOKEN_RANKING;
  } finally {
    database.close();
  }
}

function tableExists(database: DatabaseSync, table: string): boolean {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row !== undefined;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(directory);
  if (canonical !== resolve(directory)) {
    throw new CapabilityIndexError('unsafe', 'The capability index directory is not canonical.');
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new CapabilityIndexError('unsafe', 'The capability index directory is unsafe.');
  }
}

async function pathMissing(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    return errnoCode(error) === 'ENOENT';
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isFile() || info.isSymbolicLink()) await unlink(path);
  } catch {
    // A missing index is already disposed.
  }
}

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function packageWarning(
  descriptor: CapabilityPackageDescriptor,
  code: CatalogWarning['code'],
  message: string,
): CatalogWarning {
  return {
    code,
    message,
    harness: descriptor.harness,
    source: descriptor.source,
    path: descriptor.path,
  };
}

export interface CapabilitySearchService {
  readonly enabled: boolean;
  search(request: CapabilityIndexQuery): Promise<CapabilitySearchResponse>;
  rebuild(collection: CapabilityCollection): Promise<void>;
  dispose(options?: { deleteIndex?: boolean }): Promise<void>;
}

export interface CapabilitySearchServiceOptions {
  /** Disabled by default; Phase 2 turns this on explicitly. */
  enabled?: boolean;
  index: CapabilityIndexOptions;
  sources: (request: Required<Pick<CapabilityIndexQuery, 'harness' | 'projectPath'>>) => Promise<CapabilityCollection> | CapabilityCollection;
  fallback: CapabilityFallback;
}

/**
 * A guarded query surface. The existing fresh scan is always the fallback: a
 * disabled, missing, corrupt, unsafe, unsupported, or too-large index must
 * never hide a skill.
 */
export function createCapabilitySearchService(
  options: CapabilitySearchServiceOptions,
): CapabilitySearchService {
  const enabled = options.enabled === true;
  let index: CapabilityIndex | undefined;
  const getIndex = (): CapabilityIndex => index ??= new CapabilityIndex(options.index);

  return {
    enabled,
    async search(request) {
      const started = performance.now();
      const filters = normalizeCapabilityFilters(request);
      const normalized = {
        harness: request.harness,
        projectPath: request.projectPath,
        ...filters,
        query: normalizeQuery(request.query),
        offset: normalizeOffset(request.offset),
        limit: normalizeLimit(request.limit),
      };
      if (!enabled) return withFallback(started, options.fallback, normalized, 'disabled');
      let collection: CapabilityCollection;
      try {
        collection = await options.sources({
          harness: normalized.harness,
          projectPath: normalized.projectPath,
        });
      } catch {
        return withFallback(started, options.fallback, normalized, 'error');
      }
      if (collection.roots.length === 0 && collection.packages.length === 0) {
        return withFallback(started, options.fallback, normalized, 'uncovered');
      }
      const capabilityIndex = (() => {
        try {
          return getIndex();
        } catch {
          return undefined;
        }
      })();
      if (capabilityIndex === undefined) {
        return withFallback(started, options.fallback, normalized, 'error');
      }
      let validation: CapabilityIndexValidation;
      try {
        validation = await capabilityIndex.validate();
      } catch {
        return withFallback(started, options.fallback, normalized, 'error');
      }
      if (!validation.ok) {
        const reason = validation.reason ?? 'error';
        if (reason !== 'unsafe') {
          try {
            await capabilityIndex.rebuild(collection);
          } catch {
            // The fallback is authoritative; a failed rebuild is reported by the next query.
          }
        }
        return withFallback(started, options.fallback, normalized, reason);
      }
      try {
        const warnings = await capabilityIndex.refresh(collection);
        const result = await capabilityIndex.search(normalized);
        return {
          ...result,
          warnings,
          elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        };
      } catch (error) {
        const reason = error instanceof CapabilityIndexError ? error.code : 'error';
        return withFallback(started, options.fallback, normalized, reason);
      }
    },
    async rebuild(collection) {
      await getIndex().rebuild(collection);
    },
    async dispose(disposeOptions = {}) {
      await index?.dispose(disposeOptions);
    },
  };
}

async function withFallback(
  started: number,
  fallback: CapabilityFallback,
  request: {
    harness: SkillHarness;
    projectPath: string;
    query: string;
    offset: number;
    limit: number;
  } & NormalizedCapabilityFilters,
  reason: CapabilityFallbackReason,
): Promise<CapabilitySearchResponse> {
  const response = await fallback(request);
  const warnings: CatalogWarning[] = [
    ...response.warnings,
    {
      code: 'CAPABILITY_INDEX_FALLBACK',
      message: 'The derived capability index was not used; the fresh catalog scan supplied these candidates.',
      harness: request.harness,
      reason: reason.toUpperCase(),
    },
  ];
  if (hasMetadataFilters(request)) {
    warnings.push({
      code: 'METADATA_FILTER_UNSUPPORTED',
      message: 'Metadata filters were not applied because the fresh catalog scan answered this request.',
      harness: request.harness,
      reason: 'SCAN_FALLBACK',
    });
  }
  return {
    ...response,
    mode: 'scan',
    reason,
    query: request.query,
    offset: request.offset,
    limit: request.limit,
    elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    warnings,
  };
}

/**
 * Adapt the existing catalog service into the capability fallback. The result
 * keeps the legacy name/description substring filter and deterministic source
 * order; it never claims to be an indexed result.
 */
export function catalogCapabilityFallback(catalog: CatalogService): CapabilityFallback {
  return async (request) => {
    const started = performance.now();
    const response = await catalog.getCatalog({
      projectPath: request.projectPath,
      harness: request.harness,
      query: request.query,
    });
    const sources = request.sources ?? [];
    const enabled = request.enabled !== false;
    const entries = response.groups.flatMap((group) => group.entries)
      .filter((entry) => (sources.length === 0 || sources.includes(entry.source)) && entry.enabled === enabled);
    const candidates = entries
      .slice(request.offset, request.offset + request.limit)
      .map((entry) => entryToCandidate(entry));
    return {
      mode: 'scan',
      harness: request.harness,
      query: response.query,
      total: entries.length,
      offset: request.offset,
      limit: request.limit,
      nextOffset: request.offset + candidates.length < entries.length ? request.offset + candidates.length : null,
      candidates,
      warnings: response.warnings,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    };
  };
}

function entryToCandidate(entry: SkillEntry): CapabilityCandidate {
  const remote = entry[REMOTE_SNAPSHOT_CONTENT];
  return {
    id: entry.id,
    harness: entry.harness,
    source: entry.source,
    name: entry.name,
    description: entry.description,
    path: entry.path,
    packagePath: entry.packagePath,
    rootPath: entry.sourceDirectory ?? entry.packagePath,
    ...(entry.sourceDirectory === undefined ? {} : { sourceDirectory: entry.sourceDirectory }),
    enabled: entry.enabled,
    score: 0,
    snippet: makeSnippet({
      id: entry.id,
      harness: entry.harness,
      source: entry.source,
      path: entry.path,
      package_path: entry.packagePath,
      root_path: entry.sourceDirectory ?? entry.packagePath,
      project_path: null,
      source_directory: entry.sourceDirectory ?? null,
      name: entry.name,
      description: entry.description,
      frontmatter: '',
      headings: '',
      body_excerpt: '',
      file_paths: '',
      fingerprint: remote?.fingerprint ?? '',
      content_hash: '',
      size: '0',
      mtime_ns: '0',
      inode: '0',
      license: null,
      enabled: entry.enabled ? 1 : 0,
      remote_source_id: entry.sourceId ?? null,
      remote_revision: entry.revision ?? null,
      remote_repository_path: entry.repositoryPath ?? null,
      remote_repository: entry.repository ?? null,
    }, []),
    fingerprint: remote?.fingerprint ?? '',
    ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
    ...(entry.revision === undefined ? {} : { revision: entry.revision }),
    ...(entry.repositoryPath === undefined ? {} : { repositoryPath: entry.repositoryPath }),
    ...(entry.repository === undefined ? {} : { repository: entry.repository }),
  };
}
