import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  installedExecutableFlag,
  readInstalledModeIndex,
  type InstalledModeIndex,
} from '../../portable/installed-modes.js';
import {
  BundleError,
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_FILES,
  MAX_BUNDLE_SKILLS,
  validatePackagePath,
} from '../../portable/bundle.js';
import type { BundleSkill } from '../../shared/bundles.js';
import {
  CATALOG_COPY_ERROR_CODES,
  CatalogCopyError,
  MAX_SKILL_PACKAGE_BYTES,
  MAX_SKILL_PACKAGE_FILES,
  copySkillIntoProject,
  projectSkillRootFor,
  safePackageName,
} from './copy.js';
import type { CatalogService } from './merge.js';
import { snapshotPackageFingerprint, snapshotReviewFingerprint } from './snapshot-fingerprint.js';
import {
  REMOTE_SNAPSHOT_CONTENT,
  type CatalogWarning,
  type SkillEntry,
  type SkillHarness,
  type SkillSource,
} from './types.js';
import type { Chain } from '../chains/model.js';

/**
 * Review and install a catalog skill package into the project's shared
 * `.agents/skills/` root.
 *
 * Review is read-only. It re-resolves the candidate through a fresh catalog
 * discovery pass, walks the package with the same bounds and symlink refusals
 * as the copy layer, and returns a digest over the exact package inventory and
 * destination. Install repeats that review and rejects a changed package, a
 * stale digest, or an existing destination. There is no name suffixing and no
 * overwrite.
 */

export const SKILL_INSTALL_ERROR_CODES = {
  CANDIDATE_NOT_FOUND: 'SKILL_INSTALL_CANDIDATE_NOT_FOUND',
  CANDIDATE_CHANGED: 'SKILL_INSTALL_CANDIDATE_CHANGED',
  DESTINATION_CONFLICT: 'SKILL_INSTALL_DESTINATION_CONFLICT',
  REVIEW_STALE: 'SKILL_INSTALL_REVIEW_STALE',
  SOURCE_UNSUPPORTED: 'SKILL_INSTALL_SOURCE_UNSUPPORTED',
  CHAIN_APPLY_FAILED: 'SKILL_CHAIN_APPLY_FAILED',
} as const;

export type SkillInstallErrorCode =
  (typeof SKILL_INSTALL_ERROR_CODES)[keyof typeof SKILL_INSTALL_ERROR_CODES];

export class CatalogInstallError extends Error {
  readonly code: SkillInstallErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: SkillInstallErrorCode,
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

const MAX_COPY_DEPTH = 32;
const MAX_PACKAGE_ENTRIES = MAX_SKILL_PACKAGE_FILES * (MAX_COPY_DEPTH + 1);
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:\..*)?$/i;

export interface SkillInstallCandidate {
  /** Stable catalog entry id. */
  id: string;
  source: SkillSource;
  /**
   * Optional identity check. A local candidate uses the derived capability
   * index fingerprint; a remote candidate uses the pinned snapshot
   * fingerprint. The review rejects a package that no longer matches.
   */
  fingerprint?: string | undefined;
  sourceId?: string | undefined;
  revision?: string | undefined;
  repositoryPath?: string | undefined;
}

export interface SkillInstallReviewRequest {
  projectId: string;
  /** Canonical project directory resolved by the control server. */
  projectPath: string;
  harness: SkillHarness;
  candidate: SkillInstallCandidate;
  /** Exact destination directory name; defaults to a slug of the skill name. */
  destinationName?: string | undefined;
}

export interface SkillInstallRequest extends SkillInstallReviewRequest {
  reviewDigest: string;
}

export interface SkillPackageFile {
  path: string;
  bytes: number;
  executable: boolean;
  sha256: string;
}

export interface SelectedCatalogSkill {
  id: string;
  fingerprint: string;
}

