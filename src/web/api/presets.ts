import {
  ApiClientError,
  requestJson,
  type FetchLike,
  type RequestJsonOptions,
} from './client.js';
import { decodeChainStep } from './chains.js';
import {
  SCENARIO_AUDIENCES,
  type Scenario,
  type ScenarioAudience,
  type ScenarioCatalog,
  type ScenarioInput,
  type ScenarioSkillSource,
  type ScenarioVariant,
} from '../../shared/presets.js';
import type { ChainHarness } from './chains.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(what: string): ApiClientError {
  return new ApiClientError(
    `The Skill Loom server returned an unexpected ${what} response.`,
    { code: 'INVALID_RESPONSE', status: 200 },
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function stringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw invalidResponse(what);
  }
  return [...value];
}

function decodeAudience(value: unknown): ScenarioAudience {
  for (const audience of SCENARIO_AUDIENCES) {
    if (audience === value) {
      return audience;
    }
  }
  throw invalidResponse('scenario audience');
}

function decodeInput(value: unknown): ScenarioInput {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.label) ||
    typeof value.required !== 'boolean'
  ) {
    throw invalidResponse('scenario input');
  }
  if (value.defaultValue !== undefined && typeof value.defaultValue !== 'string') {
    throw invalidResponse('scenario input default');
  }
  return {
    name: value.name,
    label: value.label,
    required: value.required,
    ...(typeof value.defaultValue === 'string'
      ? { defaultValue: value.defaultValue }
      : {}),
  };
}

function decodeVariant(value: unknown): ScenarioVariant {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.description) ||
    !Array.isArray(value.steps) ||
    !Array.isArray(value.inputs)
  ) {
    throw invalidResponse('scenario variant');
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    steps: value.steps.map((step) => decodeChainStep(step)),
    inputs: value.inputs.map(decodeInput),
    outputs: stringArray(value.outputs, 'scenario outputs'),
    notes: stringArray(value.notes, 'scenario notes'),
  };
}

function decodeScenario(value: unknown): Scenario {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.summary) ||
    !Array.isArray(value.variants) ||
    value.variants.length === 0
  ) {
    throw invalidResponse('scenario');
  }
  return {
    id: value.id,
    audience: decodeAudience(value.audience),
    name: value.name,
    summary: value.summary,
    variants: value.variants.map(decodeVariant),
  };
}

function decodeSkill(value: unknown): ScenarioSkillSource {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.repository) ||
    !isNonEmptyString(value.repositoryUrl) ||
    !isNonEmptyString(value.skillUrl) ||
    !isNonEmptyString(value.skillFileUrl) ||
    !isNonEmptyString(value.revision) ||
    typeof value.bundled !== 'boolean' ||
    (value.license !== 'MIT' && value.license !== 'Apache-2.0') ||
    !isNonEmptyString(value.popularity) ||
    !isNonEmptyString(value.installationCommand)
  ) {
    throw invalidResponse('scenario skill source');
  }
  return {
    name: value.name,
    repository: value.repository,
    repositoryUrl: value.repositoryUrl,
    skillUrl: value.skillUrl,
    skillFileUrl: value.skillFileUrl,
    revision: value.revision,
    bundled: value.bundled,
    license: value.license,
    popularity: value.popularity,
    installationCommand: value.installationCommand,
    prerequisites: stringArray(value.prerequisites, 'scenario skill prerequisites'),
  };
}

export interface ScenarioSkillCopyResult {
  name: string;
  harness: ChainHarness;
  destinationPath: string;
  revision: string;
  catalogSkillId: string;
}

function decodeSkillCopyResult(value: unknown): ScenarioSkillCopyResult {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    (value.harness !== 'opencode' && value.harness !== 'copilot') ||
    !isNonEmptyString(value.destinationPath) ||
    !isNonEmptyString(value.revision) ||
    !isNonEmptyString(value.catalogSkillId)
  ) {
    throw invalidResponse('scenario skill copy');
  }
  return {
    name: value.name,
    harness: value.harness,
    destinationPath: value.destinationPath,
    revision: value.revision,
    catalogSkillId: value.catalogSkillId,
  };
}

export function decodeScenarioCatalog(value: unknown): ScenarioCatalog {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.message) ||
    !Array.isArray(value.skills) ||
    !Array.isArray(value.scenarios)
  ) {
    throw invalidResponse('scenario catalog');
  }
  const skills = value.skills.map(decodeSkill);
  const scenarios = value.scenarios.map(decodeScenario);
  const sources = new Set(skills.map((skill) => skill.name));
  for (const candidate of scenarios) {
    for (const preset of candidate.variants) {
      for (const step of preset.steps) {
        if (step.kind !== 'instruction' && !sources.has(step.skillName)) {
          throw invalidResponse('scenario skill attribution');
        }
      }
    }
  }
  return { message: value.message, skills, scenarios };
}

export interface ScenarioCatalogApi {
  list: (options?: { signal?: AbortSignal }) => Promise<ScenarioCatalog>;
  copySkill: (
    projectId: string,
    skillName: string,
    harness: ChainHarness,
  ) => Promise<ScenarioSkillCopyResult>;
}

function optionsFor(signal: AbortSignal | undefined): RequestJsonOptions {
  return signal === undefined ? {} : { signal };
}

/** Fetch, validate, and decode the bundled, read-only scenario recipes. */
export function createScenarioCatalogApi(fetchImpl: FetchLike = fetch): ScenarioCatalogApi {
  return {
    async list(options = {}): Promise<ScenarioCatalog> {
      const value = await requestJson<unknown>(
        '/api/chain-presets',
        optionsFor(options.signal),
        fetchImpl,
      );
      return decodeScenarioCatalog(value);
    },
    async copySkill(
      projectId: string,
      skillName: string,
      harness: ChainHarness,
    ): Promise<ScenarioSkillCopyResult> {
      const value = await requestJson<unknown>(
        `/api/projects/${encodeURIComponent(projectId)}/catalog/scenario-skills/${encodeURIComponent(skillName)}/copy`,
        { method: 'POST', body: { harness } },
        fetchImpl,
      );
      return decodeSkillCopyResult(value);
    },
  };
}

export const scenarioCatalogApi = createScenarioCatalogApi();
