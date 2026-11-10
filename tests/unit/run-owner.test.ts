import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../src/server/config/store.js';
import { createRunOwner } from '../../src/server/runs/owner.js';
import type { RunOrchestrator } from '../../src/server/runs/orchestrator.js';
import type { RunStoreWarning } from '../../src/server/runs/store.js';
import { createProjectRegistry } from '../../src/server/projects/registry.js';
import { createTerminalManager } from '../../src/server/terminal/pty.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(onRunRecoveryWarning?: (warning: RunStoreWarning) => void) {
  const root = await mkdtemp(join(tmpdir(), 'loom-run-owner-'));
  roots.push(root);
  const configStore = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
  const orchestrator: RunOrchestrator = {
    createRun: vi.fn(),
    getRun: vi.fn(),
    getRunView: vi.fn(),
    getActiveRun: vi.fn(), hasLiveProject: vi.fn().mockReturnValue(false),
    applyAction: vi.fn(),
    subscribe: vi.fn(),
    recoverOnStartup: vi.fn().mockResolvedValue({ interrupted: [], clearedActiveRun: false, warnings: [], projects: [] }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  return {
    root,
    orchestrator,
    owner: createRunOwner({
      configStore,
      runOrchestrator: orchestrator,
      terminalManager: createTerminalManager(),
      ...(onRunRecoveryWarning === undefined ? {} : { onRunRecoveryWarning }),
    }),
  };
}

describe('shared run owner', () => {
  it('surfaces startup recovery warnings to the server logger', async () => {
    const report = vi.fn();
    const { owner, orchestrator } = await setup(report);
    const warning = {
      code: 'RUN_RECOVERY_AMBIGUOUS' as const,
      message: 'Ownership is unknown.',
      path: '/project/.loom/runs/run.json',
      runId: 'run',
    };
    vi.mocked(orchestrator.recoverOnStartup).mockResolvedValueOnce({
      interrupted: [], clearedActiveRun: false, warnings: [warning], projects: [],
    });
    await owner.get();
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(warning);
    await owner.shutdown();
  });

  it('remains lazy for an untouched profile and shares one recovery across callers', async () => {
    const { owner, orchestrator } = await setup();
    await owner.recoverIfConfigured();
    expect(orchestrator.recoverOnStartup).not.toHaveBeenCalled();

    const [first, second] = await Promise.all([owner.get(), owner.get()]);
    expect(first).toBe(orchestrator);
    expect(second).toBe(first);
    expect(orchestrator.recoverOnStartup).toHaveBeenCalledTimes(1);
    await Promise.all([owner.shutdown(), owner.shutdown()]);
    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
    await expect(owner.get()).rejects.toThrow('shutting down');
  });

  it('does not reuse an injected orchestrator after recovery fails', async () => {
    const { root, owner, orchestrator } = await setup();
    await writeFile(join(root, 'config.json'), '{}');
    const error = new Error('recovery failed');
    vi.mocked(orchestrator.recoverOnStartup).mockRejectedValueOnce(error);

    await expect(owner.recoverIfConfigured()).rejects.toBe(error);
    await expect(owner.get()).rejects.toBe(error);
    expect(orchestrator.shutdown).not.toHaveBeenCalled();
    expect(orchestrator.recoverOnStartup).toHaveBeenCalledTimes(1);
    await owner.shutdown();
    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shuts down an orchestrator even when recovery fails without a retry', async () => {
    const { owner, orchestrator } = await setup();
    vi.mocked(orchestrator.recoverOnStartup).mockRejectedValueOnce(new Error('recovery failed'));

    await expect(owner.get()).rejects.toThrow('recovery failed');
    await owner.shutdown();
    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
  });

  it('creates a usable new internal orchestrator after failed recovery is cleaned up', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-run-owner-retry-'));
    roots.push(root);
    const configStore = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
    const projectRegistry = createProjectRegistry({ configStore });
    const recovery = vi.spyOn(projectRegistry, 'listKnownProjects')
      .mockRejectedValueOnce(new Error('recovery failed')).mockResolvedValue([]);
    const owner = createRunOwner({ configStore, projectRegistry, terminalManager: createTerminalManager() });

    await expect(owner.get()).rejects.toThrow('recovery failed');
    const [first, second] = await Promise.all([owner.get(), owner.get()]);
    expect(first).toBe(second);
    expect(recovery).toHaveBeenCalledTimes(2);
    await expect(first.getActiveRun()).resolves.toMatchObject({ active: false });
    await owner.shutdown();
  });

  it('retains failed recovery for shutdown when an injected orchestrator cannot be retried', async () => {
    const { owner, orchestrator } = await setup();
    const recoveryError = new Error('recovery failed');
    const cleanupError = new Error('cleanup failed');
    vi.mocked(orchestrator.recoverOnStartup).mockRejectedValueOnce(recoveryError);
    vi.mocked(orchestrator.shutdown).mockRejectedValue(cleanupError);

    await expect(owner.get()).rejects.toBe(recoveryError);
    await expect(owner.get()).rejects.toBe(recoveryError);
    expect(orchestrator.recoverOnStartup).toHaveBeenCalledTimes(1);
    await expect(owner.shutdown()).rejects.toBe(cleanupError);
    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
  });

  it('refuses to block while a run mutation is in progress and rejects new mutations once blocked', async () => {
    const { owner } = await setup();
    let release: () => void = () => undefined;
    const pending = owner.withMutation(() => new Promise<void>((resolve) => { release = resolve; }));
    expect(owner.blockMutations()).toBe(false);
    release();
    await pending;
    expect(owner.blockMutations()).toBe(true);
    await expect(owner.withMutation(async () => undefined)).rejects.toMatchObject({ code: 'RUN_OWNER_STOPPING' });
    owner.unblockMutations();
    await expect(owner.withMutation(async () => 'ok')).resolves.toBe('ok');
    await owner.shutdown();
  });

  it('waits for in-flight mutations before shutdown and refuses new ones', async () => {
    const { owner, orchestrator } = await setup();
    await owner.get();
    let release: () => void = () => undefined;
    const mutation = owner.withMutation(() => new Promise<void>((resolve) => { release = resolve; }));
    const shutdown = owner.shutdown();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(orchestrator.shutdown).not.toHaveBeenCalled();
    await expect(owner.withMutation(async () => undefined)).rejects.toMatchObject({ code: 'RUN_OWNER_STOPPING' });
    release();
    await mutation;
    await shutdown;
    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
  });

  it('drains an exclusive reconciliation before shutting down and rejects competing mutations', async () => {
    const { owner, orchestrator } = await setup();
    await owner.get();
    let release: () => void = () => undefined;
    const reconciliation = owner.withExclusiveMutation(() => new Promise<void>((resolve) => { release = resolve; }));
    await expect(owner.withMutation(async () => undefined)).rejects.toMatchObject({ code: 'RUN_OWNER_STOPPING' });
    await expect(owner.withExclusiveMutation(async () => undefined)).rejects.toMatchObject({ code: 'RUN_OWNER_STOPPING' });
    expect(owner.blockMutations()).toBe(false);
    const shutdown = owner.shutdown();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(orchestrator.shutdown).not.toHaveBeenCalled();
    release();
    await reconciliation;
    await shutdown;
    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
    await expect(owner.withMutation(async () => undefined)).rejects.toMatchObject({ code: 'RUN_OWNER_STOPPING' });
  });

  it('releases the exclusive barrier when reconciliation fails', async () => {
    const { owner } = await setup();
    await expect(owner.withExclusiveMutation(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(owner.withMutation(async () => 'ok')).resolves.toBe('ok');
    await owner.shutdown();
  });
});
