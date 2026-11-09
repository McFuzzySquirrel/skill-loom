import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { decodeBundleFile } from '../../portable/bundle.js';
import { BundleError, importBundle, MAX_BUNDLE_REQUEST_BYTES, parseBundle } from '../chains/bundle.js';
import { approvedReuse, reviewBundleTarget, verifyReusedPackages } from './target-review.js';
import { isProjectId } from '../projects/registry.js';
import type { LoomServices } from '../services.js';

async function loadBundle(path: string) {
  if (!isAbsolute(path)) {
    throw new BundleError('BUNDLE_INVALID', 'The bundle must be an existing canonical absolute file path.');
  }
  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch {
    throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The bundle file is unavailable or unreadable.');
  }
  if (canonical !== resolve(path)) {
    throw new BundleError('BUNDLE_INVALID', 'The bundle must be an existing canonical absolute file path.');
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The bundle file is unavailable or unreadable.');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BUNDLE_REQUEST_BYTES) {
      throw new BundleError('BUNDLE_TOO_LARGE', 'The bundle is not a regular file or exceeds its JSON size limit.');
    }
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset !== info.size) throw new BundleError('BUNDLE_INVALID', 'The bundle changed while it was read; review it again.');
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.subarray(0, offset).toString('utf8')) as unknown;
    } catch {
      throw new BundleError('BUNDLE_INVALID', 'The bundle is not valid JSON.');
    }
    return parseBundle(raw);
  } catch (error) {
    if (error instanceof BundleError) throw error;
    throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The bundle file could not be read completely.');
  } finally {
    await handle.close();
  }
}

export async function reviewBundleImport(services: LoomServices, projectId: string, bundlePath: string) {
  const project = isProjectId(projectId) ? await services.projectRegistry.findRecentProject(projectId) : undefined;
  if (project === undefined) throw new BundleError('BUNDLE_INVALID', 'The destination project is not registered.');
  const projectPath = project.canonicalPath;
  let projectInfo;
  try {
    if (await realpath(projectPath) !== projectPath) throw new BundleError('BUNDLE_INVALID', 'The destination project is not canonical.');
    projectInfo = await stat(projectPath, { bigint: true });
  } catch (error) {
    if (error instanceof BundleError) throw error;
    throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The destination project is unavailable.');
  }
  if (!projectInfo.isDirectory()) throw new BundleError('BUNDLE_INVALID', 'The destination project is not a directory.');
  const bundle = await loadBundle(bundlePath);
  const preview = await reviewBundleTarget(projectId, projectPath, bundle, services.catalogService);
  if (preview.projectDevice !== String(projectInfo.dev) || preview.projectInode !== String(projectInfo.ino)) {
    throw new BundleError('BUNDLE_CONFLICT', 'The destination project changed during review. Review it again.');
  }
  const evidence = {
    version: 1,
    projectId,
    projectPath,
    projectDevice: String(projectInfo.dev),
    projectInode: String(projectInfo.ino),
    bundleFingerprint: createHash('sha256').update(JSON.stringify(bundle)).digest('hex'),
    chain: bundle.chain,
    skills: preview.skills.map((skill, index) => ({
      ...skill,
      directory: bundle.skills[index]!.directory,
      inventory: bundle.skills[index]!.files.map((file) => ({
        path: file.path,
        executable: file.executable,
        bytes: decodeBundleFile(file.content).length,
        fingerprint: createHash('sha256').update(decodeBundleFile(file.content)).digest('hex'),
      })),
    })),
    agents: preview.agents,
    reuseEvidence: preview.reuseEvidence,
    targetReviewDigest: preview.reviewDigest,
  };
  return {
    bundle,
    evidence,
    preview,
    reviewDigest: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
  };
}

export async function importReviewedBundle(
  services: LoomServices,
  input: {
    projectId: string; bundlePath: string; reviewDigest: string; confirmed: true;
    reuseSkills?: string[] | undefined; differingReuseConfirmed?: boolean | undefined;
  },
) {
  const reviewed = await reviewBundleImport(services, input.projectId, input.bundlePath);
  if (reviewed.reviewDigest !== input.reviewDigest) {
    throw new BundleError('BUNDLE_CONFLICT', 'The reviewed bundle or destination changed. Review it again.');
  }
  const reuseSkills = input.reuseSkills ?? [];
  const reuse = approvedReuse(reviewed.preview, reuseSkills, input.differingReuseConfirmed === true);
  return importBundle(
    reviewed.bundle, reviewed.evidence.projectPath, services.catalogService, services.chainService, reuseSkills, true,
    () => verifyReusedPackages(reviewed.evidence.projectPath, reviewed.bundle, services.catalogService, reuse, reviewed.preview),
  );
}