export interface SkillInstallReview {
  project: { id: string; path: string };
  harness: SkillHarness;
  candidate: {
    id: string;
    name: string;
    description: string;
    source: SkillSource;
    sourceId: string | null;
    repository: string | null;
    revision: string | null;
    repositoryPath: string | null;
    /** Full-package fingerprint of the reviewed contents. */
    fingerprint: string;
    /** True when the global package will diverge from its project-local copy. */
    personalSource: boolean;
  };
  destination: {
    root: string;
    name: string;
    path: string;
    conflict: 'EXISTS' | null;
  };
  files: SkillPackageFile[];
  directories: string[];
  totalFiles: number;
  totalBytes: number;
  licenseFiles: string[];
  warnings: CatalogWarning[];
  reviewDigest: string;
  elapsedMs: number;
}

export interface SkillInstallResult {
  name: string;
  source: SkillSource;
  destinationPath: string;
  fingerprint: string;
  totalFiles: number;
  totalBytes: number;
}

interface WalkedFile extends SkillPackageFile {
  content: Buffer;
}

interface WalkedPackage {
  files: WalkedFile[];
  directories: string[];
  totalBytes: number;
}

interface InstallOptions {
  catalogService: CatalogService;
}

export interface ApplyChainSkillsRequest {
  projectId: string;
  projectPath: string;
  chain: Pick<Chain, 'harness' | 'steps'>;
}

/**
 * Copy the chain's current global packages into the project's shared skill
 * root. Package names are the chain's stable reference for this catalog model;
 * ambiguous or missing names fail rather than selecting a different package.
 */
export async function applyChainSkillsToProject(
  options: InstallOptions,
  request: ApplyChainSkillsRequest,
): Promise<{
  projectId: string;
  installed: Array<{
    name: string;
    source: SkillSource;
    destinationPath: string;
    fingerprint: string;
  }>;
}> {
  const selected = await resolveChainSkillEntries(options, request);

  const installed: Array<{
    name: string;
    source: SkillSource;
    destinationPath: string;
    fingerprint: string;
  }> = [];
  for (const entry of selected) {
    let copied;
    try {
      copied = await copySkillIntoProject({
        projectPath: request.projectPath,
        harness: request.chain.harness,
        entry,
        destinationName: safePackageName(entry.name),
        allowNameSuffix: false,
      });
    } catch (error) {
      throw new CatalogInstallError(
        SKILL_INSTALL_ERROR_CODES.CHAIN_APPLY_FAILED,
        'Applying the chain stopped while copying its skills; earlier packages remain installed.',
        {
          projectId: request.projectId,
          failedSkill: entry.name,
          installed: installed.map((skill) => ({
            name: skill.name,
            destinationPath: skill.destinationPath,
          })),
          causeCode: error instanceof CatalogCopyError ? error.code : 'UNKNOWN',
        },
        { cause: error },
      );
    }
    installed.push(copied);
  }
  return { projectId: request.projectId, installed };
}

