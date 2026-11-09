import { spawn, type ChildProcess } from 'node:child_process';
import type { TerminalExit } from '../terminal/pty.js';
import type { AutomaticProcess, AutomaticSpawnSpec } from './automatic.js';
import { trimTail } from './model.js';

const MAX_PROCESS_BUFFER_BYTES = 64 * 1024;

/** Create a shell-free process whose exit is the automatic advancement signal. */
export function createChildProcessAdapter(spec: AutomaticSpawnSpec): AutomaticProcess {
  const child = spawn(spec.executable, [...spec.args], {
    cwd: spec.cwd,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return adaptChildProcess(child);
}

export function adaptChildProcess(child: ChildProcess): AutomaticProcess {
  const dataListeners = new Set<(chunk: string) => void>();
  const exitListeners = new Set<(event: TerminalExit) => void>();
  let dataSubscribed = false;
  let buffered = '';
  let exitEvent: TerminalExit | null = null;

  const append = (chunk: string): void => {
    if (chunk === '') return;
    if (dataSubscribed) {
      for (const listener of [...dataListeners]) listener(chunk);
      return;
    }
    buffered += chunk;
    if (Buffer.byteLength(buffered, 'utf8') > MAX_PROCESS_BUFFER_BYTES) {
      buffered = trimTail(buffered);
    }
  };

  child.stdout?.on('data', (chunk: Buffer | string) => append(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer | string) => append(chunk.toString()));

  const finish = (event: TerminalExit): void => {
    if (exitEvent !== null) return;
    exitEvent = event;
    for (const listener of [...exitListeners]) listener(event);
    exitListeners.clear();
  };

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (child.pid === undefined) {
      finish({ exitCode: -1 });
      return;
    }
    const code = error.code !== undefined && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'UNKNOWN';
    console.error(`Skill Loom received a process error for child ${child.pid} (${code}); exit is not confirmed.`);
  });
  child.once('exit', (code) => finish({ exitCode: code ?? -1 }));

  return {
    pid: child.pid ?? -1,
    onData(listener) {
      dataListeners.add(listener);
      if (!dataSubscribed) {
        dataSubscribed = true;
        const pending = buffered;
        buffered = '';
        if (pending !== '') listener(pending);
      }
      return () => { dataListeners.delete(listener); };
    },
    onExit(listener) {
      if (exitEvent !== null) {
        const event = exitEvent;
        queueMicrotask(() => listener(event));
        return () => undefined;
      }
      exitListeners.add(listener);
      return () => { exitListeners.delete(listener); };
    },
    kill(signal) {
      child.kill(signal as NodeJS.Signals | undefined);
    },
    isRunning() {
      return exitEvent === null;
    },
    getExit() {
      return exitEvent;
    },
  };
}
