import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DiscoveryHandoffSchema,
  MAX_HANDOFF_BYTES,
  MAX_HANDOFF_FILES,
  MAX_HANDOFF_JSON_BYTES,
  MAX_HANDOFF_PACKAGES,
  type DiscoveryHandoff,
  type DiscoveryHandoffCandidate,
  type DiscoveryHandoffFile,
} from '../../shared/discovery-handoff.js';
import { validatePackagePath } from '../../portable/bundle.js';
import type { ConfigStore } from '../config/store.js';
import {
  findRemoteSkillSnapshot,
  listRemoteSkillSources,
  resolveSnapshotPackagePath,
  RemoteSourceError,
  type RemoteSkillSnapshot,
} from './remote.js';

const candidateIdentitySchema = DiscoveryHandoffSchema.shape.candidates.element.pick({
  sourceId: true,
  revision: true,
  repositoryPath: true,
  fingerprint: true,
});

const prepareSchema = z.strictObject({
  goal: z.string().trim().min(1).max(1_000),
  harness: DiscoveryHandoffSchema.shape.harness,
  createdAt: DiscoveryHandoffSchema.shape.createdAt.optional(),
  candidates: candidateIdentitySchema.array().min(1).max(MAX_HANDOFF_PACKAGES),
});

export class DiscoveryHandoffError extends Error {
  constructor(
    readonly code:
      | 'DISCOVERY_CANDIDATE_INVALID'
      | 'DISCOVERY_CANDIDATE_UNAVAILABLE'
      | 'DISCOVERY_CANDIDATE_AMBIGUOUS'
      | 'DISCOVERY_SNAPSHOT_UNSAFE'
      | 'DISCOVERY_HANDOFF_TOO_LARGE',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export async function prepareDiscoveryHandoff(
  configStore: ConfigStore,
  raw: unknown,
  options: { allowUnregisteredSources?: boolean } = {},
): Promise<DiscoveryHandoff> {
  const parsed = prepareSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DiscoveryHandoffError(
      'DISCOVERY_CANDIDATE_INVALID',
      'Provide a goal, a supported harness, and one or more exact pinned skill identities.',
      422,
    );
  }
  const identities = parsed.data.candidates;
  const keys = new Set<string>();
  for (const identity of identities) {
    const key = `${identity.sourceId}\0${identity.revision}\0${identity.repositoryPath}\0${identity.fingerprint}`;
    if (keys.has(key)) {
      throw new DiscoveryHandoffError(
        'DISCOVERY_CANDIDATE_INVALID',
        'A candidate was selected more than once.',
        422,
      );
    }
    keys.add(key);
  }

  const sources = options.allowUnregisteredSources === true
    ? []
    : await listRemoteSkillSources(configStore);
  const packages: DiscoveryHandoffCandidate[] = [];
  const snapshots = new Map<string, RemoteSkillSnapshot>();
  let totalFiles = 0;
  let totalBytes = 0;
  for (const identity of identities) {
    if (
      options.allowUnregisteredSources !== true &&
      !sources.some((source) => source.id === identity.sourceId)
    ) {
      throw unavailable('The selected source is no longer registered. Review the current sources and select it again.');
    }
    const snapshotKey = `${identity.sourceId}\0${identity.revision}`;
    let snapshot = snapshots.get(snapshotKey);
    if (snapshot === undefined) {
      snapshot = await findRemoteSkillSnapshot(configStore.getConfigDir(), identity.sourceId, identity.revision)
        .catch((error: unknown) => {
          if (error instanceof RemoteSourceError) {
            throw new DiscoveryHandoffError(
              'DISCOVERY_SNAPSHOT_UNSAFE',
              'The selected pinned snapshot could not be verified. Refresh the source and review its warnings.',
              422,
            );
          }
          throw error;
        });
      if (snapshot !== undefined) snapshots.set(snapshotKey, snapshot);
    }
    if (snapshot === undefined) {
      throw unavailable('The exact pinned snapshot is no longer available. Refresh and explicitly reselect a current candidate.');
    }
    const matches = snapshot.packages.filter((entry) =>
      entry.repositoryPath === identity.repositoryPath &&
      entry.fingerprint === identity.fingerprint,
    );
    if (matches.length === 0) {
      throw unavailable('The selected package no longer matches its pinned identity.');
    }
    if (matches.length !== 1) {
      throw new DiscoveryHandoffError(
        'DISCOVERY_CANDIDATE_AMBIGUOUS',
        'The pinned snapshot contains an ambiguous package identity. Choose another candidate.',
        409,
      );
    }
    const packageInfo = matches[0]!;
    if (packageInfo.files > MAX_HANDOFF_FILES - totalFiles ||
        packageInfo.bytes > MAX_HANDOFF_BYTES - totalBytes) {
      throw handoffTooLarge();
    }
    if (packageInfo.name.length > 128 || /[\\/]/.test(packageInfo.name)) {
      throw unavailable('The selected package name cannot be represented safely in a portable chain bundle.');
    }
    try {
      validatePackagePath(packageInfo.name);
    } catch {
      throw unavailable('The selected package name cannot be represented safely in a portable chain bundle.');
    }
    const packagePath = await resolveSnapshotPackagePath(
      configStore.getConfigDir(),
      snapshot,
      packageInfo,
    ).catch((error: unknown) => {
      if (error instanceof RemoteSourceError) {
        throw new DiscoveryHandoffError(
          'DISCOVERY_SNAPSHOT_UNSAFE',
          'The selected pinned package could not be verified. Refresh the source and review its warnings.',
          422,
        );
      }
      throw error;
    });
    const files = await collectPackage(
      packagePath, MAX_HANDOFF_FILES - totalFiles, MAX_HANDOFF_BYTES - totalBytes,
    ).catch((error: unknown) => {
      if (error instanceof DiscoveryHandoffError) throw error;
      throw unsafe();
    });
    const actualFingerprint = fingerprintFiles(files);
    const packageBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'base64'), 0);
    if (
      actualFingerprint !== packageInfo.fingerprint ||
      files.length !== packageInfo.files ||
      packageBytes !== packageInfo.bytes
    ) {
      throw new DiscoveryHandoffError(
        'DISCOVERY_SNAPSHOT_UNSAFE',
        'The selected pinned package changed while it was being prepared. Review the source again.',
        409,
      );
    }
    totalFiles += files.length;
    totalBytes += packageBytes;
    if (
      totalFiles > MAX_HANDOFF_FILES ||
      totalBytes > MAX_HANDOFF_BYTES ||
      packages.length + 1 > MAX_HANDOFF_PACKAGES
    ) {
      throw handoffTooLarge();
    }
    packages.push({
      sourceId: snapshot.sourceId,
      revision: snapshot.revision,
      repositoryPath: packageInfo.repositoryPath,
      name: packageInfo.name,
      fingerprint: packageInfo.fingerprint,
      files,
    });
  }

  const body = {
    format: 'skill-loom-discovery-handoff' as const,
    version: 1 as const,
    goal: parsed.data.goal,
    harness: parsed.data.harness,
    createdAt: parsed.data.createdAt ?? new Date().toISOString(),
    candidates: packages,
  };
  const handoff = {
    ...body,
    fingerprint: createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex'),
  };
  const validated = DiscoveryHandoffSchema.parse(handoff);
  if (Buffer.byteLength(JSON.stringify(validated), 'utf8') > MAX_HANDOFF_JSON_BYTES) {
    throw new DiscoveryHandoffError(
      'DISCOVERY_HANDOFF_TOO_LARGE',
      'The selected package files exceed the maximum handoff JSON size. Remove candidates and prepare again; none were omitted.',
      413,
    );
  }
  return validated;
}

