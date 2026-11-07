import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client';

export interface TestWorkspace {
  id: string;
  projectId: string;
  purpose?: 'test' | 'discovery';
  sourceProjectId?: string;
  sourceChainId?: string;
  sourceDraftId?: string;
  discoveryGoal?: string;
  discoverySourceProjectId?: string;
  discoverySkillNames?: string[];
  chainId: string;
  createdAt: string;
  path: string;
}

export interface DiscoveryProposalPreview {
  name: string;
  harness: 'opencode' | 'copilot';
  sessionMode: 'shared' | 'fork';
  steps: Array<{
    id: string;
    kind?: 'skill' | 'instruction';
    skillName?: string;
    label?: string;
    instruction: string;
  }>;
  inputs: Array<{
    name: string;
    label: string;
    required: boolean;
    defaultValue?: string;
  }>;
  skills: Array<{
    name: string;
    directory: string;
    files: number;
    bytes: number;
  }>;
}

export interface TestWorkspacesApi {
  create(
    input:
      | { sourceProjectId: string; sourceChainId: string }
      | { sourceDraftId: string },
    options?: { signal?: AbortSignal },
  ): Promise<TestWorkspace>;
  createDiscovery(input: {
    goal: string;
    harness: 'opencode' | 'copilot';
    skillIds: string[];
    sourceProjectId?: string;
  }, options?: { signal?: AbortSignal }): Promise<TestWorkspace>;
  getProposal(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<DiscoveryProposalPreview | null>;
  acceptProposal(
    id: string,
    name?: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ id: string; name: string }>;
  list(options?: { signal?: AbortSignal }): Promise<TestWorkspace[]>;
  remove(id: string, options?: { signal?: AbortSignal }): Promise<{ id: string; removed: true }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Skill Loom server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function decodeProposal(value: unknown): DiscoveryProposalPreview {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    (value.harness !== 'opencode' && value.harness !== 'copilot') ||
    (value.sessionMode !== 'shared' && value.sessionMode !== 'fork') ||
    !Array.isArray(value.steps) ||
    !Array.isArray(value.inputs) ||
    !Array.isArray(value.skills)
  ) {
    throw invalidResponse('scenario proposal');
  }
  const steps = value.steps.map((step) => {
    if (
      !isRecord(step) ||
      !isNonEmptyString(step.id) ||
      typeof step.instruction !== 'string' ||
      step.kind !== undefined &&
        step.kind !== 'skill' &&
        step.kind !== 'instruction' ||
      step.skillName !== undefined && !isNonEmptyString(step.skillName) ||
      step.label !== undefined && !isNonEmptyString(step.label)
    ) {
      throw invalidResponse('scenario proposal step');
    }
    const kind: 'skill' | 'instruction' | undefined =
      step.kind === 'skill' || step.kind === 'instruction'
      ? step.kind
      : undefined;
    return {
      id: step.id,
      ...(kind === undefined ? {} : { kind }),
      ...(isNonEmptyString(step.skillName) ? { skillName: step.skillName } : {}),
      ...(isNonEmptyString(step.label) ? { label: step.label } : {}),
      instruction: step.instruction,
    };
  });
  const inputs = value.inputs.map((input) => {
    if (
      !isRecord(input) ||
      !isNonEmptyString(input.name) ||
      input.label !== undefined && !isNonEmptyString(input.label) ||
      typeof input.required !== 'boolean' ||
      input.defaultValue !== undefined && typeof input.defaultValue !== 'string'
    ) {
      throw invalidResponse('scenario proposal input');
    }
    return {
      name: input.name,
      label: typeof input.label === 'string' ? input.label : input.name,
      required: input.required,
      ...(typeof input.defaultValue === 'string' ? { defaultValue: input.defaultValue } : {}),
    };
  });
  const skills = value.skills.map((skill) => {
    if (
      !isRecord(skill) ||
      !isNonEmptyString(skill.name) ||
      !isNonEmptyString(skill.directory) ||
      !Number.isInteger(skill.files) ||
      typeof skill.files !== 'number' ||
      skill.files < 0 ||
      !Number.isInteger(skill.bytes) ||
      typeof skill.bytes !== 'number' ||
      skill.bytes < 0
    ) {
      throw invalidResponse('scenario proposal skill');
    }
    return {
      name: skill.name,
      directory: skill.directory,
      files: skill.files,
      bytes: skill.bytes,
    };
  });
  return {
    name: value.name,
    harness: value.harness,
    sessionMode: value.sessionMode,
    steps,
    inputs,
    skills,
  };
}

function decodeWorkspace(value: unknown): TestWorkspace {
  if (!isRecord(value)) {
    throw invalidResponse('test workspace');
  }
  const projectSource = isNonEmptyString(value.sourceProjectId) &&
    isNonEmptyString(value.sourceChainId);
  const partialProjectSource =
    (value.sourceProjectId !== undefined || value.sourceChainId !== undefined) &&
    !projectSource;
  const draftSource = isNonEmptyString(value.sourceDraftId);
  const discoverySource = value.purpose === 'discovery' &&
    isNonEmptyString(value.discoveryGoal) &&
    Array.isArray(value.discoverySkillNames) &&
    value.discoverySkillNames.every(isNonEmptyString);
  const sourceCount = Number(projectSource) + Number(draftSource) + Number(discoverySource);
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.projectId) ||
    sourceCount !== 1 ||
    partialProjectSource ||
    value.purpose !== undefined &&
      value.purpose !== 'test' &&
      value.purpose !== 'discovery' ||
    !isNonEmptyString(value.chainId) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.path)
  ) {
    throw invalidResponse('test workspace');
  }
  return {
    id: value.id,
    projectId: value.projectId,
    ...(value.purpose === 'test' || value.purpose === 'discovery'
      ? { purpose: value.purpose }
      : {}),
    ...(isNonEmptyString(value.sourceProjectId) ? { sourceProjectId: value.sourceProjectId } : {}),
    ...(isNonEmptyString(value.sourceChainId) ? { sourceChainId: value.sourceChainId } : {}),
    ...(isNonEmptyString(value.sourceDraftId) ? { sourceDraftId: value.sourceDraftId } : {}),
    ...(isNonEmptyString(value.discoveryGoal) ? { discoveryGoal: value.discoveryGoal } : {}),
    ...(isNonEmptyString(value.discoverySourceProjectId)
      ? { discoverySourceProjectId: value.discoverySourceProjectId }
      : {}),
    ...(Array.isArray(value.discoverySkillNames) &&
      value.discoverySkillNames.every(isNonEmptyString)
      ? { discoverySkillNames: value.discoverySkillNames }
      : {}),
    chainId: value.chainId,
    createdAt: value.createdAt,
    path: value.path,
  };
}

