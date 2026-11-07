interface ChainStepContent {
  id: string;
  instruction: string;
  label?: string | undefined;
}

/** Immutable identity for a skill package retained from a remote snapshot. */
export interface SkillSnapshotBinding {
  sourceId: string;
  revision: string;
  repositoryPath: string;
}

export interface SkillChainStep extends ChainStepContent {
  kind?: 'skill' | undefined;
  skillName: string;
  skillBinding?: SkillSnapshotBinding | undefined;
}

export interface InstructionChainStep extends ChainStepContent {
  kind: 'instruction';
  skillName?: never | undefined;
}

export type ChainStep = SkillChainStep | InstructionChainStep;

/** Immutable identity for the native agent selected by a chain. */
export interface ChainAgentSelection {
  harness: 'opencode' | 'copilot';
  name: string;
  sourceId: string;
  revision: string;
  repositoryPath: string;
  agentPath: string;
  fingerprint: string;
}

export function chainStepName(step: ChainStep): string {
  return step.label?.trim() || (step.kind === 'instruction' ? 'Instruction' : step.skillName);
}
