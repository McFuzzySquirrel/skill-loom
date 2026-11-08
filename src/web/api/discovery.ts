import {
  DiscoveryHandoffSchema,
  type DiscoveryHandoff,
} from '../../shared/discovery-handoff';
import { ApiClientError, requestJson } from './client';
import type { CatalogHarness, RemoteSkillPackage } from './catalog';

export interface DiscoveryWorkspace {
  id: string;
  projectId: string;
  chainId: string;
  harness: CatalogHarness;
  createdAt: string;
  handoffFingerprint: string;
  autoImport: boolean;
  path: string;
  runId?: string;
  resultFingerprint?: string;
  importedDraftId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeWorkspace(value: unknown): DiscoveryWorkspace {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.projectId !== 'string' ||
    typeof value.chainId !== 'string' ||
    (value.harness !== 'opencode' && value.harness !== 'copilot') ||
    typeof value.createdAt !== 'string' ||
    typeof value.handoffFingerprint !== 'string' ||
    typeof value.autoImport !== 'boolean' ||
    typeof value.path !== 'string'
  ) {
    throw new ApiClientError('The Skill Loom server returned an invalid discovery workspace.', {
      code: 'INVALID_RESPONSE',
      status: 200,
    });
  }
  return {
    id: value.id,
    projectId: value.projectId,
    chainId: value.chainId,
    harness: value.harness,
    createdAt: value.createdAt,
    handoffFingerprint: value.handoffFingerprint,
    autoImport: value.autoImport,
    path: value.path,
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value.resultFingerprint === 'string' ? { resultFingerprint: value.resultFingerprint } : {}),
    ...(typeof value.importedDraftId === 'string' ? { importedDraftId: value.importedDraftId } : {}),
  };
}

export interface DiscoveryWorkspaceApi {
  create(input: {
    goal: string;
    harness: CatalogHarness;
    createdAt: string;
    reviewFingerprint: string;
    candidates: DiscoveryCandidateIdentity[];
    contentsReviewed: true;
    redistributionReviewed: true;
    autoImport: boolean;
  }): Promise<{ workspace: DiscoveryWorkspace; handoff: DiscoveryHandoff }>;
  list(): Promise<DiscoveryWorkspace[]>;
  previewResult(id: string): Promise<{ bundle: unknown; fingerprint: string }>;
  reviewResult(id: string, fingerprint: string): Promise<void>;
  importResult(id: string): Promise<{ draftId: string; imported: true }>;
  remove(id: string): Promise<void>;
}

function decodeWorkspaceCreation(value: unknown): {
  workspace: DiscoveryWorkspace;
  handoff: DiscoveryHandoff;
} {
  if (!isRecord(value)) {
    throw new ApiClientError('The Skill Loom server returned an invalid discovery workspace response.', {
      code: 'INVALID_RESPONSE',
      status: 200,
    });
  }
  return {
    workspace: decodeWorkspace(value.workspace),
    handoff: decodeHandoff(value.handoff),
  };
}

export const discoveryWorkspaceApi: DiscoveryWorkspaceApi = {
  async create(input) {
    const value = await requestJson<unknown>('/api/discovery/workspaces', {
      method: 'POST',
      body: {
        ...input,
        candidates: input.candidates.map(({ sourceId, revision, repositoryPath, fingerprint }) => ({
          sourceId,
          revision,
          repositoryPath,
          fingerprint,
        })),
      },
    });
    return decodeWorkspaceCreation(value);
  },
  async list() {
    const value = await requestJson<unknown>('/api/discovery/workspaces');
    if (!isRecord(value) || !Array.isArray(value.workspaces)) {
      throw new ApiClientError('The Skill Loom server returned an invalid discovery workspace list.', {
        code: 'INVALID_RESPONSE',
        status: 200,
      });
    }
    return value.workspaces.map(decodeWorkspace);
  },
  async previewResult(id) {
    const value = await requestJson<unknown>(
      `/api/discovery/workspaces/${encodeURIComponent(id)}/result`,
    );
    if (!isRecord(value) || typeof value.fingerprint !== 'string' || value.bundle === undefined) {
      throw new ApiClientError('The Skill Loom server returned an invalid discovery result.', {
        code: 'INVALID_RESPONSE',
        status: 200,
      });
    }
    return { bundle: value.bundle, fingerprint: value.fingerprint };
  },
  async reviewResult(id, fingerprint) {
    await requestJson<unknown>(
      `/api/discovery/workspaces/${encodeURIComponent(id)}/result-review`,
      {
        method: 'POST',
        body: {
          fingerprint,
          contentsReviewed: true,
          redistributionReviewed: true,
        },
      },
    );
  },
  async importResult(id) {
    const value = await requestJson<unknown>(
      `/api/discovery/workspaces/${encodeURIComponent(id)}/import`,
      { method: 'POST' },
    );
    if (
      !isRecord(value) ||
      typeof value.draftId !== 'string' ||
      value.imported !== true
    ) {
      throw new ApiClientError('The Skill Loom server returned an invalid discovery import response.', {
        code: 'INVALID_RESPONSE',
        status: 200,
      });
    }
    return { draftId: value.draftId, imported: true };
  },
  async remove(id) {
    const value = await requestJson<unknown>(
      `/api/discovery/workspaces/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (!isRecord(value) || value.id !== id || value.removed !== true) {
      throw new ApiClientError('The Skill Loom server returned an invalid discovery workspace removal response.', {
        code: 'INVALID_RESPONSE',
        status: 200,
      });
    }
  },
};

export interface DiscoveryCandidateIdentity {
  sourceId: string;
  revision: string;
  repositoryPath: string;
  fingerprint: string;
}

export interface DiscoveryHandoffApi {
  prepare(input: {
    goal: string;
    harness: CatalogHarness;
    candidates: DiscoveryCandidateIdentity[];
  }): Promise<DiscoveryHandoff>;
}

function decodeHandoff(value: unknown): DiscoveryHandoff {
  const parsed = DiscoveryHandoffSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiClientError(
      'The Skill Loom server returned an invalid discovery handoff.',
      { code: 'INVALID_RESPONSE', status: 200 },
    );
  }
  return parsed.data;
}

export function discoveryCandidateKey(
  identity: DiscoveryCandidateIdentity,
): string {
  return JSON.stringify([
    identity.sourceId,
    identity.revision,
    identity.repositoryPath,
    identity.fingerprint,
  ]);
}

export type DiscoveryCandidate = DiscoveryCandidateIdentity & {
  name: string;
  description: string;
  repository: string;
  bytes: number;
  files: number;
};

export function discoveryCandidateFromPackage(
  sourceId: string,
  revision: string,
  repository: string,
  skill: RemoteSkillPackage,
): DiscoveryCandidate {
  return {
    sourceId,
    revision,
    repositoryPath: skill.repositoryPath,
    fingerprint: skill.fingerprint,
    name: skill.name,
    description: skill.description,
    repository,
    bytes: skill.bytes,
    files: skill.files,
  };
}

export const discoveryApi: DiscoveryHandoffApi = {
  async prepare(input) {
    return decodeHandoff(await requestJson<unknown>('/api/discovery/handoffs', {
      method: 'POST',
      body: {
        goal: input.goal,
        harness: input.harness,
        candidates: input.candidates.map((candidate) => ({
          sourceId: candidate.sourceId,
          revision: candidate.revision,
          repositoryPath: candidate.repositoryPath,
          fingerprint: candidate.fingerprint,
        })),
      },
    }));
  },
};
