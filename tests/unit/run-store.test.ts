import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_VERSION, type Chain } from '../../src/server/chains/model.js';
import { createChainStore } from '../../src/server/chains/store.js';
import { scanProjectRunRecords } from '../../src/shared/project-run-records.js';
import {
  acquireProjectRunClaim, adoptReviewedLegacyRun, clearReviewedProjectClaim,
  beginCoordinatedProjectRun, enableReviewedProjectProtocol, requireProjectRunClaim,
  reviewProjectCoordination, withClaimedProjectRun, withCoordinatedProjectRun,
} from '../../src/shared/project-coordination.js';
import {
  ACTIVE_RUN_STATUSES,
  createRunRecord,
  type Run,
} from '../../src/server/runs/model.js';
import { abandonClaimedManagedRun, reconcileClaimedManagedRun } from '../../src/server/runs/project-reconciliation.js';
import {
  ACTIVE_RUN_FILE_NAME,
  RUN_STORE_ERROR_CODES,
  RUN_STORE_WARNING_CODES,
  RunStoreError,
  atomicWriteRunJson,
  activeRunPathFor,
  clearActiveRunPointerFile,
  createRunStore,
  isSafeRunId,
  readActiveRunPointerFile,
  recoverActiveRunOnStartup,
  runsDirectoryFor,
  type RunStore,
} from '../../src/server/runs/store.js';

const CREATED_AT = '2026-11-04T10:00:00.000Z';
const LATER_AT = '2026-11-04T12:00:00.000Z';

let root: string;
let projectPath: string;
let configDirectory: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-run-store-')));
  projectPath = join(root, 'project');
  configDirectory = join(root, 'config');
  await mkdir(projectPath);
  await mkdir(configDirectory);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

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

function storeFor(overrides: Partial<Parameters<typeof createRunStore>[0]> = {}): RunStore {
  return createRunStore({ projectPath, configDirectory, ...overrides });
}

function runsDirectory(): string {
  return runsDirectoryFor(projectPath);
}

function runFile(runId: string): string {
  return join(runsDirectory(), `${runId}.json`);
}

function pointerFile(): string {
  return activeRunPathFor(configDirectory);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function temporaryFiles(directory: string): Promise<string[]> {
  const names = await readdir(directory);
  return names.filter((name) => name.endsWith('.tmp'));
}

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to reject.');
}

async function expectRunStoreError(
  operation: Promise<unknown>,
  code: string,
): Promise<RunStoreError> {
  const captured = await captureError(operation);
  expect(captured).toBeInstanceOf(RunStoreError);
  const error = captured as RunStoreError;
  expect(error.code).toBe(code);
  return error;
}

describe('run storage layout', () => {
  it('writes one JSON run under .loom/runs and claims the global pointer', async () => {
    const store = storeFor();
    const run = makeRun();

    const created = await store.create(run);

    expect(created).toEqual(run);
    expect(await fileExists(runFile(run.id))).toBe(true);
    expect((await stat(runFile(run.id))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(runFile(run.id), 'utf8'))).toEqual(run);
    expect(await temporaryFiles(runsDirectory())).toEqual([]);

    const pointer = JSON.parse(await readFile(pointerFile(), 'utf8')) as Record<string, unknown>;
    expect(pointer).toMatchObject({
      version: 1,
      runId: run.id,
      projectId: 'project-1',
      projectPath: await realpath(projectPath),
      status: 'starting',
    });
    expect((await store.getActiveRun())?.runId).toBe(run.id);
  });

  it('does not create .loom when reading or listing an empty project', async () => {
    const store = storeFor();

    await expectRunStoreError(store.read('run-missing'), RUN_STORE_ERROR_CODES.NOT_FOUND);
    expect(await fileExists(join(projectPath, '.loom'))).toBe(false);

    expect(await store.list()).toEqual({ runs: [], warnings: [] });
    expect(await fileExists(join(projectPath, '.loom'))).toBe(false);
  });

  it('rejects a duplicate run id without overwriting the original', async () => {
    const store = storeFor();
    await store.create(makeRun({ id: 'run-alpha' }));

    const error = await expectRunStoreError(
      store.create(makeRun({ id: 'run-alpha', reason: 'replacement' })),
      RUN_STORE_ERROR_CODES.ALREADY_EXISTS,
    );
    expect(error.details).toMatchObject({ runId: 'run-alpha', path: runFile('run-alpha') });
    expect((await store.read('run-alpha')).reason).toBeNull();
  });
});

describe('snapshot immutability', () => {
  it('keeps the frozen chain and resolved inputs after the saved chain is edited', async () => {
    const chainStore = createChainStore({ projectPath });
    const chain = makeChain();
    await chainStore.create(chain);

    const runStore = storeFor();
    const loadedChain = await chainStore.read(chain.id);
    const run = await runStore.create(
      createRunRecord({
        id: 'run-frozen',
        projectId: 'project-1',
        chain: loadedChain,
        mode: 'supervised',
        inputs: { task: 'original task' },
        now: CREATED_AT,
      }),
    );

    await chainStore.update({
      ...chain,
      name: 'Edited chain',
      steps: [
        { ...chain.steps[0]!, instruction: 'Edited instruction without a placeholder.' },
        chain.steps[1]!,
      ],
      updatedAt: LATER_AT,
    });

    const reread = await runStore.read(run.id);
    expect(reread.chainSnapshot.name).toBe('Alpha chain');
    expect(reread.chainSnapshot.steps[0]?.instruction).toBe('Plan the task for {{task}}.');
    expect(reread.chainSnapshot.steps).toHaveLength(2);
    expect(reread.resolvedInputs).toEqual({ task: 'original task' });
    expect((await chainStore.read(chain.id)).name).toBe('Edited chain');
  });
});