export async function exportChainSkillsForClient(
  options: InstallOptions,
  request: ApplyChainSkillsRequest,
): Promise<{
  format: 'skill-loom-project-skills';
  version: 1;
  skills: BundleSkill[];
}> {
  const selected = await resolveChainSkillEntries(options, request);
  if (selected.length > MAX_BUNDLE_SKILLS) {
    throw new BundleError('BUNDLE_TOO_LARGE', `Client transfers are limited to ${MAX_BUNDLE_SKILLS} skill packages.`);
  }

  const skills: BundleSkill[] = [];
  const directories = new Set<string>();
  const budget = { bytes: 0, files: 0 };
  for (const entry of selected) {
    const directory = safePackageName(entry.name);
    if (directories.has(directory.toLowerCase())) {
      throw new BundleError('BUNDLE_INVALID', 'The chain contains skill names that map to the same project directory.');
    }
    directories.add(directory.toLowerCase());
    if (entry.packagePath.trim() === '') {
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The package for skill "${entry.name}" is unavailable.`);
    }

    try {
      const info = await lstat(entry.packagePath);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(entry.packagePath) !== entry.packagePath) {
        throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The package for skill "${entry.name}" is not a real directory.`);
      }
      const walked = await walkPackage(entry.packagePath);
      if (!walked.files.some((file) => file.path === 'SKILL.md')) {
        throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The package for skill "${entry.name}" has no SKILL.md.`);
      }
      const files = walked.files.map((file) => {
        validatePackagePath(file.path);
        budget.bytes += file.bytes;
        budget.files += 1;
        if (budget.bytes > MAX_BUNDLE_BYTES || budget.files > MAX_BUNDLE_FILES) {
          throw new BundleError('BUNDLE_TOO_LARGE', 'Client transfers are limited to 20 MiB and 2,000 files.');
        }
        return {
          path: file.path,
          content: file.content.toString('base64'),
          executable: file.executable,
        };
      });
      skills.push({ name: entry.name, directory, files });
    } catch (error) {
      if (error instanceof BundleError || error instanceof CatalogInstallError) throw error;
      throw new BundleError(
        'BUNDLE_SOURCE_UNAVAILABLE',
        `The package for skill "${entry.name}" could not be exported.`,
      );
    }
  }
  return { format: 'skill-loom-project-skills', version: 1, skills };
}

/** Export exact, reviewed host-global catalog entries for a client-local copy. */
export async function exportSelectedCatalogSkillsForClient(
  options: InstallOptions,
  request: {
    projectId: string;
    projectPath: string;
    harness: SkillHarness;
    selections: SelectedCatalogSkill[];
  },
): Promise<{
  format: 'skill-loom-project-skills';
  version: 2;
  skills: Array<BundleSkill & { id: string; fingerprint: string }>;
}> {
  if (request.selections.length > MAX_BUNDLE_SKILLS) {
    throw new BundleError('BUNDLE_TOO_LARGE', `Client transfers are limited to ${MAX_BUNDLE_SKILLS} skill packages.`);
  }
  const ids = new Set<string>();
  for (const selection of request.selections) {
    if (ids.has(selection.id)) {
      throw new BundleError('BUNDLE_INVALID', 'The selected catalog entries contain a duplicate identity.');
    }
    ids.add(selection.id);
  }

  const catalog = await options.catalogService.getCatalog({
    projectPath: request.projectPath,
    harness: request.harness,
  });
  const entries = catalog.groups.flatMap((group) => group.entries);
  const skills: Array<BundleSkill & { id: string; fingerprint: string }> = [];
  const directories = new Set<string>();
  const budget = { bytes: 0, files: 0 };

  for (const selection of request.selections) {
    const matches = entries.filter((entry) => entry.id === selection.id && entry.source === 'personal');
    if (matches.length !== 1) {
      throw new CatalogInstallError(
        SKILL_INSTALL_ERROR_CODES.CANDIDATE_NOT_FOUND,
        matches.length === 0
          ? 'The selected host-global catalog entry is unavailable; search again.'
          : 'The selected catalog identity is ambiguous; search again.',
        { projectId: request.projectId, skillId: selection.id, matches: matches.length },
      );
    }
    const entry = matches[0]!;
    if (entry.name.trim() === '' || entry.name.length > 128) {
      throw new BundleError('BUNDLE_INVALID', 'A selected skill name cannot be represented safely in the client manifest.');
    }
    const directory = safePackageName(entry.name);
    validatePackagePath(directory);
    if (directories.has(directory.toLowerCase())) {
      throw new BundleError('BUNDLE_INVALID', 'Selected skill names map to the same project directory.');
    }
    directories.add(directory.toLowerCase());

    try {
      const info = await lstat(entry.packagePath);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(entry.packagePath) !== entry.packagePath) {
        throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The package for skill "${entry.name}" is not a real directory.`);
      }
      const walked = await walkPackage(entry.packagePath);
      if (!walked.files.some((file) => file.path === 'SKILL.md')) {
        throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The package for skill "${entry.name}" has no SKILL.md.`);
      }
      const fingerprint = snapshotPackageFingerprint(walked.files);
      if (fingerprint !== selection.fingerprint) {
        throw new CatalogInstallError(
          SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
          `The package for skill "${entry.name}" changed after review; review it again.`,
          { projectId: request.projectId, skillId: entry.id },
        );
      }
      const files = walked.files.map((file) => {
        validatePackagePath(file.path);
        budget.bytes += file.bytes;
        budget.files += 1;
        if (budget.bytes > MAX_BUNDLE_BYTES || budget.files > MAX_BUNDLE_FILES) {
          throw new BundleError('BUNDLE_TOO_LARGE', 'Client transfers are limited to 20 MiB and 2,000 files.');
        }
        return { path: file.path, content: file.content.toString('base64'), executable: file.executable };
      });
      skills.push({ id: entry.id, fingerprint, name: entry.name, directory, files });
    } catch (error) {
      if (error instanceof BundleError || error instanceof CatalogInstallError) throw error;
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The package for skill "${entry.name}" could not be exported.`);
    }
  }
  return { format: 'skill-loom-project-skills', version: 2, skills };
}

