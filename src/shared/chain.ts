interface ChainStepContent {
  id: string;
  instruction: string;
  label?: string | undefined;
}

export interface SkillChainStep extends ChainStepContent {
  kind?: 'skill' | undefined;
  skillName: string;
}

export interface InstructionChainStep extends ChainStepContent {
  kind: 'instruction';
  skillName?: never | undefined;
}

export type ChainStep = SkillChainStep | InstructionChainStep;

export function chainStepName(step: ChainStep): string {
  return step.label?.trim() || (step.kind === 'instruction' ? 'Instruction' : step.skillName);
}
