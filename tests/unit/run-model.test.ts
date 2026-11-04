import { describe, expect, it } from 'vitest';
import { CHAIN_VERSION, type Chain } from '../../src/server/chains/model.js';
import {
  MAX_TAIL_BYTES,
  MAX_TAIL_LINES,
  RUN_VERSION,
  RunError,
  RunInputError,
  RunUnsupportedVersionError,
  RunValidationError,
  appendStepTail,
  countTailLines,
  createRunId,
  createRunRecord,
  isActiveRunStatus,
  isFinalRunStatus,
  isTailWithinLimits,
  markRunInterrupted,
  parseRun,
  parseRunDocument,
  setStepTail,
  tailByteLength,
  trimTail,
  type Run,
} from '../../src/server/runs/model.js';

const CREATED_AT = '2026-11-04T10:00:00.000Z';

function makeChain(overrides: Record<string, unknown> = {}): Chain {
  return {
    version: CHAIN_VERSION,
    id: 'chain-alpha',
    name: 'Alpha chain',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      {
        id: 'step-1',
        skillName: 'brainstorm',
        instruction: 'Plan the task for {{task}}.',
      },
      {
        id: 'step-2',
        skillName: 'implement',
        instruction: 'Implement the plan.',
      },
    ],
    inputs: [{ name: 'task', required: true }],
    automaticPermissionOptIn: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  } as unknown as Chain;
}

function makeRun(overrides: Partial<Run> = {}): Run {
  const run = createRunRecord({
    id: 'run-alpha',
    projectId: 'project-1',
    chain: makeChain(),
    mode: 'supervised',
    inputs: { task: 'write tests' },
    now: CREATED_AT,
  });
  return { ...run, ...overrides };
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to throw.');
}

describe('run creation and snapshot immutability', () => {
  it('deep-clones the chain, resolves inputs, and freezes the snapshot', () => {
    const chain = makeChain();
    const run = createRunRecord({
      id: 'run-snapshot',
      projectId: 'project-1',
      chain,
      mode: 'supervised',
      inputs: { task: 'ship the release', unknown: 'ignored' },
      now: new Date(CREATED_AT),
      sessionId: 'ses_abc',
      forkMechanism: 'none',
    });

    expect(run.version).toBe(RUN_VERSION);
    expect(run.chainSnapshot).toEqual(makeChain());
    expect(run.chainSnapshot).not.toBe(chain);
    expect(run.chainSnapshot.steps[0]).not.toBe(chain.steps[0]);
    expect(run.resolvedInputs).toEqual({ task: 'ship the release' });
    expect(run.status).toBe('starting');
    expect(run.currentStepIndex).toBe(0);
    expect(run.sessionId).toBe('ses_abc');
    expect(run.steps.map((step) => step.id)).toEqual(['step-1', 'step-2']);
    expect(run.steps.map((step) => step.status)).toEqual(['pending', 'pending']);
    expect(run.steps[0]).toMatchObject({
      index: 0,
      skillName: 'brainstorm',
      label: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      sessionId: null,
      skillObservation: 'unknown',
      tail: '',
    });

    // Editing the source chain after creation must not alter the frozen run.
    chain.name = 'Edited name';
    chain.steps[0]!.instruction = 'Edited instruction';
    chain.steps.push({ id: 'step-3', skillName: 'extra', instruction: 'Extra work.' });

    expect(run.chainSnapshot.name).toBe('Alpha chain');
    expect(run.chainSnapshot.steps).toHaveLength(2);
    expect(run.chainSnapshot.steps[0]?.instruction).toBe('Plan the task for {{task}}.');
    expect(parseRun(run)).toEqual(run);
  });

  it('resolves defaults and optional inputs into a concrete string map', () => {
    const run = createRunRecord({
      id: 'run-defaults',
      projectId: 'project-1',
      chain: makeChain({
        inputs: [
          { name: 'task', required: true, defaultValue: 'default task' },
          { name: 'tone' },
        ],
      }),
      mode: 'automatic',
      now: CREATED_AT,
    });

    expect(run.resolvedInputs).toEqual({ task: 'default task', tone: '' });
  });

  it('refuses to create a run when a required input is unresolved', () => {
    const error = captureError(() =>
      createRunRecord({
        id: 'run-missing-input',
        projectId: 'project-1',
        chain: makeChain(),
        mode: 'supervised',
        inputs: {},
        now: CREATED_AT,
      }),
    );

    expect(error).toBeInstanceOf(RunInputError);
    expect((error as RunInputError).code).toBe('RUN_INPUT_REQUIRED');
    expect((error as RunInputError).details).toMatchObject({ missing: ['task'] });
  });

  it('rejects malformed input values with field-specific details', () => {
    const error = captureError(() =>
      createRunRecord({
        id: 'run-bad-input',
        projectId: 'project-1',
        chain: makeChain(),
        mode: 'supervised',
        inputs: { task: 42 },
        now: CREATED_AT,
      }),
    );

    expect(error).toBeInstanceOf(RunInputError);
    expect((error as RunInputError).code).toBe('RUN_INPUT_INVALID');
    expect((error as RunInputError).details.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'task' })]),
    );
  });

  it('generates readable, safe run ids', () => {
    const first = createRunId();
    const second = createRunId();
    expect(first).toMatch(/^run-[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });
});