async function resolveChainSkillEntries(
  options: InstallOptions,
  request: ApplyChainSkillsRequest,
): Promise<SkillEntry[]> {
  const catalog = await options.catalogService.getCatalog({
    projectPath: request.projectPath,
    harness: request.chain.harness,
  });
  const entries = catalog.groups.flatMap((group) => group.entries);
  const names = [...new Set(request.chain.steps
    .filter((step) => step.kind !== 'instruction')
    .map((step) => step.skillName))];
  const selected: SkillEntry[] = [];

  for (const name of names) {
    const matches = entries.filter((entry) => entry.source === 'personal' && entry.name === name);
    if (matches.length !== 1) {
      throw new CatalogInstallError(
        matches.length === 0
          ? SKILL_INSTALL_ERROR_CODES.CANDIDATE_NOT_FOUND
          : SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
        matches.length === 0
          ? `The global skill "${name}" is not available.`
          : `The global skill name "${name}" is ambiguous.`,
        { projectId: request.projectId, skillName: name, matches: matches.map((entry) => entry.id) },
      );
    }
    selected.push(matches[0]!);
  }
  return selected;
}

interface ResolvedReview {
  review: SkillInstallReview;
  entry: SkillEntry;
  walked: WalkedPackage;
}

function invalid(message: string, details: Record<string, unknown> = {}, cause?: unknown): never {
  throw new CatalogInstallError(
    SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
    message,
    details,
    cause === undefined ? {} : { cause },
  );
}

function errnoCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}

async function destinationConflict(path: string): Promise<'EXISTS' | null> {
  try {
    await lstat(path);
    return 'EXISTS';
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null;
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.DESTINATION_CONFLICT,
      'The project skill destination could not be inspected.',
      { path, reason: errnoCode(error) },
      { cause: error },
    );
  }
}

async function resolveCandidate(
  options: InstallOptions,
  request: SkillInstallReviewRequest,
): Promise<{ entry: SkillEntry; warnings: CatalogWarning[] }> {
  const { candidate } = request;
  if (candidate.source === 'project') {
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.SOURCE_UNSUPPORTED,
      'A skill that already belongs to the project cannot be installed again.',
      { skillId: candidate.id, source: candidate.source },
    );
  }
  if (candidate.source === 'builtin') {
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.SOURCE_UNSUPPORTED,
      'Bundled scenario packages are installed through the scenario chain workflow, not the catalog installer.',
      { skillId: candidate.id, source: candidate.source },
    );
  }
  if (candidate.source === 'remote' &&
      (candidate.sourceId === undefined || candidate.revision === undefined ||
        candidate.repositoryPath === undefined)) {
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_NOT_FOUND,
      'A remote candidate requires its exact source, revision, and repository path.',
      { skillId: candidate.id },
    );
  }

  const catalog = await options.catalogService.getCatalog({
    projectPath: request.projectPath,
    harness: request.harness,
    query: '',
  });
  const matches = catalog.groups
    .flatMap((group) => group.entries)
    .filter((entry) => entry.id === candidate.id && entry.source === candidate.source);
  if (matches.length !== 1) {
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_NOT_FOUND,
      matches.length === 0
        ? 'The candidate is not present in the current project catalog; search again.'
        : 'The candidate identity is ambiguous; search again and select one exact result.',
      { skillId: candidate.id, source: candidate.source, matches: matches.length },
    );
  }
  const entry = matches[0]!;
  if (entry.source === 'remote') {
    if (entry.sourceId !== candidate.sourceId || entry.revision !== candidate.revision ||
        entry.repositoryPath !== candidate.repositoryPath) {
      throw new CatalogInstallError(
        SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
        'The remote candidate no longer matches its pinned source identity; review it again.',
        { skillId: candidate.id },
      );
    }
  }
  return { entry, warnings: catalog.warnings };
}

