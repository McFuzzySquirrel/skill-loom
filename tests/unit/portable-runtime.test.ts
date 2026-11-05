import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executePortableRequest } from '../../src/portable/runtime.js';
import type { ChainBundle } from '../../src/shared/bundles.js';

let root: string;
let project: string;
let bundlePath: string;

const skillText = '---\nname: review\ndescription: Check work\n---\nReview the current changes.\n';
const bundle: ChainBundle = {
  format: 'skill-loom-chain',
  version: 1,
  chain: {
    name: 'Portable review',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      { id: 'skill-step', skillName: 'review', instruction: 'Review {{task}}.' },
      { id: 'instruction-step', kind: 'instruction', instruction: 'Summarize {{task}}.' },
    ],
    inputs: [{ name: 'task', required: true }],
  },
  skills: [{
    name: 'review',
    directory: 'review',
    files: [{
      path: 'SKILL.md',
      content: Buffer.from(skillText).toString('base64'),
      executable: false,
    }, {
      path: 'check.bin',
      content: Buffer.from([0, 1, 128, 255]).toString('base64'),
      executable: true,
    }],
  }],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-portable-'));
  project = join(root, 'project');
  bundlePath = join(root, 'review.loom.json');
  await mkdir(project);
  await writeFile(bundlePath, JSON.stringify(bundle));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function prepare(extra: Record<string, unknown> = {}) {
  return await executePortableRequest({
    command: 'prepare',
    projectPath: project,
    bundlePath,
    input: {
      installConfirmed: true,
      actualHost: 'opencode',
      hostSwitchConfirmed: false,
      progression: 'supervised',
      sessionDecision: {
        requested: 'shared',
        mechanism: 'current-conversation',
        description: 'Continue in the current OpenCode conversation.',
        confirmed: true,
      },
      inputs: { task: 'the change' },
      ...extra,
    },
  }) as Promise<{ runId: string; revision: number }>;
}

function command(
  cmd: 'status' | 'step' | 'record' | 'resume',
  runId: string,
  revision: number,
  input: Record<string, unknown> = {},
) {
  return executePortableRequest({
    command: cmd,
    projectPath: project,
    runId,
    input: { revision, ...input },
  });
}

