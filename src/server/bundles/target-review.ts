import { createHash } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { BundleError, MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES } from '../../portable/bundle.js';
import { packageFingerprint, PortableRunError, treeFingerprint } from '../../portable/runtime.js';
import type { BundleReuseEvidence, ChainBundle, ReviewedBundlePreview } from '../../shared/bundles.js';
import type { CatalogService } from '../catalog/merge.js';
import type { SkillEntry } from '../catalog/types.js';
import { inspectBundleDestination } from '../chains/bundle.js';

async function projectIdentity(projectPath: string): Promise<{ projectDevice: string; projectInode: string }> {
  try {
    if (await realpath(projectPath) !== projectPath) throw new Error('Project is not canonical.');
    const info = await stat(projectPath, { bigint: true });
    if (!info.isDirectory()) throw new Error('Project is not a directory.');
    return { projectDevice: String(info.dev), projectInode: String(info.ino) };
  } catch {
    throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The destination project is unavailable or no longer canonical.');
  }
}

async function collectReuseEvidence(
  bundle: ChainBundle,
  projectPath: string,
  entries: SkillEntry[],
  names: readonly string[],
): Promise<BundleReuseEvidence[]> {
  const result: BundleReuseEvidence[] = [];
  let totalFiles = 0;
  let totalBytes = 0;
  let totalEntries = 0;
  let totalInventoryBytes = 0;
  for (const name of names) {
    const skill = bundle.skills.find((item) => item.name === name);
    if (skill === undefined) throw new BundleError('BUNDLE_INVALID', 'The reuse selection is not in the bundle.');
    const paths = new Set(entries.filter((entry) =>
      entry.name === name && entry.source === 'project' && entry.enabled).map((entry) =>
      entry.packagePath === undefined ? '' : resolve(entry.packagePath)));
    if (paths.size !== 1 || paths.has('')) {
      throw new BundleError('BUNDLE_CONFLICT', `Skill "${name}" has no unique installed project package to reuse.`);
    }
    const path = [...paths][0]!;
    const inside = relative(projectPath, path);
    if (!isAbsolute(path) || inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The installed package for "${name}" is outside the project.`);
    }
    const inventory: BundleReuseEvidence['inventory'] = [];
    let fingerprint: string;
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
        throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The installed package for "${name}" is not a safe directory.`);
      }
      fingerprint = await treeFingerprint(path, inventory, {
        files: MAX_BUNDLE_FILES - totalFiles, bytes: MAX_BUNDLE_BYTES - totalBytes,
        entries: MAX_BUNDLE_FILES * 33 - totalEntries,
        inventoryBytes: 4 * 1024 * 1024 - totalInventoryBytes,
      });
    } catch (error) {
      if (error instanceof BundleError) throw error;
      if (error instanceof PortableRunError) {
        throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The installed package for "${name}" cannot be safely reviewed: ${error.message}`);
      }
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The installed package for "${name}" could not be read completely.`);
    }
    for (const item of inventory) {
      totalEntries += 1;
      totalInventoryBytes += Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
      if (item.kind === 'file') {
        totalFiles += 1;
        totalBytes += item.bytes;
      }
    }
    const bundledFingerprint = packageFingerprint(skill.files);
    result.push({ name, path, fingerprint, bundledFingerprint, differs: fingerprint !== bundledFingerprint, inventory });
  }
  return result;
}

export async function reviewBundleTarget(
  projectId: string,
  projectPath: string,
  raw: unknown,
  catalog: CatalogService,
): Promise<ReviewedBundlePreview> {
  const identity = await projectIdentity(projectPath);
  const { preview, entries } = await inspectBundleDestination(raw, projectPath, catalog, true);
  const reuseEvidence = await collectReuseEvidence(
    preview.bundle, projectPath, entries, preview.skills.filter((skill) => skill.conflict).map((skill) => skill.name),
  );
  const after = await projectIdentity(projectPath);
  if (identity.projectDevice !== after.projectDevice || identity.projectInode !== after.projectInode) {
    throw new BundleError('BUNDLE_CONFLICT', 'The destination project changed during review. Review it again.');
  }
  const evidence = { version: 1, projectId, projectPath, ...identity, preview, reuseEvidence };
  const reviewDigest = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  return { ...preview, ...identity, reuseEvidence, reviewDigest };
}

export async function verifyReusedPackages(
  projectPath: string,
  bundle: ChainBundle,
  catalog: CatalogService,
  expected: readonly BundleReuseEvidence[],
  identity: { projectDevice: string; projectInode: string },
): Promise<void> {
  const before = await projectIdentity(projectPath);
  if (before.projectDevice !== identity.projectDevice || before.projectInode !== identity.projectInode) {
    throw new BundleError('BUNDLE_CONFLICT', 'The destination project changed since review. Review it again.');
  }
  if (expected.length === 0) return;
  const { entries } = await inspectBundleDestination(bundle, projectPath, catalog, true);
  const current = await collectReuseEvidence(bundle, projectPath, entries, expected.map((item) => item.name));
  const after = await projectIdentity(projectPath);
  if (JSON.stringify(current) !== JSON.stringify(expected) ||
      before.projectDevice !== after.projectDevice || before.projectInode !== after.projectInode) {
    throw new BundleError('BUNDLE_CONFLICT', 'An installed package changed since review. Review it again.');
  }
}

export function approvedReuse(
  reviewed: ReviewedBundlePreview,
  reuseSkills: string[],
  differingReuseConfirmed: boolean,
): BundleReuseEvidence[] {
  const names = new Set(reuseSkills);
  if (names.size !== reuseSkills.length ||
      reuseSkills.some((name) => !reviewed.reuseEvidence.some((item) => item.name === name))) {
    throw new BundleError('BUNDLE_INVALID', 'Only distinct installed packages shown in the review can be reused.');
  }
  const selected = reviewed.reuseEvidence.filter((item) => names.has(item.name));
  if (selected.some((item) => item.differs) && !differingReuseConfirmed) {
    throw new BundleError('BUNDLE_CONFLICT', 'Reusing differing installed package contents requires separate confirmation.');
  }
  return selected;
}