async function readPackageFile(
  path: string,
  limit: number,
): Promise<{ content: Buffer; mode: bigint }> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.ino === 0n || before.size > BigInt(limit)) {
    invalid('The skill package contains an unsafe or oversized file.', { path });
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size) {
      invalid('The skill package changed while it was reviewed.', { path });
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
        current.dev !== info.dev || current.ino !== info.ino) {
      invalid('The skill package changed while it was reviewed.', { path });
    }
    return { content: content.subarray(0, length), mode: info.mode };
  } finally {
    await handle?.close();
  }
}

async function walkPackage(directory: string): Promise<WalkedPackage> {
  const root = await realpath(directory);
  const modeIndex: InstalledModeIndex | null = await readInstalledModeIndex(root);
  const files: WalkedFile[] = [];
  const directories: string[] = [];
  let bytes = 0;
  let entries = 0;

  async function visit(current: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_COPY_DEPTH || await realpath(current) !== current) {
      invalid('The skill package has an unsafe directory or exceeds the depth limit.', { path: current });
    }
    const dirents = [];
    for await (const entry of await opendir(current)) dirents.push(entry);
    dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of dirents) {
      entries += 1;
      if (entries > MAX_PACKAGE_ENTRIES) {
        invalid('The skill package exceeds the review entry limit.', { path: current });
      }
      if (prefix === '' && entry.name === '.loom' && modeIndex?.metadataDirectory === join(root, '.loom')) {
        continue;
      }
      const path = join(current, entry.name);
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        invalid('The skill package contains a symbolic link; it cannot be installed.', {
          path: relativePath,
        });
      }
      if (info.isDirectory()) {
        directories.push(relativePath);
        await visit(path, relativePath, depth + 1);
        continue;
      }
      if (!info.isFile()) {
        invalid('The skill package contains an unsupported filesystem entry.', {
          path: relativePath,
        });
      }
      if (files.length >= MAX_SKILL_PACKAGE_FILES) {
        invalid('The skill package exceeds the review file limit.', { path: relativePath });
      }
      const checked = await readPackageFile(path, MAX_SKILL_PACKAGE_BYTES - bytes);
      if (bytes + checked.content.length > MAX_SKILL_PACKAGE_BYTES) {
        invalid('The skill package exceeds the review size limit.', { path: relativePath });
      }
      bytes += checked.content.length;
      const executable = (checked.mode & 0o111n) !== 0n;
      files.push({
        path: relativePath,
        bytes: checked.content.length,
        executable: modeIndex === null
          ? executable
          : installedExecutableFlag(modeIndex, relativePath, executable),
        sha256: createHash('sha256').update(checked.content).digest('hex'),
        content: checked.content,
      });
    }
  }

  await visit(root, '', 0);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  directories.sort();
  return { files, directories, totalBytes: bytes };
}

