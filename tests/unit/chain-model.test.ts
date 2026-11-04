import { describe, expect, it } from 'vitest';
import {
  CHAIN_ISSUE_CODES,
  CHAIN_SESSION_MODES,
  CHAIN_TOP_LEVEL_FIELDS,
  CHAIN_VERSION,
  CHAIN_WARNING_CODES,
  ChainSchema,
  ChainUnsupportedVersionError,
  ChainValidationError,
  collectChainWarnings,
  migrateChainDocument,
  parseChain,
  parseChainDocument,
  safeValidateChain,
  validateChain,
  type Chain,
  type ChainValidationIssue,
} from '../../src/server/chains/model.js';

const CREATED_AT = '2026-11-04T12:00:00.000Z';
const UPDATED_AT = '2026-11-04T12:30:00.000Z';

function validChain(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: CHAIN_VERSION,
    id: 'chain-abc123',
    name: 'Ship the feature',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      {
        id: 'step-1',
        skillName: 'brainstorm',
        instruction: 'Plan the task {{task}}.',
        label: 'Plan',
      },
      {
        id: 'step-2',
        skillName: 'implement',
        instruction: 'Implement the plan for {{task}}.',
      },
    ],
    inputs: [
      { name: 'task', label: 'Task', required: true },
      { name: 'audience', label: 'Audience', required: false, defaultValue: 'maintainers' },
    ],
    automaticPermissionOptIn: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function issuesOf(error: unknown): ChainValidationIssue[] {
  expect(error).toBeInstanceOf(ChainValidationError);
  return (error as ChainValidationError).issues;
}

function expectInvalid(value: unknown): ChainValidationIssue[] {
  try {
    validateChain(value);
  } catch (error) {
    return issuesOf(error);
  }
  throw new Error('Expected the chain to be rejected.');
}

describe('chain version', () => {
  it('documents the current persisted version and field order', () => {
    expect(CHAIN_VERSION).toBe(1);
    expect(CHAIN_TOP_LEVEL_FIELDS).toEqual([
      'version',
      'id',
      'name',
      'harness',
      'sessionMode',
      'steps',
      'inputs',
      'automaticPermissionOptIn',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('migrates an unversioned pre-versioning draft without mutating it', () => {
    const legacy = validChain();
    delete legacy.version;

    const snapshot = structuredClone(legacy);
    const migrated = migrateChainDocument(legacy) as Record<string, unknown>;

    expect(migrated.version).toBe(CHAIN_VERSION);
    expect(legacy).toEqual(snapshot);

    const result = parseChainDocument(legacy);
    expect(result.chain.version).toBe(CHAIN_VERSION);
    expect(result.chain.name).toBe('Ship the feature');
  });

  it('parses a current-version document through the migration seam', () => {
    const document = validChain();
    const result = parseChainDocument(document);

    expect(result.chain).toEqual(ChainSchema.parse(document));
  });

  it('rejects a future or otherwise unsupported version with a typed error', () => {
    const future = validChain({ version: CHAIN_VERSION + 1 });

    expect(() => parseChainDocument(future)).toThrow(ChainUnsupportedVersionError);
    try {
      parseChainDocument(future);
    } catch (error) {
      expect(error).toBeInstanceOf(ChainUnsupportedVersionError);
      expect((error as ChainUnsupportedVersionError).details).toMatchObject({
        version: CHAIN_VERSION + 1,
        supportedVersion: CHAIN_VERSION,
      });
    }
  });

  it('does not silently accept a document whose version is not the literal current version', () => {
    const wrongType = validChain({ version: String(CHAIN_VERSION) });
    expect(() => parseChainDocument(wrongType)).toThrow(ChainUnsupportedVersionError);

    const missing = validChain();
    delete missing.version;
    // Missing versions are migrated, so the rest of the document is still valid.
    expect(parseChainDocument(missing).chain.version).toBe(CHAIN_VERSION);
  });
});

describe('valid chains', () => {
  it('accepts named inputs and placeholders and applies documented defaults', () => {
    const result = validateChain(validChain());
    const chain: Chain = result.chain;

    expect(chain.version).toBe(CHAIN_VERSION);
    expect(chain.steps.map((step) => step.id)).toEqual(['step-1', 'step-2']);
    expect(chain.inputs[0]).toEqual({ name: 'task', label: 'Task', required: true });
    expect(chain.inputs[1]).toEqual({
      name: 'audience',
      label: 'Audience',
      required: false,
      defaultValue: 'maintainers',
    });
    expect(chain.automaticPermissionOptIn).toBe(false);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: CHAIN_WARNING_CODES.INPUT_UNUSED,
        inputName: 'audience',
      }),
    ]);
  });

  it('defaults inputs to an empty list and the permission opt-in to off', () => {
    const chain = parseChain(
      validChain({
        steps: [{ id: 'step-1', skillName: 'plan', instruction: 'No placeholders here.' }],
        inputs: undefined,
        automaticPermissionOptIn: undefined,
      }),
    );

    expect(chain.inputs).toEqual([]);
    expect(chain.automaticPermissionOptIn).toBe(false);
    expect(chain.steps[0]?.label).toBeUndefined();
    expect(validateChain(chain).warnings).toEqual([]);
  });

  it('accepts every declared harness and session mode without per-step harness data', () => {
    for (const harness of ['opencode', 'copilot']) {
      for (const sessionMode of CHAIN_SESSION_MODES) {
        const chain = parseChain(validChain({ harness, sessionMode }));
        expect(chain.harness).toBe(harness);
        expect(chain.sessionMode).toBe(sessionMode);
      }
    }
  });

  it('allows the same skill to appear in more than one step', () => {
    const chain = parseChain(
      validChain({
        steps: [
          { id: 'step-1', skillName: 'implement', instruction: 'First pass.' },
          { id: 'step-2', skillName: 'implement', instruction: 'Second pass.' },
        ],
        inputs: [],
      }),
    );

    expect(chain.steps).toHaveLength(2);
  });

  it('rejects a per-step harness because a chain is bound to exactly one harness', () => {
    const issues = expectInvalid(
      validChain({
        steps: [
          {
            id: 'step-1',
            skillName: 'plan',
            instruction: 'Do it.',
            harness: 'copilot',
          },
        ],
        inputs: [],
      }),
    );

    expect(issues.some((issue) => issue.message.includes('harness'))).toBe(true);
  });

  it('allows unused declared inputs but reports them as non-blocking warnings', () => {
    const result = validateChain(
      validChain({
        steps: [{ id: 'step-1', skillName: 'plan', instruction: 'No template.' }],
        inputs: [{ name: 'reserved', required: false }],
      }),
    );

    expect(result.warnings).toEqual([
      {
        path: 'inputs.0.name',
        code: CHAIN_WARNING_CODES.INPUT_UNUSED,
        message: 'Input "reserved" is declared but never used in an instruction.',
        inputName: 'reserved',
      },
    ]);
  });

  it('exposes warnings for an already-parsed chain', () => {
    const chain = parseChain(validChain());
    expect(collectChainWarnings(chain)).toEqual([
      expect.objectContaining({ code: CHAIN_WARNING_CODES.INPUT_UNUSED, inputName: 'audience' }),
    ]);
  });
});