function optionsFor(signal?: AbortSignal): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

export function createTestWorkspacesApi(
  fetchImpl: FetchLike = fetch,
): TestWorkspacesApi {
  return {
    async create(input, options = {}) {
      const value = await requestJson<unknown>(
        '/api/test-workspaces',
        {
          method: 'POST',
          body: input,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.workspace === undefined) {
        throw invalidResponse('test-workspace creation');
      }
      return decodeWorkspace(value.workspace);
    },

    async createDiscovery(input, options = {}) {
      const value = await requestJson<unknown>(
        '/api/test-workspaces/discovery',
        {
          method: 'POST',
          body: input,
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.workspace === undefined) {
        throw invalidResponse('scenario-discovery workspace creation');
      }
      return decodeWorkspace(value.workspace);
    },

    async getProposal(id, options = {}) {
      const value = await requestJson<unknown>(
        `/api/test-workspaces/${encodeURIComponent(id)}/proposal`,
        optionsFor(options.signal),
        fetchImpl,
      );
      if (!isRecord(value) || value.proposal === undefined) {
        throw invalidResponse('scenario proposal lookup');
      }
      return value.proposal === null ? null : decodeProposal(value.proposal);
    },

    async acceptProposal(id, name, options = {}) {
      const value = await requestJson<unknown>(
        `/api/test-workspaces/${encodeURIComponent(id)}/proposal/accept`,
        {
          method: 'POST',
          body: name === undefined ? {} : { name },
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (
        !isRecord(value) ||
        !isRecord(value.chain) ||
        !isNonEmptyString(value.chain.id) ||
        !isNonEmptyString(value.chain.name) ||
        value.proposalAccepted !== true
      ) {
        throw invalidResponse('scenario proposal acceptance');
      }
      return { id: value.chain.id, name: value.chain.name };
    },

    async list(options = {}) {
      const value = await requestJson<unknown>(
        '/api/test-workspaces',
        optionsFor(options.signal),
        fetchImpl,
      );
      if (!isRecord(value) || !Array.isArray(value.workspaces)) {
        throw invalidResponse('test-workspace list');
      }
      return value.workspaces.map(decodeWorkspace);
    },

    async remove(id, options = {}) {
      const value = await requestJson<unknown>(
        `/api/test-workspaces/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          ...optionsFor(options.signal),
        },
        fetchImpl,
      );
      if (!isRecord(value) || value.id !== id || value.removed !== true) {
        throw invalidResponse('test-workspace removal');
      }
      return { id, removed: true };
    },
  };
}

export const testWorkspacesApi = createTestWorkspacesApi();