describe('one active run globally', () => {
  it('rejects a second active run in every blocking status and frees the slot afterwards', async () => {
    const store = storeFor();

    for (const status of ACTIVE_RUN_STATUSES) {
      const first = makeRun({ id: `run-${status}`, status });
      await store.create(first);
      expect((await store.getActiveRun())?.status).toBe(status);

      const second = makeRun({ id: `run-${status}-second` });
      const error = await expectRunStoreError(
        store.create(second),
        RUN_STORE_ERROR_CODES.ACTIVE_CONFLICT,
      );
      expect(error).toMatchObject({
        code: RUN_STORE_ERROR_CODES.ACTIVE_CONFLICT,
        details: expect.objectContaining({ runId: first.id, status }),
      });
      // The rejected create leaves no startable record behind.
      expect(await fileExists(runFile(second.id))).toBe(false);

      await store.update({ ...first, status: 'completed', finishedAt: LATER_AT, updatedAt: LATER_AT });
      expect(await store.getActiveRun()).toBeNull();

      const third = makeRun({ id: `run-${status}-third` });
      await store.create(third);
      await store.update({ ...third, status: 'aborted', finishedAt: LATER_AT, updatedAt: LATER_AT });
      expect(await store.getActiveRun()).toBeNull();
    }
  });

  it('rejects a second active run from a different project sharing the config directory', async () => {
    const otherProject = join(root, 'other-project');
    await mkdir(otherProject);

    const first = storeFor();
    await first.create(makeRun({ id: 'run-first' }));

    const second = createRunStore({ projectPath: otherProject, configDirectory });
    const error = await expectRunStoreError(
      second.create(makeRun({ id: 'run-second', projectId: 'project-2' })),
      RUN_STORE_ERROR_CODES.ACTIVE_CONFLICT,
    );
    expect(error.details).toMatchObject({ runId: 'run-first', projectId: 'project-1' });
    expect((await first.getActiveRun())?.runId).toBe('run-first');

    await first.update({
      ...makeRun({ id: 'run-first' }),
      status: 'completed',
      finishedAt: LATER_AT,
      updatedAt: LATER_AT,
    });
    await second.create(makeRun({ id: 'run-second', projectId: 'project-2' }));
    expect((await second.getActiveRun())?.runId).toBe('run-second');
  });

  it('does not claim the pointer for an already terminal run', async () => {
    const store = storeFor();
    await store.create(
      makeRun({ id: 'run-done', status: 'completed', finishedAt: CREATED_AT }),
    );

    expect(await store.getActiveRun()).toBeNull();
    expect(await fileExists(pointerFile())).toBe(false);
  });

  it('does not treat a pointer to a terminal run in this project as a blocker', async () => {
    const store = storeFor();
    const completed = makeRun({
      id: 'run-completed',
      status: 'completed',
      finishedAt: CREATED_AT,
    });
    await store.create(completed);

    await writeFile(
      pointerFile(),
      JSON.stringify({
        version: 1,
        runId: completed.id,
        projectId: completed.projectId,
        projectPath: await realpath(projectPath),
        status: 'running',
        startedAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
      'utf8',
    );

    const next = makeRun({ id: 'run-next' });
    await store.create(next);
    expect((await store.getActiveRun())?.runId).toBe('run-next');
  });
});

describe('startup recovery', () => {
  async function enableCoordination(): Promise<void> {
    const review = await reviewProjectCoordination(projectPath);
    await enableReviewedProjectProtocol(projectPath, review.reviewDigest, true);
  }

  it('requires a current review and separate consent to enable coordination', async () => {
    const review = await reviewProjectCoordination(projectPath);
    expect(review.protocol).toBeNull();
    await expect(acquireProjectRunClaim(projectPath, 'managed', 'run-one'))
      .rejects.toMatchObject({ code: 'PROJECT_PROTOCOL_NOT_ENABLED' });
    await expect(enableReviewedProjectProtocol(projectPath, review.reviewDigest, false))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });
    await expect(enableReviewedProjectProtocol(projectPath, 'stale', true))
      .rejects.toMatchObject({ code: 'PROJECT_REVIEW_STALE' });
    await enableReviewedProjectProtocol(projectPath, review.reviewDigest, true);
    expect((await reviewProjectCoordination(projectPath)).protocol).toMatchObject({ version: 1 });
  });

  it('adopts exactly one reviewed legacy run without changing or replaying it', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    await store.create(active);
    await enableCoordination();
    const original = await readFile(runFile(active.id), 'utf8');
    const review = await reviewProjectCoordination(projectPath);
    await expect(adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: active.id }, review.reviewDigest, true, false))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });
    await expect(adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: 'other' }, review.reviewDigest, true, true))
      .rejects.toMatchObject({ code: 'PROJECT_RECONCILIATION_REQUIRED' });
    const adopted = await adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: active.id }, review.reviewDigest, true, true);
    expect(await requireProjectRunClaim(projectPath, adopted)).toEqual(adopted);
    expect(await readFile(runFile(active.id), 'utf8')).toBe(original);
    expect((await store.getActiveRun())?.runId).toBe(active.id);
  });

  it('does not automatically recover a claimed run or clear its pointer', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    await store.create(active);
    await enableCoordination();
    const legacy = await reviewProjectCoordination(projectPath);
    const claim = await adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: active.id }, legacy.reviewDigest, true, true);
    const original = await readFile(runFile(active.id), 'utf8');
    const pointer = await readFile(pointerFile(), 'utf8');
    const recovery = await store.recoverInterruptedRuns();
    expect(recovery).toMatchObject({
      interrupted: [], clearedActiveRun: false,
      warnings: [expect.objectContaining({ code: 'RUN_RECOVERY_CLAIMED', runId: active.id })],
    });
    expect(await readFile(runFile(active.id), 'utf8')).toBe(original);
    expect(await readFile(pointerFile(), 'utf8')).toBe(pointer);
    expect(await requireProjectRunClaim(projectPath, claim)).toEqual(claim);
  });

  it('preserves an unclaimed pointer after project coordination is enabled', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    await store.create(active);
    await store.create(makeRun({ id: 'run-other', status: 'running' }), { activate: false });
    await enableCoordination();
    const recovery = await store.recoverInterruptedRuns();
    expect(recovery.warnings).toContainEqual(expect.objectContaining({ code: 'RUN_RECOVERY_CLAIMED' }));
    expect(recovery.warnings).toContainEqual(expect.objectContaining({
      code: 'RUN_RECOVERY_AMBIGUOUS', runId: 'run-other',
    }));
    expect(await store.read(active.id)).toEqual(active);
    expect((await store.getActiveRun())?.runId).toBe(active.id);
  });

  it('serializes legacy startup recovery against protocol enablement', async () => {
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    await storeFor().create(active);
    const review = await reviewProjectCoordination(projectPath);
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const store = storeFor({
      atomicWrite: async (target, run) => {
        enter();
        await gate;
        await atomicWriteRunJson(target, run);
      },
    });
    const recovery = store.recoverInterruptedRuns();
    await entered;
    const enablement = enableReviewedProjectProtocol(projectPath, review.reviewDigest, true);
    finish();
    expect((await recovery).interrupted).toHaveLength(1);
    await expect(enablement).rejects.toMatchObject({ code: 'PROJECT_REVIEW_STALE' });
    expect((await reviewProjectCoordination(projectPath)).protocol).toBeNull();
  });

  it('fails closed without changing the pointer or record if coordination data is corrupt', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    await store.create(active);
    await reviewProjectCoordination(projectPath);
    const original = await readFile(runFile(active.id), 'utf8');
    const pointer = await readFile(pointerFile(), 'utf8');
    await writeFile(join(projectPath, '.loom', 'project-claim.sqlite'), 'corrupt');
    await expect(store.recoverInterruptedRuns()).rejects.toMatchObject({ code: 'PROJECT_CLAIM_UNSAFE' });
    expect(await readFile(runFile(active.id), 'utf8')).toBe(original);
    expect(await readFile(pointerFile(), 'utf8')).toBe(pointer);
  });

  it('reconciles an adopted managed run only after current review and separate confirmations', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    active.steps[0] = { ...active.steps[0]!, status: 'running', startedAt: CREATED_AT };
    await store.create(active);
    await enableCoordination();
    const legacy = await reviewProjectCoordination(projectPath);
    const claim = await adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: active.id }, legacy.reviewDigest, true, true);
    const review = await reviewProjectCoordination(projectPath);
    const options = {
      projectPath, configDirectory, runId: active.id, reviewDigest: review.reviewDigest,
      stoppedConfirmed: true, oldClientsStoppedConfirmed: true, now: new Date(LATER_AT),
    };
    const original = await readFile(runFile(active.id), 'utf8');
    await expect(reconcileClaimedManagedRun({ ...options, stoppedConfirmed: false }))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });
    await expect(reconcileClaimedManagedRun({ ...options, oldClientsStoppedConfirmed: false }))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });
    await expect(reconcileClaimedManagedRun({ ...options, reviewDigest: legacy.reviewDigest }))
      .rejects.toMatchObject({ code: 'PROJECT_REVIEW_STALE' });
    await expect(reconcileClaimedManagedRun({ ...options, runId: 'other' }))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_MISMATCH' });
    expect(await readFile(runFile(active.id), 'utf8')).toBe(original);
    expect((await store.getActiveRun())?.runId).toBe(active.id);

    const interrupted = await reconcileClaimedManagedRun(options);
    expect(interrupted).toMatchObject({
      status: 'interrupted', reason: 'RECONCILED_AFTER_CONFIRMATION', updatedAt: LATER_AT,
      steps: [expect.objectContaining({ status: 'interrupted', finishedAt: LATER_AT }), expect.anything()],
    });
    expect(await store.read(active.id)).toEqual(interrupted);
    expect(await store.getActiveRun()).toBeNull();
    const after = await reviewProjectCoordination(projectPath);
    expect(after.claim).toEqual(claim);
    expect(after.records).toEqual([expect.objectContaining({ runId: active.id, unresolved: true })]);
    await expect(clearReviewedProjectClaim(projectPath, after.reviewDigest, true, true))
      .rejects.toMatchObject({ code: 'PROJECT_RECONCILIATION_REQUIRED' });
    expect(await reconcileClaimedManagedRun({ ...options, reviewDigest: after.reviewDigest })).toEqual(interrupted);
  });

  it('retains the claim and reports a corrupt profile pointer after writing interruption', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    await store.create(active);
    await enableCoordination();
    const legacy = await reviewProjectCoordination(projectPath);
    const claim = await adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: active.id }, legacy.reviewDigest, true, true);
    const review = await reviewProjectCoordination(projectPath);
    await writeFile(pointerFile(), '{broken');
    await expect(reconcileClaimedManagedRun({
      projectPath, configDirectory, runId: active.id, reviewDigest: review.reviewDigest,
      stoppedConfirmed: true, oldClientsStoppedConfirmed: true,
    })).rejects.toMatchObject({ code: 'RUN_ACTIVE_POINTER_CORRUPT' });
    expect((await store.read(active.id)).status).toBe('interrupted');
    expect(await readFile(pointerFile(), 'utf8')).toBe('{broken');
    expect((await reviewProjectCoordination(projectPath)).claim).toEqual(claim);
  });

  it('requires a separate reviewed abandonment before releasing an interrupted claim', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    active.steps[0] = { ...active.steps[0]!, status: 'running', startedAt: CREATED_AT };
    await store.create(active);
    const originalPointer = await readFile(pointerFile(), 'utf8');
    await enableCoordination();
    const legacy = await reviewProjectCoordination(projectPath);
    const claim = await adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: active.id }, legacy.reviewDigest, true, true);
    const adopted = await reviewProjectCoordination(projectPath);
    const options = {
      projectPath, configDirectory, runId: active.id,
      stoppedConfirmed: true, oldClientsStoppedConfirmed: true,
      reviewDigest: adopted.reviewDigest, abandonConfirmed: true, now: new Date(LATER_AT),
    };
    await expect(abandonClaimedManagedRun(options))
      .rejects.toMatchObject({ code: 'PROJECT_RECONCILIATION_REQUIRED' });
    await reconcileClaimedManagedRun(options);
    const interruptedReview = await reviewProjectCoordination(projectPath);
    const before = await readFile(runFile(active.id), 'utf8');
    await expect(abandonClaimedManagedRun({ ...options, reviewDigest: interruptedReview.reviewDigest, abandonConfirmed: false }))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });
    await expect(abandonClaimedManagedRun({ ...options, reviewDigest: interruptedReview.reviewDigest, stoppedConfirmed: false }))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });
    await expect(abandonClaimedManagedRun({ ...options, reviewDigest: interruptedReview.reviewDigest, oldClientsStoppedConfirmed: false }))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });
    await expect(abandonClaimedManagedRun(options))
      .rejects.toMatchObject({ code: 'PROJECT_REVIEW_STALE' });
    expect(await readFile(runFile(active.id), 'utf8')).toBe(before);
    const abandoned = await abandonClaimedManagedRun({ ...options, reviewDigest: interruptedReview.reviewDigest });
    expect(abandoned).toMatchObject({
      status: 'aborted', reason: 'ABANDONED_AFTER_CONFIRMATION', finishedAt: LATER_AT,
      steps: [expect.objectContaining({ status: 'interrupted' }), expect.objectContaining({ status: 'pending' })],
    });
    const finalReview = await reviewProjectCoordination(projectPath);
    expect(finalReview.claim).toEqual(claim);
    expect(finalReview.records).toEqual([expect.objectContaining({ runId: active.id, unresolved: false })]);
    await writeFile(pointerFile(), originalPointer);
    expect(await abandonClaimedManagedRun({ ...options, reviewDigest: finalReview.reviewDigest })).toEqual(abandoned);
    expect(await store.getActiveRun()).toBeNull();
    await expect(clearReviewedProjectClaim(projectPath, interruptedReview.reviewDigest, true, true))
      .rejects.toMatchObject({ code: 'PROJECT_REVIEW_STALE' });
    await clearReviewedProjectClaim(projectPath, finalReview.reviewDigest, true, true);
    expect((await reviewProjectCoordination(projectPath)).claim).toBeNull();
    expect((await store.read(active.id)).status).toBe('aborted');
  });

  it('does not abandon an interrupted run when the profile pointer is corrupt', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    await store.create(active);
    await enableCoordination();
    const legacy = await reviewProjectCoordination(projectPath);
    const claim = await adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: active.id }, legacy.reviewDigest, true, true);
    const adopted = await reviewProjectCoordination(projectPath);
    await reconcileClaimedManagedRun({
      projectPath, configDirectory, runId: active.id, reviewDigest: adopted.reviewDigest,
      stoppedConfirmed: true, oldClientsStoppedConfirmed: true,
    });
    const review = await reviewProjectCoordination(projectPath);
    const original = await readFile(runFile(active.id), 'utf8');
    await writeFile(pointerFile(), '{broken');
    await expect(abandonClaimedManagedRun({
      projectPath, configDirectory, runId: active.id, reviewDigest: review.reviewDigest,
      stoppedConfirmed: true, oldClientsStoppedConfirmed: true, abandonConfirmed: true,
    })).rejects.toMatchObject({ code: 'RUN_ACTIVE_POINTER_CORRUPT' });
    expect(await readFile(runFile(active.id), 'utf8')).toBe(original);
    expect(await readFile(pointerFile(), 'utf8')).toBe('{broken');
    expect((await reviewProjectCoordination(projectPath)).claim).toEqual(claim);
  });

  it('does not clear another project pointer for a run with the same id', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    await store.create(active);
    await enableCoordination();
    const legacy = await reviewProjectCoordination(projectPath);
    await adoptReviewedLegacyRun(projectPath, { kind: 'managed', runId: active.id }, legacy.reviewDigest, true, true);
    const review = await reviewProjectCoordination(projectPath);
    const otherProject = join(root, 'other');
    await mkdir(otherProject);
    const pointer = JSON.parse(await readFile(pointerFile(), 'utf8')) as Record<string, unknown>;
    pointer.projectPath = await realpath(otherProject);
    await writeFile(pointerFile(), JSON.stringify(pointer));
    await reconcileClaimedManagedRun({
      projectPath, configDirectory, runId: active.id, reviewDigest: review.reviewDigest,
      stoppedConfirmed: true, oldClientsStoppedConfirmed: true,
    });
    expect(await store.getActiveRun()).toMatchObject({ runId: active.id, projectPath: pointer.projectPath });
  });

  it('only clears a reviewed claim with explicit confirmation and no unresolved records', async () => {
    await enableCoordination();
    const claim = await acquireProjectRunClaim(projectPath, 'managed', 'run-claimed');
    const before = await reviewProjectCoordination(projectPath);
    expect(before.claim).toEqual(claim);
    await expect(clearReviewedProjectClaim(projectPath, before.reviewDigest, false, true))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });

    const store = storeFor();
    const active = makeRun({ id: 'run-claimed', status: 'running' });
    await store.create(active);
    await expect(clearReviewedProjectClaim(projectPath, before.reviewDigest, true, true))
      .rejects.toMatchObject({ code: 'PROJECT_REVIEW_STALE' });
    const activeReview = await reviewProjectCoordination(projectPath);
    await expect(clearReviewedProjectClaim(projectPath, activeReview.reviewDigest, true, true))
      .rejects.toMatchObject({ code: 'PROJECT_RECONCILIATION_REQUIRED' });
    await store.update({ ...active, status: 'aborted', finishedAt: CREATED_AT });
    const terminalReview = await reviewProjectCoordination(projectPath);
    await clearReviewedProjectClaim(projectPath, terminalReview.reviewDigest, true, true);
    expect((await reviewProjectCoordination(projectPath)).claim).toBeNull();
  });

  it('serializes a claimed mutation against reviewed claim clearing', async () => {
    await enableCoordination();
    const claim = await acquireProjectRunClaim(projectPath, 'managed', 'run-claimed');
    const review = await reviewProjectCoordination(projectPath);
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const mutation = withClaimedProjectRun(projectPath, claim, async (current) => {
      expect(current).toEqual(claim);
      enter();
      await gate;
    });
    await entered;
    let cleared = false;
    const clearing = clearReviewedProjectClaim(projectPath, review.reviewDigest, true, true)
      .then(() => { cleared = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cleared).toBe(false);
    finish();
    await mutation;
    await clearing;
    expect((await reviewProjectCoordination(projectPath)).claim).toBeNull();
    const callback = vi.fn();
    await expect(withClaimedProjectRun(projectPath, claim, callback))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_MISMATCH' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects a clearing review made stale by a serialized claimed mutation', async () => {
    await enableCoordination();
    const claim = await acquireProjectRunClaim(projectPath, 'managed', 'run-claimed');
    const review = await reviewProjectCoordination(projectPath);
    await withClaimedProjectRun(projectPath, claim, async () => {
      await storeFor().create(makeRun({ id: claim.runId, status: 'running' }));
    });
    await expect(clearReviewedProjectClaim(projectPath, review.reviewDigest, true, true))
      .rejects.toMatchObject({ code: 'PROJECT_REVIEW_STALE' });
    expect(await requireProjectRunClaim(projectPath, claim)).toEqual(claim);
  });

  it('retains a committed claim when a coordinated start fails before writing a record', async () => {
    await enableCoordination();
    const failure = new Error('injected start failure');
    await expect(beginCoordinatedProjectRun(projectPath, 'managed', 'run-claimed', async () => {
      throw failure;
    })).rejects.toBe(failure);
    const claim = await requireProjectRunClaim(projectPath, { kind: 'managed', runId: 'run-claimed' });
    expect(claim).toMatchObject({ kind: 'managed', runId: 'run-claimed' });
    const callback = vi.fn(async () => 'unexpected');
    await expect(withCoordinatedProjectRun(projectPath, { kind: 'managed', runId: 'other' }, callback))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_MISMATCH' });
    expect(callback).not.toHaveBeenCalled();
    expect(await withCoordinatedProjectRun(projectPath, claim, async () => 'matched')).toBe('matched');
  });

  it('serializes a legacy start with protocol enablement and invalidates stale review', async () => {
    const review = await reviewProjectCoordination(projectPath);
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const start = beginCoordinatedProjectRun(projectPath, 'managed', 'run-legacy', async () => {
      enter();
      await gate;
      await storeFor().create(makeRun({ id: 'run-legacy', status: 'running' }));
    });
    await entered;
    const enablement = enableReviewedProjectProtocol(projectPath, review.reviewDigest, true);
    finish();
    await start;
    await expect(enablement).rejects.toMatchObject({ code: 'PROJECT_REVIEW_STALE' });
    const after = await reviewProjectCoordination(projectPath);
    expect(after.protocol).toBeNull();
    expect(after.claim).toBeNull();
    expect(after.records).toEqual([expect.objectContaining({ runId: 'run-legacy', unresolved: true })]);
  });

  it('refuses to create a project claim over unresolved legacy records', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-legacy', status: 'running' });
    const portableId = '12345678-1234-1234-1234-123456789abc';
    await store.create(active);
    await enableCoordination();
    await expect(acquireProjectRunClaim(projectPath, 'portable', portableId))
      .rejects.toMatchObject({
        code: 'PROJECT_RECONCILIATION_REQUIRED',
        records: [expect.objectContaining({ kind: 'managed', runId: active.id, status: 'running', unresolved: true })],
      });
    await store.update({ ...active, status: 'aborted', finishedAt: CREATED_AT });
    const claimed = await acquireProjectRunClaim(projectPath, 'portable', portableId);
    expect(await requireProjectRunClaim(projectPath, { kind: 'portable', runId: portableId })).toEqual(claimed);
    await expect(acquireProjectRunClaim(projectPath, 'managed', 'second-run'))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_CONFLICT' });
    await expect(requireProjectRunClaim(projectPath, { kind: 'managed', runId: portableId }))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_MISMATCH' });
  });

  it('classifies unresolved managed records for project claim reconciliation', async () => {
    const store = storeFor();
    await store.create(makeRun({ id: 'run-live', status: 'running' }));
    await store.create(makeRun({ id: 'run-done', status: 'completed', finishedAt: CREATED_AT }));
    const records = await scanProjectRunRecords(await realpath(projectPath));
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'managed', runId: 'run-live', status: 'running', unresolved: true }),
      expect.objectContaining({ kind: 'managed', runId: 'run-done', status: 'completed', unresolved: false }),
    ]));
    await writeFile(runFile('run-live'), '{"version":1', 'utf8');
    await expect(scanProjectRunRecords(await realpath(projectPath)))
      .rejects.toMatchObject({ code: 'PROJECT_RUN_RECORDS_UNSAFE' });
  });

  it('rejects symlinked run records and directories during project claim scanning', async () => {
    const store = storeFor();
    await store.create(makeRun({ id: 'run-valid', status: 'completed', finishedAt: CREATED_AT }));
    await symlink(runFile('run-valid'), runFile('run-link'));
    await expect(scanProjectRunRecords(await realpath(projectPath)))
      .rejects.toMatchObject({ code: 'PROJECT_RUN_RECORDS_UNSAFE' });
    await rm(runFile('run-link'));
    await symlink(runsDirectory(), join(projectPath, '.loom', 'portable-runs'));
    await expect(scanProjectRunRecords(await realpath(projectPath)))
      .rejects.toMatchObject({ code: 'PROJECT_RUN_RECORDS_UNSAFE' });
  });

  it('does not interrupt a different profile run from a separate process', async () => {
    const first = storeFor();
    const foreign = makeRun({ id: 'run-other-process', status: 'running' });
    await first.create(foreign);
    const original = await readFile(runFile(foreign.id), 'utf8');
    const secondConfig = join(root, 'second-process-config');
    await mkdir(secondConfig);
    const script = `
      import { recoverActiveRunOnStartup } from './src/server/runs/store.ts';
      const result = await recoverActiveRunOnStartup({
        configDirectory: process.argv[1],
        knownProjectPaths: [process.argv[2]],
      });
      process.stdout.write(JSON.stringify(result));
    `;
    const output = execFileSync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '-e', script, secondConfig, projectPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    const result = JSON.parse(output) as { interrupted: Run[]; warnings: Array<{ code: string; runId?: string }> };
    expect(result.interrupted).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: RUN_STORE_WARNING_CODES.RECOVERY_AMBIGUOUS,
      runId: foreign.id,
    }));
    expect(await readFile(runFile(foreign.id), 'utf8')).toBe(original);
    expect((await first.getActiveRun())?.runId).toBe(foreign.id);
  });

  it('leaves another profile active records unchanged, including when this profile has a different pointer', async () => {
    const first = storeFor();
    const secondConfig = join(root, 'second-config');
    await mkdir(secondConfig);
    const second = storeFor({ configDirectory: secondConfig });
    const foreign = makeRun({ id: 'run-foreign', status: 'running' });
    await first.create(foreign);
    const original = await readFile(runFile(foreign.id), 'utf8');

    const noPointer = await recoverActiveRunOnStartup({
      configDirectory: secondConfig,
      knownProjectPaths: [projectPath],
    });
    expect(noPointer.interrupted).toEqual([]);
    expect(noPointer.warnings).toContainEqual(expect.objectContaining({
      code: RUN_STORE_WARNING_CODES.RECOVERY_AMBIGUOUS,
      runId: foreign.id,
    }));
    expect(await readFile(runFile(foreign.id), 'utf8')).toBe(original);
    expect((await first.getActiveRun())?.runId).toBe(foreign.id);

    const own = makeRun({ id: 'run-second', status: 'running' });
    await second.create(own);
    const withPointer = await recoverActiveRunOnStartup({
      configDirectory: secondConfig,
      knownProjectPaths: [projectPath],
    });
    expect(withPointer.interrupted.map((run) => run.id)).toEqual([own.id]);
    expect(withPointer.warnings).toContainEqual(expect.objectContaining({
      code: RUN_STORE_WARNING_CODES.RECOVERY_AMBIGUOUS,
      runId: foreign.id,
    }));
    expect(await readFile(runFile(foreign.id), 'utf8')).toBe(original);
    expect((await first.getActiveRun())?.runId).toBe(foreign.id);
    expect(await second.getActiveRun()).toBeNull();
  });

  it('marks stale active records interrupted and clears the pointer', async () => {
    const store = storeFor();
    const live = makeRun({
      id: 'run-live',
      status: 'running',
      steps: makeRun().steps.map((step, index) =>
        index === 0
          ? { ...step, status: 'running' as const, startedAt: CREATED_AT }
          : step,
      ),
    });
    await store.create(live);
    await store.create(
      makeRun({ id: 'run-finished', status: 'completed', finishedAt: CREATED_AT }),
    );

    const restarted = createRunStore({
      projectPath,
      configDirectory,
      now: () => new Date('2026-11-04T11:00:00.000Z'),
    });

    const result = await restarted.recoverInterruptedRuns();

    expect(result.interrupted.map((run) => run.id)).toEqual(['run-live']);
    expect(result.clearedActiveRun).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(await restarted.getActiveRun()).toBeNull();
    expect(await fileExists(pointerFile())).toBe(false);

    const persisted = await restarted.read('run-live');
    expect(persisted.status).toBe('interrupted');
    expect(persisted.finishedAt).toBe('2026-11-04T11:00:00.000Z');
    expect(persisted.reason).toBe('SERVER_RESTART');
    expect(persisted.steps[0]).toMatchObject({
      status: 'interrupted',
      finishedAt: '2026-11-04T11:00:00.000Z',
    });
    expect(persisted.steps[1]?.status).toBe('pending');
    expect((await restarted.read('run-finished')).status).toBe('completed');

    const again = await restarted.recoverInterruptedRuns();
    expect(again.interrupted).toEqual([]);
    expect(again.clearedActiveRun).toBe(false);
  });

  it('clears a stale pointer whose run record is missing', async () => {
    const store = storeFor();
    await writeFile(
      pointerFile(),
      JSON.stringify({
        version: 1,
        runId: 'run-missing',
        projectId: 'project-1',
        projectPath: await realpath(projectPath),
        status: 'running',
        startedAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
      'utf8',
    );

    const result = await store.recoverInterruptedRuns();

    expect(result.interrupted).toEqual([]);
    expect(result.clearedActiveRun).toBe(true);
    expect(await fileExists(pointerFile())).toBe(false);
  });

  it('preserves a corrupt pointer and active record and fails recovery explicitly', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-corrupt-pointer', status: 'running' });
    await store.create(active);
    const original = await readFile(runFile(active.id), 'utf8');
    await writeFile(pointerFile(), '{"version":1', 'utf8');

    await expectRunStoreError(store.recoverInterruptedRuns(), RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT);
    await expectRunStoreError(
      recoverActiveRunOnStartup({ configDirectory, knownProjectPaths: [projectPath] }),
      RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT,
    );
    expect(await readFile(runFile(active.id), 'utf8')).toBe(original);
    await expectRunStoreError(store.releaseActiveRun(active.id), RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT);
    await expectRunStoreError(
      store.update({ ...active, updatedAt: LATER_AT }),
      RUN_STORE_ERROR_CODES.ACTIVE_POINTER_CORRUPT,
    );
    expect(await readFile(pointerFile(), 'utf8')).toBe('{"version":1');
    expect(await readFile(runFile(active.id), 'utf8')).not.toBe(original);
    expect((await store.read(active.id)).updatedAt).toBe(LATER_AT);
  });

  it('does not clear or replace an active pointer when its run record is corrupt', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-corrupt-target', status: 'running' });
    await store.create(active);
    const pointer = await readFile(pointerFile(), 'utf8');
    await writeFile(runFile(active.id), '{"version":1', 'utf8');

    await expectRunStoreError(store.recoverInterruptedRuns(), RUN_STORE_ERROR_CODES.FILE_CORRUPT);
    await expectRunStoreError(
      recoverActiveRunOnStartup({ configDirectory }),
      RUN_STORE_ERROR_CODES.FILE_CORRUPT,
    );
    await expectRunStoreError(
      store.create(makeRun({ id: 'run-new', status: 'running' })),
      RUN_STORE_ERROR_CODES.FILE_CORRUPT,
    );
    expect(await readFile(pointerFile(), 'utf8')).toBe(pointer);
    expect(await readFile(runFile(active.id), 'utf8')).toBe('{"version":1');
    expect(await fileExists(runFile('run-new'))).toBe(false);
  });

  it('follows the global pointer from another directory on startup', async () => {
    const store = storeFor();
    await store.create(makeRun({ id: 'run-global', status: 'running' }));

    const result = await recoverActiveRunOnStartup({
      configDirectory,
      now: () => new Date('2026-11-04T11:00:00.000Z'),
    });

    expect(result.projects).toEqual([await realpath(projectPath)]);
    expect(result.interrupted.map((run) => run.id)).toEqual(['run-global']);
    expect(result.clearedActiveRun).toBe(true);
    expect(await readActiveRunPointerFile({ configDirectory })).toBeNull();
  });

  it('clears a pointer that names a project which no longer exists', async () => {
    const missingProject = join(root, 'deleted-project');
    await writeFile(
      pointerFile(),
      JSON.stringify({
        version: 1,
        runId: 'run-orphan',
        projectId: 'project-orphan',
        projectPath: missingProject,
        status: 'running',
        startedAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
      'utf8',
    );

    const result = await recoverActiveRunOnStartup({ configDirectory });

    expect(result.clearedActiveRun).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: RUN_STORE_WARNING_CODES.PROJECT_NOT_FOUND,
        runId: 'run-orphan',
      }),
    ]);
    expect(await fileExists(pointerFile())).toBe(false);
  });
});

