import { describe, expect, it } from 'vitest';
import { CHAIN_VERSION, type Chain } from '../../src/server/chains/model.js';
import { createCopilotAdapter } from '../../src/server/harness/copilot.js';
import { createOpenCodeAdapter } from '../../src/server/harness/opencode.js';
import {
  HANDOFF_HEADING,
  MAX_HANDOFF_BYTES,
  MAX_HANDOFF_LINES,
  buildHandoffNote,
  sanitizeHandoffText,
} from '../../src/server/runs/handoff.js';
import {
  RUN_PROMPT_ERROR_CODES,
  RunPromptError,
  assembleStepPrompt,
  buildStepPrompt,
  planRunSessions,
  resolveStepInstruction,
  type SessionCapabilities,
} from '../../src/server/runs/prompts.js';

const CREATED_AT = '2026-11-04T10:00:00.000Z';

function makeChain(overrides: Partial<Chain> = {}): Chain {
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
        label: 'Plan',
      },
      {
        id: 'step-2',
        skillName: 'implement',
        instruction: 'Implement the plan.',
        label: 'Build',
      },
    ],
    inputs: [{ name: 'task', required: true }],
    automaticPermissionOptIn: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function captureError(operation: () => unknown): RunPromptError {
  try {
    operation();
  } catch (error) {
    if (error instanceof RunPromptError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the operation to throw a RunPromptError.');
}

function sequentialSessionIds(prefix = 'ses_test'): {
  create: () => string;
  calls: () => number;
} {
  let value = 0;
  return {
    create: () => {
      value += 1;
      return `${prefix}_${String(value)}`;
    },
    calls: () => value,
  };
}

const OPENCODE = createOpenCodeAdapter();
const COPILOT = createCopilotAdapter();

describe('step prompt assembly', () => {
  it('names the skill explicitly and includes the resolved instruction exactly', () => {
    const chain = makeChain({
      steps: [
        {
          id: 'step-1',
          skillName: 'brainstorm',
          instruction: 'Plan the task for {{task}} in {{ project }}.',
          label: 'Plan',
        },
      ],
      inputs: [
        { name: 'task', required: true },
        { name: 'project', required: true },
      ],
    });

    const prompt = assembleStepPrompt({
      chain,
      stepIndex: 0,
      inputs: { task: 'ship it', project: 'loom' },
    });

    expect(prompt).toBe(
      'Skill: brainstorm\n\nInstruction:\nPlan the task for ship it in loom.',
    );
    expect(prompt).toContain('brainstorm');
    expect(prompt).not.toContain('{{');
  });

  it('substitutes every occurrence and preserves an empty optional value', () => {
    const chain = makeChain({
      steps: [
        {
          id: 'step-1',
          skillName: 'review',
          instruction: 'Review {{target}} then review {{target}} again{{notes}}.',
        },
      ],
      inputs: [
        { name: 'target', required: true },
        { name: 'notes', required: false },
      ],
    });

    const instruction = resolveStepInstruction(chain.steps[0]!, {
      target: 'the diff',
      notes: '',
    });

    expect(instruction).toBe('Review the diff then review the diff again.');
  });

  it('fails before any spawn when a required input is missing', () => {
    const chain = makeChain();
    const error = captureError(() =>
      assembleStepPrompt({ chain, stepIndex: 0, inputs: {} }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.INPUT_REQUIRED);
    expect(error.message).toContain('task');
    expect(error.details).toMatchObject({
      stepId: 'step-1',
      stepIndex: 0,
      missing: ['task'],
      inputNames: ['task'],
    });
  });

  it('fails before any spawn when a required input is whitespace only', () => {
    const chain = makeChain();
    const error = captureError(() =>
      assembleStepPrompt({ chain, stepIndex: 0, inputs: { task: '   ' } }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.INPUT_REQUIRED);
    expect(error.details.missing).toEqual(['task']);
  });

  it('names the step and the placeholder when a placeholder is unresolved', () => {
    const chain = makeChain({
      steps: [
        {
          id: 'step-2',
          skillName: 'implement',
          instruction: 'Implement the plan for {{task}}.',
          label: 'Build',
        },
      ],
      inputs: [{ name: 'task', required: false }],
    });

    const error = captureError(() =>
      assembleStepPrompt({ chain, stepIndex: 0, inputs: {} }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.PLACEHOLDER_UNRESOLVED);
    expect(error.message).toContain('Step 1');
    expect(error.message).toContain('Build');
    expect(error.message).toContain('{{task}}');
    expect(error.details).toMatchObject({
      stepId: 'step-2',
      stepIndex: 0,
      stepLabel: 'Build',
      placeholder: 'task',
      inputName: 'task',
    });
  });

  it('rejects an invalid placeholder name before substituting it', () => {
    const chain = makeChain({
      steps: [
        {
          id: 'step-1',
          skillName: 'brainstorm',
          instruction: 'Plan for {{bad name}}.',
        },
      ],
      inputs: [],
    });

    const error = captureError(() =>
      assembleStepPrompt({ chain, stepIndex: 0, inputs: {} }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.PLACEHOLDER_INVALID);
    expect(error.details).toMatchObject({
      stepId: 'step-1',
      placeholder: '{{bad name}}',
      inputName: 'bad name',
    });
  });

  it('rejects a missing step index', () => {
    const chain = makeChain();
    const error = captureError(() =>
      assembleStepPrompt({ chain, stepIndex: 9, inputs: { task: 'x' } }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.STEP_NOT_FOUND);
    expect(error.details).toMatchObject({ stepIndex: 9, stepCount: 2 });
  });
});

describe('session planning', () => {
  it('reuses one session id for every shared step', () => {
    const ids = sequentialSessionIds();
    const chain = makeChain({ sessionMode: 'shared' });
    const plan = planRunSessions({
      chain,
      capabilities: OPENCODE,
      mode: 'supervised',
      createSessionId: ids.create,
    });

    expect(plan).toMatchObject({
      sessionMode: 'shared',
      surface: 'interactive',
      mechanism: 'none',
      nativeFork: true,
    });
    expect(plan.steps.map((step) => step.sessionId)).toEqual([
      'ses_test_1',
      'ses_test_1',
    ]);
    expect(plan.steps.every((step) => step.forkMechanism === 'none')).toBe(true);
    expect(ids.calls()).toBe(1);
  });

  it('honors an explicit run session id for shared mode', () => {
    const ids = sequentialSessionIds();
    const plan = planRunSessions({
      chain: makeChain({ sessionMode: 'shared' }),
      capabilities: OPENCODE,
      mode: 'automatic',
      runSessionId: 'ses_run_level',
      createSessionId: ids.create,
    });

    expect(plan.surface).toBe('headless');
    expect(plan.steps.map((step) => step.sessionId)).toEqual([
      'ses_run_level',
      'ses_run_level',
    ]);
    expect(ids.calls()).toBe(0);
  });

  it('creates a new session id for every fresh step', () => {
    const ids = sequentialSessionIds();
    const plan = planRunSessions({
      chain: makeChain({ sessionMode: 'fresh' }),
      capabilities: COPILOT,
      mode: 'automatic',
      createSessionId: ids.create,
    });

    expect(plan.sessionMode).toBe('fresh');
    expect(plan.steps.map((step) => step.sessionId)).toEqual([
      'ses_test_1',
      'ses_test_2',
    ]);
    expect(plan.steps.map((step) => step.forkMechanism)).toEqual([
      'none',
      'none',
    ]);
    expect(plan.steps.every((step) => step.handoffRequired === false)).toBe(true);
  });

  it('plans a native OpenCode fork only on the headless surface', () => {
    const ids = sequentialSessionIds();
    const chain = makeChain({ sessionMode: 'fork' });

    const automatic = planRunSessions({
      chain,
      capabilities: OPENCODE,
      mode: 'automatic',
      createSessionId: ids.create,
    });
    expect(automatic.mechanism).toBe('native');
    expect(automatic.steps[0]).toMatchObject({
      sessionId: 'ses_test_1',
      forkMechanism: 'none',
      forkFromSessionId: null,
      handoffRequired: false,
    });
    expect(automatic.steps[1]).toMatchObject({
      sessionId: 'ses_test_2',
      forkMechanism: 'native',
      forkFromSessionId: 'ses_test_1',
      handoffRequired: false,
    });

    const supervised = planRunSessions({
      chain,
      capabilities: OPENCODE,
      mode: 'supervised',
      createSessionId: sequentialSessionIds().create,
    });
    expect(supervised.mechanism).toBe('handoff');
    expect(supervised.steps[0]).toMatchObject({
      forkMechanism: 'none',
      handoffRequired: false,
    });
    expect(supervised.steps[1]).toMatchObject({
      forkMechanism: 'handoff',
      forkFromSessionId: null,
      handoffRequired: true,
    });
  });

  it('never invents a native fork for a harness that reports a handoff', () => {
    const plan = planRunSessions({
      chain: makeChain({ harness: 'copilot', sessionMode: 'fork' }),
      capabilities: COPILOT,
      mode: 'automatic',
      createSessionId: sequentialSessionIds().create,
    });

    expect(plan.mechanism).toBe('handoff');
    expect(plan.nativeFork).toBe(false);
    expect(plan.steps[1]).toMatchObject({
      forkMechanism: 'handoff',
      forkFromSessionId: null,
      handoffRequired: true,
    });
  });

  it('falls back to a handoff when capabilities inconsistently claim a native fork', () => {
    const inconsistent: SessionCapabilities = {
      supportedSessionModes: ['shared', 'fresh', 'fork'],
      forkMechanisms: { interactive: 'native', headless: 'native' },
      nativeFork: false,
    };
    const plan = planRunSessions({
      chain: makeChain({ sessionMode: 'fork' }),
      capabilities: inconsistent,
      mode: 'automatic',
      createSessionId: sequentialSessionIds().create,
    });

    expect(plan.mechanism).toBe('handoff');
    expect(plan.steps[1]?.forkMechanism).toBe('handoff');
  });

  it('rejects an unsupported session mode before planning any id', () => {
    const ids = sequentialSessionIds();
    const unsupported: SessionCapabilities = {
      supportedSessionModes: ['shared'],
      forkMechanisms: { interactive: 'none', headless: 'none' },
      nativeFork: false,
    };

    const error = captureError(() =>
      planRunSessions({
        chain: makeChain({ sessionMode: 'fork' }),
        capabilities: unsupported,
        mode: 'automatic',
        createSessionId: ids.create,
      }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.SESSION_MODE_UNSUPPORTED);
    expect(ids.calls()).toBe(0);
  });

  it('rejects a fork when the adapter reports no mechanism', () => {
    const noFork: SessionCapabilities = {
      supportedSessionModes: ['shared', 'fresh', 'fork'],
      forkMechanisms: { interactive: 'none', headless: 'none' },
      nativeFork: false,
    };

    const error = captureError(() =>
      planRunSessions({
        chain: makeChain({ sessionMode: 'fork' }),
        capabilities: noFork,
        mode: 'automatic',
      }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.FORK_UNSUPPORTED);
    expect(error.details).toMatchObject({ surface: 'headless', mechanism: 'none' });
  });

  it('rejects an empty injected session id', () => {
    const error = captureError(() =>
      planRunSessions({
        chain: makeChain({ sessionMode: 'fresh' }),
        capabilities: OPENCODE,
        mode: 'automatic',
        createSessionId: () => '',
      }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.SESSION_ID_INVALID);
    expect(error.details).toMatchObject({ field: 'sessionId' });
  });
});

describe('handoff prompts', () => {
  it('appends a deterministic handoff note after a handoff fork', () => {
    const chain = makeChain({ sessionMode: 'fork' });
    const plan = planRunSessions({
      chain,
      capabilities: OPENCODE,
      mode: 'supervised',
      createSessionId: sequentialSessionIds().create,
    });
    const inputs = { task: 'ship the release' };
    const base = assembleStepPrompt({ chain, stepIndex: 1, inputs });

    const first = buildStepPrompt({
      chain,
      stepIndex: 1,
      inputs,
      sessionPlan: plan,
      previousStep: {
        stepIndex: 0,
        status: 'done',
        tail: '\u001b[32mplanned the work\u001b[0m\nready',
      },
    });
    const second = buildStepPrompt({
      chain,
      stepIndex: 1,
      inputs,
      sessionPlan: plan,
      previousStep: {
        stepIndex: 0,
        status: 'done',
        tail: '\u001b[32mplanned the work\u001b[0m\nready',
      },
    });

    expect(first).toBe(second);
    expect(first.startsWith(`${base}\n\n${HANDOFF_HEADING}`)).toBe(true);
    expect(first).toContain('Previous step 1: Plan (skill: brainstorm)');
    expect(first).toContain('Status: done');
    expect(first).toContain('Plan the task for ship the release.');
    expect(first).toContain('planned the work');
    expect(first).not.toContain('\u001b[');
  });

  it('does not append a handoff note to shared steps', () => {
    const chain = makeChain({ sessionMode: 'shared' });
    const plan = planRunSessions({
      chain,
      capabilities: OPENCODE,
      mode: 'supervised',
      createSessionId: sequentialSessionIds().create,
    });
    const inputs = { task: 'ship it' };
    const prompt = buildStepPrompt({
      chain,
      stepIndex: 1,
      inputs,
      sessionPlan: plan,
      previousStep: { stepIndex: 0, status: 'done', tail: 'ignored' },
    });

    expect(prompt).toBe(assembleStepPrompt({ chain, stepIndex: 1, inputs }));
    expect(prompt).not.toContain(HANDOFF_HEADING);
  });

  it('fails when a handoff step has no previous step state', () => {
    const chain = makeChain({ sessionMode: 'fork' });
    const plan = planRunSessions({
      chain,
      capabilities: OPENCODE,
      mode: 'supervised',
      createSessionId: sequentialSessionIds().create,
    });

    const error = captureError(() =>
      buildStepPrompt({
        chain,
        stepIndex: 1,
        inputs: { task: 'ship it' },
        sessionPlan: plan,
      }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.HANDOFF_UNAVAILABLE);
    expect(error.details).toMatchObject({
      stepIndex: 1,
      previousStepIndex: 0,
    });
  });

  it('rejects a handoff source that is not the previous step', () => {
    const chain = makeChain({
      sessionMode: 'fork',
      steps: [
        { id: 'step-1', skillName: 'brainstorm', instruction: 'Plan {{task}}.' },
        { id: 'step-2', skillName: 'implement', instruction: 'Build it.' },
        { id: 'step-3', skillName: 'review', instruction: 'Review it.' },
      ],
    });
    const plan = planRunSessions({
      chain,
      capabilities: OPENCODE,
      mode: 'supervised',
      createSessionId: sequentialSessionIds().create,
    });

    const error = captureError(() =>
      buildStepPrompt({
        chain,
        stepIndex: 2,
        inputs: { task: 'ship it' },
        sessionPlan: plan,
        previousStep: { stepIndex: 0, status: 'done' },
      }),
    );

    expect(error.code).toBe(RUN_PROMPT_ERROR_CODES.HANDOFF_UNAVAILABLE);
    expect(error.details).toMatchObject({
      previousStepIndex: 0,
      expectedPreviousStepIndex: 1,
    });
  });
});

describe('handoff note construction', () => {
  it('builds the same note twice from the same previous step', () => {
    const source = {
      index: 1,
      label: 'Build',
      skillName: 'implement',
      instruction: 'Implement the plan for the release.',
      status: 'done' as const,
      tail: 'compiled\nall tests passed',
    };

    expect(buildHandoffNote(source)).toBe(buildHandoffNote(source));
  });

  it('falls back to the skill name when the previous step has no label', () => {
    const note = buildHandoffNote({
      index: 0,
      label: null,
      skillName: 'brainstorm',
      instruction: 'Plan it.',
      status: 'skipped',
      tail: '',
    });

    expect(note).toContain('Previous step 1: brainstorm (skill: brainstorm)');
    expect(note).toContain('Status: skipped');
    expect(note).toContain('(no terminal output captured)');
  });

  it('strips ANSI escapes, NULs, and invisible formatting from the tail', () => {
    const note = buildHandoffNote({
      index: 0,
      label: 'Plan',
      skillName: 'brainstorm',
      instruction: 'Plan it.',
      status: 'failed',
      tail: '\u001b[31mred\u001b[0m\u0000\u200b clean\r\nnext',
    });

    expect(note).toContain('red clean\nnext');
    expect(note).not.toContain('\u001b[');
    expect(note).not.toContain('\u0000');
    expect(note).not.toContain('\u200b');
  });

  it('caps a large tail by both lines and bytes while keeping the metadata', () => {
    const longTail = Array.from(
      { length: 500 },
      (_value, index) => `line ${String(index)} ${'x'.repeat(200)}`,
    ).join('\n');

    const note = buildHandoffNote({
      index: 0,
      label: 'Plan',
      skillName: 'brainstorm',
      instruction: 'Plan the release.',
      status: 'done',
      tail: longTail,
    });

    expect(note.split('\n').length).toBeLessThanOrEqual(MAX_HANDOFF_LINES);
    expect(Buffer.byteLength(note, 'utf8')).toBeLessThanOrEqual(MAX_HANDOFF_BYTES);
    expect(note.startsWith(HANDOFF_HEADING)).toBe(true);
    expect(note).toContain('Previous step 1: Plan (skill: brainstorm)');
    expect(note).toContain('Status: done');
    expect(note).toContain('Instruction:');
    expect(note).toContain('Bounded terminal tail (most recent output):');
    expect(note).toContain('line 499');
  });

  it('honors a custom cap deterministically', () => {
    const source = {
      index: 0,
      label: 'Plan',
      skillName: 'brainstorm',
      instruction: 'Plan the release.',
      status: 'done' as const,
      tail: Array.from({ length: 50 }, (_value, index) => `tail ${String(index)}`).join(
        '\n',
      ),
    };

    const first = buildHandoffNote(source, { maxBytes: 400, maxLines: 40 });
    const second = buildHandoffNote(source, { maxBytes: 400, maxLines: 40 });

    expect(first).toBe(second);
    expect(first.split('\n').length).toBeLessThanOrEqual(40);
    expect(Buffer.byteLength(first, 'utf8')).toBeLessThanOrEqual(400);
    expect(first.startsWith(HANDOFF_HEADING)).toBe(true);
  });

  it('sanitizes arbitrary values without throwing', () => {
    expect(sanitizeHandoffText(undefined)).toBe('');
    expect(sanitizeHandoffText(null)).toBe('');
    expect(sanitizeHandoffText(42)).toBe('42');
    expect(sanitizeHandoffText('\t spaced  \n\n\nnext ')).toBe('spaced\n\nnext');
  });
});