describe('portable bundle execution', () => {
  it('inspects without project writes and prepares frozen inputs and approved packages', async () => {
    const preview = await executePortableRequest({ command: 'inspect', bundlePath, projectPath: project }) as {
      bundleFingerprint: string;
      skills: Array<{ skillMarkdown: string; bundledFingerprint: string }>;
    };
    expect(preview.bundleFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.skills[0]).toMatchObject({
      skillMarkdown: skillText,
      bundledFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(readFile(join(project, '.loom', '.gitignore'))).rejects.toMatchObject({ code: 'ENOENT' });

    const result = await prepare() as { runId: string; revision: number; status: string };
    expect(result).toMatchObject({ revision: 1, status: 'ready' });
    expect(await readFile(join(project, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe(skillText);
    expect((await readFile(join(project, '.agents', 'skills', 'review', 'check.bin'))).toString('hex')).toBe('000180ff');
    expect((await readFile(join(project, '.loom', '.gitignore'), 'utf8'))).toContain('portable-runs/');

    const status = await command('status', result.runId, result.revision) as { run: Record<string, unknown> };
    expect(status.run).toMatchObject({ status: 'ready', currentStepIndex: 0 });
    expect(status.run).not.toHaveProperty('resolvedInputs');
    expect(status.run).not.toHaveProperty('bundle');
  });

  it('requires per-step confirmation, preserves order and records completion', async () => {
    const run = await prepare() as { runId: string; revision: number };
    await expect(command('step', run.runId, run.revision)).rejects.toMatchObject({
      code: 'STEP_CONFIRMATION_REQUIRED',
    });
    const first = await command('step', run.runId, run.revision, { confirmed: true }) as {
      revision: number;
      step: { index: number; instruction: string; skillPath: string };
    };
    expect(first.step).toMatchObject({
      index: 0,
      instruction: 'Skill: review\n\nInstruction:\nReview the change.',
      skillPath: join(project, '.agents', 'skills', 'review'),
    });
    const done = await command('record', run.runId, first.revision, {
      outcome: 'done',
      confirmed: true,
      summary: 'Reviewed the requested change.',
    }) as { revision: number; currentStepIndex: number };
    expect(done.currentStepIndex).toBe(1);
    const second = await command('step', run.runId, done.revision, { confirmed: true }) as {
      revision: number;
      step: { kind: string; instruction: string };
    };
    expect(second.step).toMatchObject({ index: 1, kind: 'instruction', instruction: 'Instruction:\nSummarize the change.' });
    const complete = await command('record', run.runId, second.revision, {
      outcome: 'done',
      confirmed: true,
    }) as { status: string };
    expect(complete.status).toBe('completed');
  });

  it('requires separate consent for progression and session approximations', async () => {
    await expect(prepare({
      progression: 'agent',
      progressionConfirmed: false,
    })).rejects.toMatchObject({ code: 'PROGRESSION_CONFIRMATION_REQUIRED' });
    const freshBundle = structuredClone(bundle);
    freshBundle.chain.sessionMode = 'fresh';
    await writeFile(bundlePath, JSON.stringify(freshBundle));
    await expect(prepare({
      sessionDecision: {
        requested: 'fresh',
        mechanism: 'current-conversation',
        description: 'The current conversation is not isolated.',
        confirmed: false,
      },
    })).rejects.toMatchObject({ code: 'SESSION_CONFIRMATION_REQUIRED' });
    await expect(prepare({ actualHost: 'copilot' })).rejects.toMatchObject({
      code: 'HOST_SWITCH_CONFIRMATION_REQUIRED',
    });
  });

  it('uses a bounded labelled handoff for fork mode and supports explicitly opted-in progression', async () => {
      const forkBundle = structuredClone(bundle);
      forkBundle.chain.sessionMode = 'fork';
      await writeFile(bundlePath, JSON.stringify(forkBundle));
      const run = await prepare({
        sessionDecision: {
          requested: 'fork',
          mechanism: 'handoff',
          description: 'Use a bounded handoff in a new host worker.',
          confirmed: true,
        },
      }) as { runId: string; revision: number };
      const first = await command('step', run.runId, run.revision, { confirmed: true }) as { revision: number };
      const done = await command('record', run.runId, first.revision, {
        outcome: 'done',
        confirmed: true,
        summary: 'Completed the first step.',
      }) as { revision: number };
      const second = await command('step', run.runId, done.revision, { confirmed: true }) as {
        step: { handoffNote: string | null };
      };
      expect(second.step.handoffNote).toContain('not a native session fork');
      expect(second.step.handoffNote).toContain('Completed the first step.');

      const agentRun = await prepare({
        progression: 'agent',
        progressionConfirmed: true,
        reuseSkills: ['review'],
        sessionDecision: {
          requested: 'fork',
          mechanism: 'handoff',
          description: 'Use a bounded handoff in a new host worker.',
          confirmed: true,
        },
      }) as { runId: string; revision: number };
      const agentStep = await command('step', agentRun.runId, agentRun.revision) as { revision: number };
      const agentDone = await command('record', agentRun.runId, agentStep.revision, {
        outcome: 'done',
        summary: 'Agent-reported completion.',
      }) as { status: string };
      expect(agentDone.status).toBe('ready');
  });

  it('does not overwrite a package and requires explicit approval for differing reuse', async () => {
    const destination = join(project, '.agents', 'skills', 'review');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'SKILL.md'), skillText);
    await expect(prepare()).rejects.toMatchObject({ code: 'PACKAGE_CONFLICT' });
    await writeFile(join(destination, 'SKILL.md'), `${skillText}\nLocal edits\n`);
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({
      code: 'REUSE_CONTENT_CONFIRMATION_REQUIRED',
    });
    const result = await prepare({
      reuseSkills: ['review'],
      differingReuseConfirmed: true,
    }) as { runId: string };
    expect((await readFile(join(destination, 'SKILL.md'), 'utf8')).endsWith('Local edits\n')).toBe(true);
    expect(result.runId).toBeTruthy();
  });

  it('requires explicit interrupted-run recovery and never replays automatically', async () => {
    const run = await prepare() as { runId: string; revision: number };
    const step = await command('step', run.runId, run.revision, { confirmed: true }) as { revision: number };
    const interrupted = await command('resume', run.runId, step.revision) as {
      revision: number;
      decisionRequired: boolean;
    };
    expect(interrupted.decisionRequired).toBe(true);
    await expect(command('step', run.runId, interrupted.revision, { confirmed: true })).rejects.toMatchObject({
      code: 'RUN_NOT_READY',
    });
    const ready = await command('resume', run.runId, interrupted.revision, { decision: 'retry' }) as {
      revision: number;
      status: string;
    };
    expect(ready.status).toBe('ready');
    const retry = await command('step', run.runId, ready.revision, { confirmed: true }) as {
      attempt: number;
    };
    expect(retry.attempt).toBe(2);
  });

  it('rejects stale revisions and changed installed packages before dispatch', async () => {
    const run = await prepare() as { runId: string; revision: number };
    await expect(command('step', run.runId, run.revision + 1, { confirmed: true })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await writeFile(join(project, '.agents', 'skills', 'review', 'SKILL.md'), `${skillText}\nChanged\n`);
    await expect(command('step', run.runId, run.revision, { confirmed: true })).rejects.toMatchObject({
      code: 'PACKAGE_CHANGED',
    });
  });

  it('requires a skip reason and allows pause, continue, and abort between steps', async () => {
    const run = await prepare() as { runId: string; revision: number };
    await expect(command('record', run.runId, run.revision, { action: 'skip' })).rejects.toMatchObject({
      code: 'SKIP_REASON_REQUIRED',
    });
    const paused = await command('record', run.runId, run.revision, { action: 'pause' }) as {
      revision: number;
      status: string;
    };
    expect(paused.status).toBe('paused');
    const ready = await command('resume', run.runId, paused.revision, { decision: 'continue' }) as {
      revision: number;
      status: string;
    };
    expect(ready.status).toBe('ready');
    const aborted = await command('record', run.runId, ready.revision, { action: 'abort' }) as {
      status: string;
    };
    expect(aborted.status).toBe('aborted');
  });

  it('blocks unsupported bundle content before package installation', async () => {
    const invalidBundle = structuredClone(bundle) as unknown as Record<string, unknown>;
    (invalidBundle['skills'] as Array<{ files: Array<{ path: string }> }>)[0]!.files[0]!.path = '../escape';
    await writeFile(bundlePath, JSON.stringify(invalidBundle));
    await expect(prepare()).rejects.toBeInstanceOf(Error);
    await expect(readFile(join(project, '.agents', 'skills', 'review', 'SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