describe('atomic persistence', () => {
  it('keeps the previous run and removes the temporary file when rename fails', async () => {
    const store = storeFor();
    const original = makeRun();
    await store.create(original);
    const originalBytes = await readFile(runFile(original.id), 'utf8');

    const failingStore = createRunStore({
      projectPath,
      configDirectory,
      atomicWrite: (target, run) =>
        atomicWriteRunJson(target, run, {
          renameFile: async () => {
            throw Object.assign(new Error('simulated rename failure'), { code: 'EIO' });
          },
        }),
    });

    const error = await expectRunStoreError(
      failingStore.update({ ...original, reason: 'changed' }),
      RUN_STORE_ERROR_CODES.WRITE_FAILED,
    );
    expect(error.details).toMatchObject({
      path: runFile(original.id),
      runId: original.id,
      reason: 'EIO',
    });

    expect(await readFile(runFile(original.id), 'utf8')).toBe(originalBytes);
    expect(await failingStore.read(original.id)).toEqual(original);
    expect(await temporaryFiles(runsDirectory())).toEqual([]);
  });

  it('leaves no target and no pointer change when a create write fails', async () => {
    const store = storeFor();
    const active = makeRun({ id: 'run-active' });
    await store.create(active);

    const failingStore = createRunStore({
      projectPath,
      configDirectory,
      atomicWrite: (target, run) =>
        atomicWriteRunJson(target, run, {
          renameFile: async () => {
            throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
          },
        }),
    });

    const error = await expectRunStoreError(
      failingStore.create(makeRun({ id: 'run-new' })),
      RUN_STORE_ERROR_CODES.WRITE_FAILED,
    );
    expect(error.details.reason).toBe('EXDEV');

    expect(await fileExists(runFile('run-new'))).toBe(false);
    expect(await temporaryFiles(runsDirectory())).toEqual([]);
    expect((await store.getActiveRun())?.runId).toBe('run-active');
  });
});

