import { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptChildProcess, createChildProcessAdapter } from '../../src/server/runs/headless-process.js';
import { disposeAndWait } from '../../src/server/runs/process-cleanup.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('headless process adapter', () => {
  it('does not mistake signaling errors for exit or bypass cleanup escalation', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 12345 });
    const kill = vi.spyOn(child, 'kill').mockImplementation(() => {
      child.emit('error', Object.assign(new Error('private details'), { code: 'EPERM' }));
      return false;
    });
    const process = adaptChildProcess(child);
    const onExit = vi.fn();
    process.onExit(onExit);

    const cleanup = disposeAndWait(process, () => process.kill('SIGTERM'));
    const failure = expect(cleanup).rejects.toThrow('Owned process 12345 did not exit');
    expect(process.isRunning()).toBe(true);
    expect(process.getExit()).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_500);
    await failure;
    expect(kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).not.toContain('private details');
    expect(process.isRunning()).toBe(true);

    child.emit('exit', 0, null);
    expect(process.isRunning()).toBe(false);
    expect(onExit).toHaveBeenCalledOnce();
    expect(process.getExit()).toEqual({ exitCode: 0 });
  });

  it('records an unsuccessful spawn as a failed exit', async () => {
    const child = new ChildProcess();
    const process = adaptChildProcess(child);
    const onExit = vi.fn();
    process.onExit(onExit);
    child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
    expect(process.getExit()).toEqual({ exitCode: -1 });
    expect(onExit).toHaveBeenCalledExactlyOnceWith({ exitCode: -1 });
    const lateListener = vi.fn();
    process.onExit(lateListener);
    await Promise.resolve();
    expect(lateListener).toHaveBeenCalledExactlyOnceWith({ exitCode: -1 });
  });

  it('observes output and exit from a real process', async () => {
    const process = createChildProcessAdapter({
      surface: 'process',
      terminalId: 'fixture',
      executable: globalThis.process.execPath,
      args: ['-e', 'process.stdout.write("fixture")'],
      cwd: globalThis.process.cwd(),
      cols: 80,
      rows: 24,
    });
    const output: string[] = [];
    process.onData((chunk) => output.push(chunk));
    const result = await new Promise<{ exitCode: number }>((resolve) => process.onExit(resolve));
    expect(result.exitCode).toBe(0);
    expect(output.join('')).toBe('fixture');
    expect(process.isRunning()).toBe(false);
  });
});
