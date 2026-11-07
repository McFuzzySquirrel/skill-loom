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