describe('identifier safety', () => {
  it('rejects traversal and separator ids before any filesystem access', async () => {
    const realpathSpy = vi.fn(async (path: string) => realpath(path));
    const store = createRunStore({
      projectPath,
      configDirectory,
      realpathPath: realpathSpy,
    });

    const unsafeIds = [
      '../escape',
      '..',
      '.',
      'a/b',
      'a\\b',
      '/absolute',
      'has space',
      'UPPERCASE',
      '%2e%2e%2fescape',
      'nul\0byte',
      'x'.repeat(65),
      '',
    ];

    for (const runId of unsafeIds) {
      const error = await expectRunStoreError(
        store.read(runId),
        RUN_STORE_ERROR_CODES.ID_INVALID,
      );
      expect(error.details.runId).toBe(runId);
    }

    await expectRunStoreError(
      store.create(makeRun({ id: '../escape' })),
      RUN_STORE_ERROR_CODES.ID_INVALID,
    );
    await expectRunStoreError(
      store.update(makeRun({ id: 'a/b' })),
      RUN_STORE_ERROR_CODES.ID_INVALID,
    );
    await expectRunStoreError(
      store.activate(makeRun({ id: '..\\escape' })),
      RUN_STORE_ERROR_CODES.ID_INVALID,
    );
    await expectRunStoreError(
      store.releaseActiveRun('/absolute'),
      RUN_STORE_ERROR_CODES.ID_INVALID,
    );

    expect(realpathSpy).not.toHaveBeenCalled();
    expect(await fileExists(join(projectPath, '.loom'))).toBe(false);
    expect(await fileExists(join(root, 'escape.json'))).toBe(false);
  });

  it('accepts only lowercase filename-safe ids', () => {
    expect(isSafeRunId('run-2026_abc')).toBe(true);
    expect(isSafeRunId('0run')).toBe(true);
    expect(isSafeRunId('Run')).toBe(false);
    expect(isSafeRunId('../run')).toBe(false);
    expect(isSafeRunId('')).toBe(false);
    expect(isSafeRunId(42)).toBe(false);
  });
});