describe('run document validation', () => {
  it('rejects an unsupported version instead of reinterpreting it', () => {
    const run = { ...makeRun(), version: RUN_VERSION + 1 };
    expect(() => parseRunDocument(run)).toThrow(RunUnsupportedVersionError);
  });

  it('stamps an unversioned draft with the current version', () => {
    const { version: _version, ...draft } = makeRun();
    const parsed = parseRunDocument(draft);
    expect(parsed.version).toBe(RUN_VERSION);
  });

  it('rejects unknown fields so no transcript can be attached', () => {
    const run = { ...makeRun(), transcript: 'the whole session' };
    expect(() => parseRun(run)).toThrow(RunValidationError);
  });

  it('keeps step records aligned with the frozen snapshot', () => {
    const run = makeRun();
    const mismatched = {
      ...run,
      steps: run.steps.slice(0, 1),
    };
    expect(() => parseRun(mismatched)).toThrow(RunValidationError);

    const renamed = {
      ...run,
      steps: run.steps.map((step, index) =>
        index === 1 ? { ...step, id: 'step-changed' } : step,
      ),
    };
    expect(() => parseRun(renamed)).toThrow(RunValidationError);
  });

  it('rejects undeclared resolved inputs and an out-of-range current step', () => {
    const run = makeRun();
    expect(() =>
      parseRun({ ...run, resolvedInputs: { ...run.resolvedInputs, other: 'value' } }),
    ).toThrow(RunValidationError);
    expect(() => parseRun({ ...run, currentStepIndex: 99 })).toThrow(RunValidationError);
  });

  it('classifies active and final statuses exactly', () => {
    for (const status of ['starting', 'running', 'paused', 'awaiting-user'] as const) {
      expect(isActiveRunStatus(status)).toBe(true);
      expect(isFinalRunStatus(status)).toBe(false);
    }
    for (const status of ['failed', 'completed', 'aborted', 'interrupted'] as const) {
      expect(isActiveRunStatus(status)).toBe(false);
      expect(isFinalRunStatus(status)).toBe(true);
    }
  });
});

describe('bounded terminal tails', () => {
  it('keeps only the newest 200 lines', () => {
    const text = Array.from({ length: 250 }, (_, index) => `line ${String(index)}`).join('\n');
    const trimmed = trimTail(text);

    expect(countTailLines(trimmed)).toBe(MAX_TAIL_LINES);
    expect(trimmed.startsWith('line 50')).toBe(true);
    expect(trimmed.endsWith('line 249')).toBe(true);
    expect(isTailWithinLimits(trimmed)).toBe(true);
  });

  it('never exceeds 32 KiB and keeps UTF-8 valid when trimming bytes', () => {
    const text = 'é'.repeat(40_000);
    const trimmed = trimTail(text);

    expect(tailByteLength(trimmed)).toBeLessThanOrEqual(MAX_TAIL_BYTES);
    expect(trimmed.length).toBeGreaterThan(0);
    expect(trimmed.startsWith('\uFFFD')).toBe(false);
    expect(trimmed.endsWith('é')).toBe(true);
    expect(isTailWithinLimits(trimmed)).toBe(true);
  });

  it('caps the tail when it is appended and does not mutate the input run', () => {
    const run = makeRun();
    const text = Array.from({ length: 260 }, (_, index) => `chunk ${String(index)}`).join('\n');
    const grown = appendStepTail(run, 'step-1', text);

    expect(run.steps[0]?.tail).toBe('');
    expect(countTailLines(grown.steps[0]!.tail)).toBe(MAX_TAIL_LINES);
    expect(grown.steps[0]!.tail.startsWith('chunk 60')).toBe(true);

    const replaced = setStepTail(grown, 'step-2', 'x'.repeat(MAX_TAIL_BYTES + 512));
    expect(tailByteLength(replaced.steps[1]!.tail)).toBeLessThanOrEqual(MAX_TAIL_BYTES);
  });

  it('rejects a persisted run whose tail already exceeds the cap', () => {
    const run = structuredClone(makeRun());
    run.steps[0]!.tail = 'x'.repeat(MAX_TAIL_BYTES + 1);

    expect(() => parseRun(run)).toThrow(RunValidationError);
  });
});

describe('interruption marking', () => {
  it('marks a live run and its running step interrupted without mutating the input', () => {
    const run = makeRun({
      status: 'running',
      steps: makeRun().steps.map((step, index) =>
        index === 0
          ? { ...step, status: 'running' as const, startedAt: CREATED_AT }
          : step,
      ),
    });

    const interrupted = markRunInterrupted(run, '2026-11-04T11:00:00.000Z');

    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.finishedAt).toBe('2026-11-04T11:00:00.000Z');
    expect(interrupted.reason).toBe('SERVER_RESTART');
    expect(interrupted.steps[0]).toMatchObject({
      status: 'interrupted',
      finishedAt: '2026-11-04T11:00:00.000Z',
    });
    expect(interrupted.steps[1]?.status).toBe('pending');

    expect(run.status).toBe('running');
    expect(run.steps[0]?.status).toBe('running');
  });

  it('leaves a final run untouched', () => {
    const run = makeRun({ status: 'completed', finishedAt: CREATED_AT });
    const result = markRunInterrupted(run, '2026-11-04T11:00:00.000Z');
    expect(result.status).toBe('completed');
    expect(result.finishedAt).toBe(CREATED_AT);
    expect(result).not.toBe(run);
    expect(result).toEqual(run);
  });
});

describe('typed errors', () => {
  it('reports a missing step id without touching any filesystem state', () => {
    const run = makeRun();
    const error = captureError(() => appendStepTail(run, 'missing-step', 'output'));
    expect(error).toBeInstanceOf(RunError);
    expect((error as RunError).code).toBe('RUN_STEP_NOT_FOUND');
  });
});
