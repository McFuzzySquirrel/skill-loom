export interface HelpTopic {
  title: string;
  summary: string;
}

export const HELP_TOPICS = {
  steps: {
    title: 'Steps',
    summary: 'Steps run in the displayed order. Reorder with the buttons or by dragging, and select a step to edit its instruction.',
  },
  stepEditor: {
    title: 'Step editor',
    summary: 'Write a clear instruction for this step. Use declared {{input_name}} placeholders for values that should be collected before a run.',
  },
  inputs: {
    title: 'Chain inputs',
    summary: 'Declare reusable input names and reference them in instructions with {{name}}. Required values must be supplied before starting.',
  },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicId = keyof typeof HELP_TOPICS;
