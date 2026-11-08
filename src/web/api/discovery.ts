import {
  DiscoveryHandoffSchema,
  type DiscoveryHandoff,
} from '../../shared/discovery-handoff';
import { ApiClientError, requestJson } from './client';
import type { CatalogHarness, RemoteSkillPackage } from './catalog';

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
      body: input,
    }));
  },
};
