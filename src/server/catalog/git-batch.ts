import { spawn } from 'node:child_process';

export class GitBatchError extends Error {
  constructor(
    readonly code: 'TIMEOUT' | 'TOO_LARGE' | 'FAILED' | 'CANCELLED',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GitBatchError';
  }
}

export interface GitBlobReader {
  read(object: string, maxBytes: number): Promise<Buffer>;
  close(abort?: boolean): Promise<void>;
}

/**
 * Read Git blobs through one shell-free process. Only one request is in
 * flight, and the declared object size is checked before allocating its body.
 */
export function createGitBlobReader(options: {
  repository: string;
  cwd: string;
  timeoutMs: number;
  maxStderrBytes: number;
  exceedsStagingLimits?: () => Promise<{ dimension: string; limit: number } | null>;
  signal?: AbortSignal;
}): GitBlobReader {
  const child = spawn('git', ['-C', options.repository, 'cat-file', '--batch'], {
    cwd: options.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  let failure: GitBatchError | undefined;
  let stderrBytes = 0;
  let pending = Buffer.alloc(0);
  let closed = false;
  let reading = false;
  let closing: Promise<void> | undefined;
  let monitor: NodeJS.Timeout | undefined;
  let escalation: NodeJS.Timeout | undefined;
  const iterator = child.stdout[Symbol.asyncIterator]();
  const exited = new Promise<{ code: number | null }>((resolve) => {
    child.once('close', (code) => {
      if (escalation !== undefined) {
        clearTimeout(escalation);
        signalProcess('SIGKILL');
      }
      resolve({ code });
    });
  });

  const signalProcess = (signal: NodeJS.Signals): void => {
    try {
      if (process.platform !== 'win32' && child.pid !== undefined) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        failure ??= new GitBatchError('FAILED', 'The Git blob reader could not be terminated safely.');
      }
    }
  };
  const stopChild = (): void => {
    signalProcess('SIGTERM');
    if (escalation === undefined) {
      escalation = setTimeout(() => signalProcess('SIGKILL'), Math.max(1, Math.min(1_000, Math.floor(options.timeoutMs / 2))));
      escalation.unref();
    }
  };
  const cancel = (): void => {
    failure ??= new GitBatchError('CANCELLED', 'The remote catalog refresh was cancelled.');
    stopChild();
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  child.on('error', () => {
    failure ??= new GitBatchError('FAILED', 'The Git blob reader could not start.');
  });
  child.stdin.on('error', () => {
    failure ??= new GitBatchError('FAILED', 'The Git blob reader stopped unexpectedly.');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > options.maxStderrBytes) {
      failure ??= new GitBatchError(
        'TOO_LARGE',
        `The Git blob reader exceeded the maxCommandOutputBytes limit (${String(options.maxStderrBytes)}). Adjust the catalog limits or narrow the source.`,
        { dimension: 'maxCommandOutputBytes', limit: options.maxStderrBytes },
      );
      stopChild();
    }
  });
  const checkStaging = async (): Promise<void> => {
    try {
      const exceeded = await options.exceedsStagingLimits?.();
      if (closed) return;
      if (exceeded !== undefined && exceeded !== null) {
        failure ??= new GitBatchError('TOO_LARGE', 'The Git staging directory exceeded its limit.', exceeded);
        stopChild();
      }
    } catch {
      if (closed) return;
      failure ??= new GitBatchError('FAILED', 'The Git staging directory could not be monitored.');
      stopChild();
    }
    if (!closed) monitor = setTimeout(() => void checkStaging(), 250);
  };
  if (options.exceedsStagingLimits !== undefined) monitor = setTimeout(() => void checkStaging(), 250);

  async function pull(): Promise<void> {
    const result = await iterator.next();
    if (result.done) throw failure ?? new GitBatchError('FAILED', 'The Git blob reader ended unexpectedly.');
    const chunk = Buffer.isBuffer(result.value) ? result.value : Buffer.from(result.value);
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
  }

  async function line(): Promise<string> {
    while (true) {
      const end = pending.indexOf(10);
      if (end >= 0) {
        if (end > 1_024) throw new GitBatchError('FAILED', 'The Git blob reader returned an invalid header.');
        const header = pending.subarray(0, end).toString('ascii');
        pending = pending.subarray(end + 1);
        return header;
      }
      if (pending.length > 1_024) throw new GitBatchError('FAILED', 'The Git blob reader returned an invalid header.');
      await pull();
    }
  }

  async function bytes(length: number): Promise<Buffer> {
    const output = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      if (pending.length === 0) await pull();
      const count = Math.min(pending.length, length - offset);
      pending.copy(output, offset, 0, count);
      pending = pending.subarray(count);
      offset += count;
    }
    return output;
  }

  async function timed<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        failure ??= new GitBatchError('TIMEOUT', 'The Git blob reader timed out.');
        stopChild();
        reject(failure);
      }, options.timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    async read(object, maxBytes) {
      if (closed || failure !== undefined || reading || !Number.isSafeInteger(maxBytes) || maxBytes < 0 ||
          !/^[a-f0-9]{40,64}$/.test(object)) {
        throw failure ?? new GitBatchError('FAILED', 'The Git blob request is invalid.');
      }
      reading = true;
      try {
        return await timed((async () => {
          child.stdin.write(`${object}\n`);
          const header = await line();
          const match = /^([a-f0-9]{40,64}) blob ([0-9]+)$/.exec(header);
          if (match === null || match[1] !== object) {
            throw new GitBatchError('FAILED', 'The Git blob reader returned an unexpected object.');
          }
          const size = Number(match[2]);
          if (!Number.isSafeInteger(size) || size > maxBytes) {
            throw new GitBatchError('TOO_LARGE', 'A Git blob exceeds the remaining snapshot budget.', {
              bytes: Number.isSafeInteger(size) ? size : null,
              limit: maxBytes,
            });
          }
          const body = await bytes(size);
          if ((await bytes(1))[0] !== 10) {
            throw new GitBatchError('FAILED', 'The Git blob reader returned an invalid object boundary.');
          }
          if (failure !== undefined) throw failure;
          return body;
        })());
      } catch (error) {
        if (error instanceof GitBatchError) failure ??= error;
        stopChild();
        throw failure ?? error;
      } finally {
        reading = false;
      }
    },
    close(abort = false) {
      if (closing !== undefined) return closing;
      if (reading && !abort) {
        return Promise.reject(new GitBatchError('FAILED', 'The Git blob reader has a request in progress.'));
      }
      closed = true;
      if (monitor !== undefined) clearTimeout(monitor);
      if (abort) {
        stopChild();
        child.stdout.destroy();
      } else {
        child.stdin.end();
      }
      closing = (async () => {
        let closeTimer: NodeJS.Timeout | undefined;
        let reapTimer: NodeJS.Timeout | undefined;
        try {
          closeTimer = setTimeout(() => {
            failure ??= new GitBatchError('TIMEOUT', 'The Git blob reader timed out while closing.');
            stopChild();
          }, options.timeoutMs);
          const notReaped = new Promise<never>((_resolve, reject) => {
            reapTimer = setTimeout(() => reject(new GitBatchError(
              'FAILED',
              'The Git blob reader could not be reaped after termination.',
            )), options.timeoutMs + Math.min(1_000, options.timeoutMs) + 1_000);
          });
          const result = await Promise.race([exited, notReaped]);
          if (!abort && (failure !== undefined || result.code !== 0)) {
            throw failure ?? new GitBatchError('FAILED', 'The Git blob reader failed.');
          }
        } finally {
          options.signal?.removeEventListener('abort', cancel);
          if (closeTimer !== undefined) clearTimeout(closeTimer);
          if (reapTimer !== undefined) clearTimeout(reapTimer);
        }
      })();
      return closing;
    },
  };
}