describe('field-specific structure failures', () => {
  it('rejects an empty or whitespace-only name', () => {
    for (const name of ['', '   ']) {
      const issues = expectInvalid(validChain({ name }));
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'name', message: expect.stringMatching(/too small/i) }),
        ]),
      );
    }
  });

  it('rejects a missing name', () => {
    const document = validChain();
    delete document.name;
    const issues = expectInvalid(document);

    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'name', code: 'invalid_type' })]),
    );
  });

  it('rejects an empty step list', () => {
    const issues = expectInvalid(validChain({ steps: [] }));

    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'steps', code: 'too_small' })]),
    );
  });

  it('rejects a missing or whitespace-only instruction and names the step path', () => {
    const issues = expectInvalid(
      validChain({
        steps: [
          { id: 'step-1', skillName: 'plan', instruction: '   ' },
          { id: 'step-2', skillName: 'implement' },
        ],
      }),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'steps.0.instruction' }),
        expect.objectContaining({ path: 'steps.1.instruction', code: 'invalid_type' }),
      ]),
    );
  });

  it('rejects an empty step id or skill name', () => {
    const issues = expectInvalid(
      validChain({
        steps: [
          { id: '', skillName: 'plan', instruction: 'Do it.' },
          { id: 'step-2', skillName: '  ', instruction: 'Do it again.' },
        ],
        inputs: [],
      }),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'steps.0.id' }),
        expect.objectContaining({ path: 'steps.1.skillName' }),
      ]),
    );
  });

  it('rejects a whitespace-only optional label instead of storing it', () => {
    const issues = expectInvalid(
      validChain({
        steps: [{ id: 'step-1', skillName: 'plan', instruction: 'Do it.', label: '  ' }],
        inputs: [],
      }),
    );

    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'steps.0.label' })]),
    );
  });

  it('rejects missing timestamps and invalid timestamp formats', () => {
    const missing = validChain({ updatedAt: undefined });
    delete missing.updatedAt;
    expect(expectInvalid(missing)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'updatedAt', code: 'invalid_type' })]),
    );

    expect(expectInvalid(validChain({ createdAt: 'yesterday' }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'createdAt' })]),
    );
  });

  it('rejects an unknown harness and an unknown session mode', () => {
    expect(expectInvalid(validChain({ harness: 'gemini' }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'harness', code: 'invalid_value' })]),
    );
    expect(expectInvalid(validChain({ sessionMode: 'parallel' }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'sessionMode', code: 'invalid_value' })]),
    );
  });

  it('rejects a chain with no harness at all', () => {
    const document = validChain();
    delete document.harness;
    expect(expectInvalid(document)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'harness', code: 'invalid_value' })]),
    );
  });
});