function localIndexFingerprint(entry: SkillEntry, walked: WalkedPackage): string {
  const skill = walked.files.find((file) => file.path === 'SKILL.md');
  if (skill === undefined) {
    invalid('The skill package does not contain a SKILL.md entry.', { skillId: entry.id });
  }
  return createHash('sha256')
    .update('skill-loom-capability-index-v1\0')
    .update(entry.path, 'utf8')
    .update('\0')
    .update(skill.content)
    .digest('hex');
}

function verifyRemoteSnapshot(entry: SkillEntry, walked: WalkedPackage): void {
  const snapshot = entry[REMOTE_SNAPSHOT_CONTENT];
  if (snapshot === undefined) {
    invalid('The remote package has no verified snapshot fingerprint; refresh the source and retry.', {
      skillId: entry.id,
    });
  }
  const contentFingerprint = snapshotPackageFingerprint(walked.files);
  if (contentFingerprint !== snapshot.fingerprint ||
      snapshotReviewFingerprint(walked.files) !== snapshot.reviewFingerprint) {
    invalid('The remote package differs from its verified snapshot; refresh and review it again.', {
      skillId: entry.id,
    });
  }
  const remaining = snapshot.executablePaths === undefined
    ? undefined : new Set(snapshot.executablePaths);
  if (remaining !== undefined) {
    for (const file of walked.files) {
      const recorded = remaining.delete(file.path);
      if (process.platform !== 'win32' && recorded !== undefined && recorded !== file.executable) {
        invalid('The remote package executable modes differ from its verified snapshot.', {
          skillId: entry.id,
        });
      }
    }
    if (remaining.size !== 0) {
      invalid('The remote package is missing files recorded by its verified snapshot.', {
        skillId: entry.id,
      });
    }
  }
}

function canonicalReview(
  review: Omit<SkillInstallReview, 'reviewDigest'>,
): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    project: review.project,
    harness: review.harness,
    candidate: review.candidate,
    destination: review.destination,
    files: review.files,
    directories: review.directories,
    totalFiles: review.totalFiles,
    totalBytes: review.totalBytes,
    licenseFiles: review.licenseFiles,
  })).digest('hex');
}

async function resolveReview(
  options: InstallOptions,
  request: SkillInstallReviewRequest,
): Promise<ResolvedReview> {
  const started = performance.now();
  const { entry, warnings } = await resolveCandidate(options, request);
  if (entry.packagePath.trim() === '') {
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_NOT_FOUND,
      'The catalog did not report a package directory for this skill.',
      { skillId: entry.id },
    );
  }

  let walked: WalkedPackage;
  try {
    const info = await lstat(entry.packagePath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      invalid('The skill package is not a real directory.', { skillId: entry.id });
    }
    walked = await walkPackage(entry.packagePath);
  } catch (error) {
    if (error instanceof CatalogInstallError) throw error;
    if (errnoCode(error) === 'ENOENT') {
      throw new CatalogInstallError(
        SKILL_INSTALL_ERROR_CODES.CANDIDATE_NOT_FOUND,
        'The skill package is no longer available; search again.',
        { skillId: entry.id },
        { cause: error },
      );
    }
    throw error;
  }
  if (!walked.files.some((file) => file.path === 'SKILL.md')) {
    invalid('The skill package does not contain a SKILL.md entry.', { skillId: entry.id });
  }

  const fingerprint = snapshotPackageFingerprint(walked.files);
  if (entry.source === 'remote') verifyRemoteSnapshot(entry, walked);
  if (request.candidate.fingerprint !== undefined) {
    const observed = entry.source === 'remote' ? fingerprint : localIndexFingerprint(entry, walked);
    if (observed !== request.candidate.fingerprint) {
      throw new CatalogInstallError(
        SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
        'The candidate changed since it was discovered; review it again.',
        { skillId: entry.id },
      );
    }
  }

  const root = projectSkillRootFor(request.harness, request.projectPath);
  const name = safePackageName(request.destinationName ?? entry.name);
  const path = join(root, name);
  const conflict = await destinationConflict(path);

  const evidence: Omit<SkillInstallReview, 'reviewDigest'> = {
    project: { id: request.projectId, path: request.projectPath },
    harness: request.harness,
    candidate: {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      source: entry.source,
      sourceId: entry.sourceId ?? null,
      repository: entry.repository ?? null,
      revision: entry.revision ?? null,
      repositoryPath: entry.repositoryPath ?? null,
      fingerprint,
      personalSource: entry.source === 'personal',
    },
    destination: { root, name, path, conflict },
    files: walked.files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      executable: file.executable,
      sha256: file.sha256,
    })),
    directories: [...walked.directories],
    totalFiles: walked.files.length,
    totalBytes: walked.totalBytes,
    licenseFiles: walked.files
      .map((file) => file.path)
      .filter((file) => LICENSE_FILE.test(file.split('/').at(-1) ?? '')),
    warnings,
    elapsedMs: Math.round((performance.now() - started) * 100) / 100,
  };
  return {
    entry,
    walked,
    review: { ...evidence, reviewDigest: canonicalReview(evidence) },
  };
}

