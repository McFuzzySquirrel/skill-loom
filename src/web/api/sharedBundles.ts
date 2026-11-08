import type { ChainBundle } from '../../shared/bundles';
import { ApiClientError, requestJson } from './client';

export interface SharedLibraryEntry {
  id: string;
  filename: string;
  status: 'available' | 'invalid' | 'unsafe' | 'unreadable';
  name?: string;
  version?: 1 | 2;
  skills?: number;
  agent?: string;
  message?: string;
}

export interface SharedLibrarySnapshot {
  directory: string | null;
  entries: SharedLibraryEntry[];
  truncated: boolean;
}

export interface SharedBundleUploadReview {
  bundle: ChainBundle;
  reviewFingerprint: string;
}

export type SharedBundleSource =
  | { type: 'draft'; draftId: string }
  | { type: 'project'; projectId: string; chainId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Skill Loom server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function decodeEntry(value: unknown): SharedLibraryEntry {
  const status =
    isRecord(value) && typeof value.status === 'string'
      ? decodeStatus(value.status)
      : null;
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.filename !== 'string' ||
    status === null
  ) {
    throw invalidResponse('shared bundle entry');
  }
  return {
    id: value.id,
    filename: value.filename,
    status,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(value.version === 1 || value.version === 2 ? { version: value.version } : {}),
    ...(typeof value.skills === 'number' ? { skills: value.skills } : {}),
    ...(typeof value.agent === 'string' ? { agent: value.agent } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  };
}

function decodeUploadedBundle(value: unknown): ChainBundle {
  if (
    !isRecord(value) ||
    value.format !== 'skill-loom-chain' ||
    (value.version !== 1 && value.version !== 2) ||
    !isRecord(value.chain) ||
    typeof value.chain.name !== 'string' ||
    (value.chain.harness !== 'opencode' && value.chain.harness !== 'copilot') ||
    !['shared', 'fresh', 'fork'].includes(String(value.chain.sessionMode)) ||
    !Array.isArray(value.chain.steps) ||
    !Array.isArray(value.chain.inputs) ||
    !Array.isArray(value.skills) ||
    value.skills.some((skill) =>
      !isRecord(skill) ||
      typeof skill.name !== 'string' ||
      typeof skill.directory !== 'string' ||
      !Array.isArray(skill.files) ||
      skill.files.some((file) =>
        !isRecord(file) ||
        typeof file.path !== 'string' ||
        typeof file.content !== 'string' ||
        typeof file.executable !== 'boolean',
      ),
    ) ||
    (value.version === 2 && !Array.isArray(value.agents))
  ) {
    throw invalidResponse('uploaded chain bundle');
  }
  return value as unknown as ChainBundle;
}

function decodeStatus(value: string): SharedLibraryEntry['status'] | null {
  switch (value) {
    case 'available':
    case 'invalid':
    case 'unsafe':
    case 'unreadable':
      return value;
    default:
      return null;
  }
}

export const sharedBundlesApi = {
  async list(): Promise<SharedLibrarySnapshot> {
    const value = await requestJson<unknown>('/api/shared-bundles');
    if (
      !isRecord(value) ||
      !(value.directory === null || typeof value.directory === 'string') ||
      !Array.isArray(value.entries) ||
      typeof value.truncated !== 'boolean'
    ) {
      throw invalidResponse('shared bundle library');
    }
    return {
      directory: value.directory,
      entries: value.entries.map(decodeEntry),
      truncated: value.truncated,
    };
  },

  async configure(directory: string | null): Promise<string | null> {
    const value = await requestJson<unknown>('/api/shared-bundles/config', {
      method: 'PUT',
      body: { directory },
    });
    if (!isRecord(value) || !(value.directory === null || typeof value.directory === 'string')) {
      throw invalidResponse('shared bundle directory');
    }
    return value.directory;
  },

  async read(bundleId: string): Promise<ChainBundle> {
    const value = await requestJson<{ bundle: ChainBundle }>(
      `/api/shared-bundles/${encodeURIComponent(bundleId)}`,
    );
    if (!isRecord(value) || !isRecord(value.bundle)) {
      throw invalidResponse('shared bundle');
    }
    return value.bundle;
  },

  async previewUpload(bundle: unknown): Promise<SharedBundleUploadReview> {
    const value = await requestJson<unknown>('/api/shared-bundles/preview-upload', {
      method: 'POST',
      body: { bundle },
    });
    if (
      !isRecord(value) ||
      typeof value.reviewFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.reviewFingerprint)
    ) {
      throw invalidResponse('uploaded bundle review');
    }
    return {
      bundle: decodeUploadedBundle(value.bundle),
      reviewFingerprint: value.reviewFingerprint,
    };
  },

  async publishUpload(input: {
    bundle: ChainBundle;
    displayName: string;
    contentsReviewed: true;
    redistributionReviewed: true;
    reviewFingerprint: string;
  }): Promise<SharedLibraryEntry> {
    const value = await requestJson<unknown>('/api/shared-bundles/publish-upload', {
      method: 'POST',
      body: input,
    });
    if (!isRecord(value) || value.entry === undefined) {
      throw invalidResponse('uploaded bundle publication');
    }
    return decodeEntry(value.entry);
  },

  async publish(input: {
    source: SharedBundleSource;
    displayName: string;
    contentsReviewed: true;
    redistributionReviewed: true;
    reviewFingerprint: string;
  }): Promise<SharedLibraryEntry> {
    const value = await requestJson<unknown>('/api/shared-bundles/publish', {
      method: 'POST',
      body: input,
    });
    if (!isRecord(value) || value.entry === undefined) {
      throw invalidResponse('shared bundle publication');
    }
    return decodeEntry(value.entry);
  },
};