describe('duplicates and placeholder resolution', () => {
  it('rejects duplicate step ids and identifies the repeated id', () => {
    const issues = expectInvalid(
      validChain({
        steps: [
          { id: 'duplicate', skillName: 'plan', instruction: 'One.' },
          { id: 'duplicate', skillName: 'implement', instruction: 'Two.' },
        ],
        inputs: [],
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        path: 'steps.1.id',
        code: CHAIN_ISSUE_CODES.DUPLICATE_STEP_ID,
        stepId: 'duplicate',
        stepIndex: 1,
      }),
    ]);
  });

  it('rejects duplicate input names and identifies the repeated name', () => {
    const issues = expectInvalid(
      validChain({
        steps: [{ id: 'step-1', skillName: 'plan', instruction: 'Use {{task}}.' }],
        inputs: [
          { name: 'task', required: true },
          { name: 'task', required: false },
        ],
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        path: 'inputs.1.name',
        code: CHAIN_ISSUE_CODES.DUPLICATE_INPUT_NAME,
        inputName: 'task',
      }),
    ]);
  });

  it('rejects invalid input-name syntax', () => {
    for (const name of ['1task', 'task-name', 'task name', '']) {
      const issues = expectInvalid(
        validChain({
          steps: [{ id: 'step-1', skillName: 'plan', instruction: 'Do it.' }],
          inputs: [{ name, required: false }],
        }),
      );
      expect(issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'inputs.0.name' })]),
      );
    }
  });

  it('rejects an undeclared placeholder and reports the step and input name', () => {
    const issues = expectInvalid(
      validChain({
        steps: [
          {
            id: 'step-2',
            skillName: 'implement',
            instruction: 'Implement {{task}} for {{audience}}.',
            label: 'Build',
          },
        ],
        inputs: [{ name: 'task', required: true }],
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        path: 'steps.0.instruction',
        code: CHAIN_ISSUE_CODES.PLACEHOLDER_UNKNOWN,
        stepId: 'step-2',
        stepIndex: 0,
        inputName: 'audience',
        message: expect.stringContaining('Build'),
      }),
    ]);
    expect(issues[0]?.message).toContain('audience');
  });

  it('reports one issue per unresolved input per step and preserves resolved placeholders', () => {
    const result = validateChain(
      validChain({
        steps: [
          {
            id: 'step-1',
            skillName: 'plan',
            instruction: 'Use {{task}}, {{task}}, and {{task}}.',
          },
        ],
        inputs: [{ name: 'task', required: true }],
      }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.chain.steps[0]?.instruction).toBe('Use {{task}}, {{task}}, and {{task}}.');

    const issues = expectInvalid(
      validChain({
        steps: [
          {
            id: 'step-1',
            skillName: 'plan',
            instruction: 'Use {{missing}} and {{missing}}.',
          },
        ],
        inputs: [],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.inputName).toBe('missing');
  });

  it('rejects a placeholder that does not use identifier syntax', () => {
    const issues = expectInvalid(
      validChain({
        steps: [{ id: 'step-1', skillName: 'plan', instruction: 'Use {{bad-name}}.' }],
        inputs: [],
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        path: 'steps.0.instruction',
        code: CHAIN_ISSUE_CODES.PLACEHOLDER_INVALID,
        inputName: 'bad-name',
      }),
    ]);
  });

  it('rejects an empty placeholder expression', () => {
    const issues = expectInvalid(
      validChain({
        steps: [{ id: 'step-1', skillName: 'plan', instruction: 'Use {{}}.' }],
        inputs: [],
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        path: 'steps.0.instruction',
        code: CHAIN_ISSUE_CODES.PLACEHOLDER_INVALID,
      }),
    ]);
  });

  it('trims surrounding whitespace inside a placeholder before resolving it', () => {
    const result = validateChain(
      validChain({
        steps: [{ id: 'step-1', skillName: 'plan', instruction: 'Use {{ task }}.' }],
        inputs: [{ name: 'task', required: true }],
      }),
    );

    expect(result.warnings).toEqual([]);
  });
});

describe('safe validation', () => {
  it('returns a discriminated failure with typed issues instead of throwing', () => {
    const result = safeValidateChain(validChain({ name: '' }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ChainValidationError);
      expect((result.error as ChainValidationError).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'name' })]),
      );
    }
  });

  it('returns the parsed chain and warnings on success', () => {
    const result = safeValidateChain(validChain());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.chain.version).toBe(CHAIN_VERSION);
      expect(result.warnings).toHaveLength(1);
    }
  });
});
