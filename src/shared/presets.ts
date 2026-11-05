import type { ChainStep } from './chain.js';

export const SCENARIO_AUDIENCES = [
  'business',
  'student',
  'app-developer',
  'game-developer',
] as const;
export type ScenarioAudience = (typeof SCENARIO_AUDIENCES)[number];

export interface ScenarioInput {
  name: string;
  label: string;
  required: boolean;
  defaultValue?: string;
}

export interface ScenarioVariant {
  id: string;
  name: string;
  description: string;
  steps: ChainStep[];
  inputs: ScenarioInput[];
  outputs: string[];
  notes: string[];
}

export interface Scenario {
  id: string;
  audience: ScenarioAudience;
  name: string;
  summary: string;
  variants: ScenarioVariant[];
}

export interface ScenarioSkillSource {
  name: string;
  repository: string;
  repositoryUrl: string;
  skillUrl: string;
  skillFileUrl: string;
  revision: string;
  bundled: boolean;
  license: 'MIT' | 'Apache-2.0';
  popularity: string;
  installationCommand: string;
  prerequisites: string[];
}

export interface ScenarioCatalog {
  message: string;
  skills: ScenarioSkillSource[];
  scenarios: Scenario[];
}
