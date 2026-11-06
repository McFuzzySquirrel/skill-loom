import type { TerminalExit } from '../terminal/pty.js';

export interface StoppableProcess {
  readonly pid: number;
  isRunning(): boolean;
  onExit(listener: (event: TerminalExit) => void): () => void;
  kill(signal?: string): void;
}

function waitForExit(
  process: StoppableProcess,
): { promise: Promise<void>; dispose: () => void } {
  if (!process.isRunning()) {
    return { promise: Promise.resolve(), dispose: () => undefined };
  }

  let resolveExit: () => void = () => undefined;
  let settled = false;
  const promise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  let unsubscribe: () => void = () => undefined;
  unsubscribe = process.onExit(() => {
    if (settled) return;
    settled = true;
    unsubscribe();
    resolveExit();
  });
  if (!process.isRunning() && !settled) {
    settled = true;
    unsubscribe();
    resolveExit();
  }

  return {
    promise,
    dispose: unsubscribe,
  };
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const completed = promise.then(() => true as const);
  const settled = await Promise.race([completed, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return settled;
}

/** Dispose a runner, wait for graceful termination, then escalate once. */
export async function disposeAndWait(
  process: StoppableProcess | null,
  dispose: () => void,
): Promise<void> {
  if (process === null || !process.isRunning()) {
    dispose();
    return;
  }

  const exit = waitForExit(process);
  try {
    dispose();
    if (!(await settlesWithin(exit.promise, 500)) && process.isRunning()) {
      process.kill('SIGKILL');
      if (!(await settlesWithin(exit.promise, 2_000)) && process.isRunning()) {
        throw new Error(`Owned process ${process.pid} did not exit after forced termination.`);
      }
    }
  } finally {
    exit.dispose();
  }
}
