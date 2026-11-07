import { describe, expect, it } from 'vitest';
import { createRunsApi } from '../../src/web/api/runs.js';

const binding = {
  sourceId: 'source-one',
  revision: 'a'.repeat(40),
  repositoryPath: 'skills/review',
};

function runView(skillBinding: unknown) {
  return {
    projectPath: '/tmp/project',
    terminalId: null,
    actions: {
      next: false,
      retry: false,
      skip: false,
      abort: false,
      pause: false,
      resume: false,
      runNext: false,
      done: false,
      failed: false,
      continue: false,
      restart: false,
    },
    recovery: null,
    run: {
      version: 1,
      id: 'run-one',
      projectId: 'project-one',
      chainId: 'chain-one',
      harness: 'opencode',
      mode: 'supervised',
      sessionMode: 'shared',
      chainSnapshot: {
        name: 'Review',
        harness: 'opencode',
        sessionMode: 'shared',
        steps: [
          {
            id: 'step-one',
            skillName: 'review',
            skillBinding,
            instruction: 'Review the project.',
          },
        ],
      },
      resolvedInputs: {},
      status: 'awaiting-user',
      currentStepIndex: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      sessionId: null,
      forkMechanism: 'none',
      steps: [],
      reason: null,
    },
  };
}

function apiFor(body: unknown) {
  return createRunsApi(async () =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('runs API chain snapshots', () => {
  it('round-trips the exact remote skill binding in a frozen run snapshot', async () => {
    const view = await apiFor(runView(binding)).getRun('run-one');

    expect(view.run.chainSnapshot.steps).toEqual([
      {
        id: 'step-one',
        skillName: 'review',
        skillBinding: binding,
        instruction: 'Review the project.',
      },
    ]);
  });

  it('rejects malformed remote skill bindings in a frozen run snapshot', async () => {
    const invalidBinding = { ...binding, revision: 'moving-branch' };

    await expect(
      apiFor(runView(invalidBinding)).getRun('run-one'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
