import { expect, test } from '@playwright/test';
import { decodeChain, normalizeChainDraft, type Chain } from '../../src/web/api/chains.js';
import {
  collectPlaceholderIssues,
  collectStepInstructionIssues,
  documentFromChain,
  serializeChainDraft,
  stepDisplayName,
} from '../../src/web/hooks/useChainDraft.js';

const chain: Chain = {
  version: 1,
  id: 'plain-chain',
  name: 'Instructions',
  harness: 'opencode',
  sessionMode: 'shared',
  steps: [
    { id: 'plain', kind: 'instruction', instruction: 'Plan {{task}}.', label: 'Think' },
    { id: 'legacy', skillName: 'review', instruction: 'Review {{task}}.' },
  ],
  inputs: [{ name: 'task', required: true }],
  automaticPermissionOptIn: false,
  createdAt: '2026-11-05T12:00:00.000Z',
  updatedAt: '2026-11-05T12:00:00.000Z',
};

test.describe('instruction step browser data', () => {
  test('decodes mixed steps without inventing skills or changing legacy steps', () => {
    expect(decodeChain(chain)).toEqual(chain);
    for (const step of [
      { id: 'plain', kind: 'instruction', skillName: 'review', instruction: 'Plan.' },
      { id: 'plain', kind: 'unknown', instruction: 'Plan.' },
      { id: 'plain', instruction: 'Plan.' },
    ]) {
      expect(() => decodeChain({ ...chain, steps: [step] })).toThrow();
    }
  });

  test('preserves explicit instruction kind in normalized saves and dirty tracking', () => {
    const document = documentFromChain(chain);
    const saved = normalizeChainDraft({
      ...document,
      steps: [{ ...chain.steps[0]!, label: '  ' }, chain.steps[1]!],
    });
    expect(saved.steps[0]).toEqual({
      id: 'plain', kind: 'instruction', instruction: 'Plan {{task}}.',
    });
    expect(JSON.parse(serializeChainDraft(document)).steps).toEqual(chain.steps);
    expect(serializeChainDraft({ ...document, steps: [...document.steps].reverse() }))
      .not.toBe(serializeChainDraft(document));
  });

  test('uses instruction labels and validates prompts and named inputs', () => {
    expect(stepDisplayName(chain.steps[0]!)).toBe('Think');
    expect(stepDisplayName({ id: 'plain', kind: 'instruction', instruction: 'Plan.' }))
      .toBe('Instruction');
    expect(collectPlaceholderIssues(chain.steps, chain.inputs)).toEqual([]);
    expect(collectPlaceholderIssues(chain.steps, [])).toHaveLength(2);
    expect(collectStepInstructionIssues([
      { id: 'plain', kind: 'instruction', instruction: '  ' },
    ])).toEqual([expect.objectContaining({ stepId: 'plain', kind: 'step' })]);
  });
});