describe('containment', () => {
  it('rejects a symlinked .loom directory before creating anything outside the project', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(projectPath, '.loom'), 'dir');
    const store = storeFor();

    const listError = await expectRunStoreError(
      store.list(),
      RUN_STORE_ERROR_CODES.PATH_ESCAPED,
    );
    expect(listError.details).toMatchObject({ name: '.loom', reason: 'SYMLINK' });

    await expectRunStoreError(store.create(makeRun()), RUN_STORE_ERROR_CODES.PATH_ESCAPED);
    expect(await readdir(outside)).toEqual([]);
  });

  it('rejects a symlinked runs directory', async () => {
    const outside = join(root, 'outside-runs');
    await mkdir(outside);
    await mkdir(join(projectPath, '.loom'));
    await symlink(outside, runsDirectory(), 'dir');
    const store = storeFor();

    await expectRunStoreError(store.list(), RUN_STORE_ERROR_CODES.PATH_ESCAPED);
    await expectRunStoreError(store.create(makeRun()), RUN_STORE_ERROR_CODES.PATH_ESCAPED);
    expect(await readdir(outside)).toEqual([]);
  });

  it('does not follow a symlinked run file', async () => {
    const store = storeFor();
    await store.create(makeRun({ id: 'run-real' }), { activate: false });

    const outside = join(root, 'outside-run.json');
    await writeFile(outside, JSON.stringify(makeRun({ id: 'run-link' })), 'utf8');
    await symlink(outside, runFile('run-link'));

    await expectRunStoreError(store.read('run-link'), RUN_STORE_ERROR_CODES.PATH_ESCAPED);
    expect((await store.list()).runs.map((run) => run.id)).toEqual(['run-real']);
  });

  it('rejects a project path that is missing without scaffolding it', async () => {
    const store = createRunStore({
      projectPath: join(root, 'missing-project'),
      configDirectory,
    });

    await expectRunStoreError(store.list(), RUN_STORE_ERROR_CODES.PROJECT_NOT_FOUND);
    expect(await fileExists(join(root, 'missing-project'))).toBe(false);
  });
});