/** Read-only review of one exact candidate and its project destination. */
export async function reviewSkillInstall(
  options: InstallOptions,
  request: SkillInstallReviewRequest,
): Promise<SkillInstallReview> {
  return (await resolveReview(options, request)).review;
}

function inventoryMismatch(
  reviewed: SkillInstallReview,
  installed: WalkedPackage,
): boolean {
  const compareExecutable = process.platform !== 'win32';
  const filesMatch = reviewed.files.length === installed.files.length &&
    reviewed.files.every((file, index) => {
      const actual = installed.files[index];
      return actual !== undefined && actual.path === file.path && actual.bytes === file.bytes &&
        actual.sha256 === file.sha256 &&
        (!compareExecutable || actual.executable === file.executable);
    });
  const directoriesMatch = reviewed.directories.length === installed.directories.length &&
    reviewed.directories.every((directory, index) => installed.directories[index] === directory);
  return !filesMatch || !directoriesMatch;
}

/** Install the reviewed package after rechecking its digest and destination. */
export async function installSkillIntoProject(
  options: InstallOptions,
  request: SkillInstallRequest,
): Promise<SkillInstallResult> {
  const { review, entry } = await resolveReview(options, request);
  if (request.reviewDigest !== review.reviewDigest) {
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.REVIEW_STALE,
      'The review digest does not match the current package and destination; review it again.',
      { skillId: entry.id },
    );
  }
  if (review.destination.conflict !== null) {
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.DESTINATION_CONFLICT,
      'A skill package already exists at the destination; nothing was installed.',
      { path: review.destination.path, name: review.destination.name },
    );
  }

  const copied = await copySkillIntoProject({
    projectPath: request.projectPath,
    harness: request.harness,
    entry,
    destinationName: review.destination.name,
    allowNameSuffix: false,
  }).catch((error: unknown) => {
    if (error instanceof CatalogCopyError &&
        error.code === CATALOG_COPY_ERROR_CODES.SOURCE_ALREADY_PROJECT) {
      throw new CatalogInstallError(
        SKILL_INSTALL_ERROR_CODES.DESTINATION_CONFLICT,
        'A skill package appeared at the destination during installation; nothing was overwritten.',
        { path: review.destination.path, name: review.destination.name },
        { cause: error },
      );
    }
    throw error;
  });
  const installed = await walkPackage(copied.destinationPath);
  if (inventoryMismatch(review, installed)) {
    throw new CatalogInstallError(
      SKILL_INSTALL_ERROR_CODES.REVIEW_STALE,
      'The installed package differs from the reviewed package. Review it again.',
      { path: copied.destinationPath },
    );
  }
  return {
    name: review.destination.name,
    source: entry.source,
    destinationPath: copied.destinationPath,
    fingerprint: snapshotPackageFingerprint(installed.files),
    totalFiles: installed.files.length,
    totalBytes: installed.totalBytes,
  };
}
