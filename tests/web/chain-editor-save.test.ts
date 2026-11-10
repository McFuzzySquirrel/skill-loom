import { describe, expect, it } from 'vitest';
import {
  adoptSavedIdentity,
  type ChainDraftDocument,
} from '../../src/web/hooks/useChainDraft';

function documentWithInstruction(
  instruction: string,
  overrides: Partial<ChainDraftDocument> = {},
): ChainDraftDocument {
  return {
    name: 'Review chain',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      {
        id: 'step-one',
        kind: 'instruction',
        instruction,
      },
    ],
    inputs: [],
    automaticPermissionOptIn: false,
    ...overrides,
  };
}

describe('saving while the chain is edited', () => {
  it('keeps newer local content and adopts only the saved identity', () => {
    const editedWhileSaving = documentWithInstruction('Newer local instruction');
    const saved = documentWithInstruction('Instruction the server received', {
      id: 'chain-1',
      version: 3,
      revision: 'revision-2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:05:00.000Z',
    });

    const merged = adoptSavedIdentity(editedWhileSaving, saved);

    expect(merged.steps).toEqual(editedWhileSaving.steps);
    expect(merged.inputs).toEqual(editedWhileSaving.inputs);
    expect(merged.name).toBe(editedWhileSaving.name);
    expect(merged.id).toBe('chain-1');
    expect(merged.version).toBe(3);
    expect(merged.revision).toBe('revision-2');
    expect(merged.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(merged.updatedAt).toBe('2026-01-01T00:05:00.000Z');
  });

  it('does not invent identity fields the server omitted', () => {
    const current = documentWithInstruction('Local instruction', {
      id: 'chain-1',
      version: 1,
      revision: 'revision-1',
    });
    const saved = documentWithInstruction('Server instruction');

    expect(adoptSavedIdentity(current, saved)).toMatchObject({
      id: 'chain-1',
      version: 1,
      revision: 'revision-1',
    });
  });
});