describe('listing and warnings', () => {
  it('orders runs by updatedAt descending', async () => {
    const store = storeFor();
    await store.create(
      makeRun({ id: 'run-oldest', status: 'completed', updatedAt: '2026-11-04T10:00:00.000Z' }),
      { activate: false },
    );
    await store.create(
      makeRun({ id: 'run-newest', status: 'completed', updatedAt: '2026-11-04T12:00:00.000Z' }),
      { activate: false },
    );
    await store.create(
      makeRun({ id: 'run-middle', status: 'completed', updatedAt: '2026-11-04T11:00:00.000Z' }),
      { activate: false },
    );

    const listed = await store.list();

    expect(listed.warnings).toEqual([]);
    expect(listed.runs.map((run) => run.id)).toEqual([
      'run-newest',
      'run-middle',
      'run-oldest',
    ]);
  });

  it('reports corrupt, invalid, unsupported, and mismatched files as warnings', async () => {
    const store = storeFor();
    await store.create(makeRun({ id: 'run-valid' }), { activate: false });

    const brokenPath = runFile('broken');
    const brokenBytes = '{"version":1,"id":"broken"';
    await writeFile(brokenPath, brokenBytes, 'utf8');

    const invalidPath = runFile('invalid');
    await writeFile(
      invalidPath,
      JSON.stringify({ version: 1, id: 'invalid', name: 'not a run' }),
      'utf8',
    );

    const futurePath = runFile('future');
    await writeFile(
      futurePath,
      JSON.stringify({ ...makeRun({ id: 'future' }), version: 2 }),
      'utf8',
    );

    const mismatchPath = runFile('run-other');
    await writeFile(mismatchPath, JSON.stringify(makeRun({ id: 'run-valid' })), 'utf8');

    const listed = await store.list();

    expect(listed.runs.map((run) => run.id)).toEqual(['run-valid']);
    expect(listed.warnings.map((warning) => warning.code)).toEqual([
      RUN_STORE_WARNING_CODES.FILE_CORRUPT,
      RUN_STORE_WARNING_CODES.UNSUPPORTED_VERSION,
      RUN_STORE_WARNING_CODES.FILE_CORRUPT,
      RUN_STORE_WARNING_CODES.FILE_ID_MISMATCH,
    ]);
    expect(listed.warnings.map((warning) => warning.path)).toEqual([
      brokenPath,
      futurePath,
      invalidPath,
      mismatchPath,
    ]);
    expect(listed.warnings[0]).toMatchObject({ runId: 'broken', reason: 'INVALID_JSON' });
    expect(listed.warnings[1]).toMatchObject({ runId: 'future', version: 2 });
    expect(listed.warnings[3]).toMatchObject({ runId: 'run-other', reason: 'ID_MISMATCH' });

    // Corrupt files are quarantined, never deleted or rewritten.
    expect(await readFile(brokenPath, 'utf8')).toBe(brokenBytes);
    expect(await fileExists(invalidPath)).toBe(true);
    expect(await fileExists(futurePath)).toBe(true);
    expect(await fileExists(mismatchPath)).toBe(true);
  });

  it('ignores non-JSON and temporary files without warnings', async () => {
    const store = storeFor();
    await store.create(makeRun({ id: 'run-alpha' }), { activate: false });

    await writeFile(join(runsDirectory(), 'notes.txt'), 'not a run\n', 'utf8');
    await writeFile(join(runsDirectory(), '.run-alpha.json.123.tmp'), 'partial', 'utf8');

    const listed = await store.list();

    expect(listed.runs.map((run) => run.id)).toEqual(['run-alpha']);
    expect(listed.warnings).toEqual([]);
  });
});

describe('pointer helpers', () => {
  it('reads and clears the pointer without constructing a store', async () => {
    const store = storeFor();
    await store.create(makeRun({ id: 'run-pointer' }));

    const pointer = await readActiveRunPointerFile({ configDirectory });
    expect(pointer).toMatchObject({ runId: 'run-pointer', status: 'starting' });

    expect(await clearActiveRunPointerFile({ configDirectory })).toBe(true);
    expect(await readActiveRunPointerFile({ configDirectory })).toBeNull();
    expect(await clearActiveRunPointerFile({ configDirectory })).toBe(false);
    expect(await fileExists(pointerFile())).toBe(false);
  });

  it('uses LOOM_CONFIG_DIR when no directory is injected', async () => {
    const store = createRunStore({
      projectPath,
      env: { ...process.env, LOOM_CONFIG_DIR: configDirectory },
    });
    await store.create(makeRun({ id: 'run-env' }));

    expect(await fileExists(join(configDirectory, ACTIVE_RUN_FILE_NAME))).toBe(true);
  });
});
import { execFileSync } from 'node:child_process';