async function collectPackage(root: string, remainingFiles: number, remainingBytes: number): Promise<DiscoveryHandoffFile[]> {
  const files: DiscoveryHandoffFile[] = [];
  let bytes = 0;
  async function visit(directory: string, prefix: string, depth: number): Promise<void> {
    if (depth > 32) throw unsafe();
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      validatePackagePath(path);
      const absolute = join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw unsafe();
      if (info.isDirectory()) {
        await visit(absolute, path, depth + 1);
        continue;
      }
      if (!info.isFile()) throw unsafe();
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) throw unsafe();
        if (files.length >= remainingFiles || opened.size > remainingBytes - bytes) throw handoffTooLarge();
        const content = Buffer.alloc(opened.size + 1);
        let bytesRead = 0;
        while (bytesRead < content.length) {
          const read = await handle.read(content, bytesRead, content.length - bytesRead, bytesRead);
          if (read.bytesRead === 0) break;
          bytesRead += read.bytesRead;
        }
        const after = await handle.stat();
        if (bytesRead !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
            after.mode !== opened.mode) throw unsafe();
        bytes += bytesRead;
        files.push({
          path,
          content: content.subarray(0, bytesRead).toString('base64'),
          executable: (opened.mode & 0o111) !== 0,
        });
      } finally {
        await handle.close();
      }
    }
  }
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) {
    throw unsafe();
  }
  await visit(root, '', 0);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function fingerprintFiles(files: DiscoveryHandoffFile[]): string {
  const fingerprint = createHash('sha256');
  for (const file of files) {
    fingerprint
      .update(file.path)
      .update('\0')
      .update(file.executable ? 'x' : '-')
      .update('\0')
      .update(Buffer.from(file.content, 'base64'));
  }
  return fingerprint.digest('hex');
}

function unavailable(message: string): DiscoveryHandoffError {
  return new DiscoveryHandoffError('DISCOVERY_CANDIDATE_UNAVAILABLE', message, 409);
}

function handoffTooLarge(): DiscoveryHandoffError {
  return new DiscoveryHandoffError(
    'DISCOVERY_HANDOFF_TOO_LARGE',
    `The selection exceeds handoff limits (${String(MAX_HANDOFF_PACKAGES)} packages, ${String(MAX_HANDOFF_FILES)} files, ${String(MAX_HANDOFF_BYTES)} decoded bytes). Remove candidates and prepare again; none were omitted.`,
    413,
  );
}

function unsafe(): DiscoveryHandoffError {
  return new DiscoveryHandoffError(
    'DISCOVERY_SNAPSHOT_UNSAFE',
    'A selected package contains unsafe or unreadable files and cannot be included.',
    422,
  );
}
