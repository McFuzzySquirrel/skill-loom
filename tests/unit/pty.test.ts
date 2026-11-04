import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_TAIL_BYTES,
  DEFAULT_MAX_TAIL_LINES,
  TerminalInvalidSpecError,
  TerminalOutputBuffer,
  createTerminalSession,
  trimTerminalOutput,
  type TerminalExit,
  type TerminalSession,
} from '../../src/server/terminal/pty.js';

const sessions: TerminalSession[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.kill();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function start(
  script: string,
  options: { cols?: number; rows?: number; cwd?: string } = {},
): TerminalSession {
  const session = createTerminalSession({
    executable: process.execPath,
    args: ['-e', script],
    ...options,
  });
  sessions.push(session);
  return session;
}

function outputOf(session: TerminalSession): {
  text: () => string;
  stop: () => void;
} {
  const chunks: string[] = [];
  const stop = session.onData((chunk) => {
    chunks.push(chunk);
  });
  return { text: () => chunks.join(''), stop };
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(message);
}

const ECHO_SCRIPT = `
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf('\\n');
      if (index === -1) break;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      process.stdout.write('ECHO:' + line + '\\r\\n');
    }
  });
  process.stdout.write('READY\\r\\n');
`;

const RESIZE_SCRIPT = `
  process.stdout.write('INIT:' + process.stdout.columns + 'x' + process.stdout.rows + '\\r\\n');
  process.on('SIGWINCH', () => {
    process.stdout.write('SIZE:' + process.stdout.columns + 'x' + process.stdout.rows + '\\r\\n');
  });
  setInterval(() => {}, 1000);
`;

const LONG_OUTPUT_SCRIPT = `
  let index = 0;
  function writeNext() {
    if (index >= 600) {
      process.stdout.write('DONE\\r\\n', () => process.exit(0));
      return;
    }
    const line = String(index).padStart(4, '0') + ':' + 'x'.repeat(240);
    index += 1;
    process.stdout.write(line + '\\r\\n');
    if (index % 50 === 0) {
      setImmediate(writeNext);
    } else {
      writeNext();
    }
  }
  writeNext();
`;

describe('PTY session transport', () => {
  it('spawns a node process with an executable and args and observes stdout', async () => {
    const session = start("process.stdout.write('hello from pty\\r\\n'); setInterval(()=>{}, 1000);");
    const output = outputOf(session);

    await waitFor(() => output.text().includes('hello from pty'), 'PTY stdout was not observed.');

    expect(session.isRunning()).toBe(true);
    expect(session.pid).toBeGreaterThan(0);
    expect(session.getBufferedOutput()).toContain('hello from pty');
    output.stop();
  });

  it('writes client input through to the child process', async () => {
    const session = start(ECHO_SCRIPT);
    const output = outputOf(session);

    await waitFor(() => output.text().includes('READY'), 'Child did not signal readiness.');

    session.write('hello loom\n');

    await waitFor(() => output.text().includes('ECHO:hello loom'), 'Child did not receive input.');
    output.stop();
  });

  it('resizes the PTY and reports the new geometry', async () => {
    const session = start(RESIZE_SCRIPT, { cols: 100, rows: 30 });
    const output = outputOf(session);

    await waitFor(() => output.text().includes('INIT:100x30'), 'Child did not report initial size.');

    session.resize(132, 41);

    await waitFor(() => output.text().includes('SIZE:132x41'), 'Child did not observe the resize.');
    expect(session.cols).toBe(132);
    expect(session.rows).toBe(41);
    output.stop();
  });

  it('caps the retained per-session output tail', async () => {
    const session = start(LONG_OUTPUT_SCRIPT);
    const output = outputOf(session);

    await waitFor(() => output.text().includes('DONE'), 'Child did not finish streaming output.', 10_000);

    const tail = session.getBufferedOutput();
    expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(DEFAULT_MAX_TAIL_BYTES);
    expect(tail.split('\n').length).toBeLessThanOrEqual(DEFAULT_MAX_TAIL_LINES);
    expect(tail).not.toContain('0000:');
    output.stop();
  });

  it('kills the child on request and records its exit', async () => {
    const session = start("process.stdout.write('READY\\r\\n'); setInterval(()=>{}, 1000);");
    const output = outputOf(session);
    await waitFor(() => output.text().includes('READY'), 'Child did not start.');

    const exit = new Promise<{ exitCode: number; signal?: number }>((resolveExit) => {
      session.onExit(resolveExit);
    });

    session.kill('SIGTERM');

    const event = await exit;
    expect(event.exitCode).toBeGreaterThanOrEqual(0);
    expect(session.isRunning()).toBe(false);
    expect(session.getExit()).not.toBeNull();
    output.stop();
  });

  it('rejects invalid geometry and working directories', async () => {
    expect(() =>
      createTerminalSession({
        executable: process.execPath,
        args: ['-e', ''],
        cols: 0,
      }),
    ).toThrow(TerminalInvalidSpecError);

    expect(() =>
      createTerminalSession({
        executable: process.execPath,
        args: ['-e', ''],
        cwd: join(tmpdir(), 'loom-missing-cwd-for-pty-test'),
      }),
    ).toThrow(TerminalInvalidSpecError);

    const directory = await mkdtemp(join(tmpdir(), 'loom-pty-cwd-'));
    temporaryDirectories.push(directory);

    const session = createTerminalSession({
      executable: 'loom-definitely-not-an-installed-command',
      args: [],
      cwd: directory,
    });
    sessions.push(session);

    const exit = await new Promise<TerminalExit>((resolveExit) => {
      if (!session.isRunning() && session.getExit() !== null) {
        resolveExit(session.getExit()!);
        return;
      }
      session.onExit(resolveExit);
    });
    expect(exit.exitCode).not.toBe(0);
  });
});

describe('terminal output tail', () => {
  it('keeps the newest lines and bytes', () => {
    const manyLines = Array.from({ length: 300 }, (_, index) => `line-${index}`).join('\n');

    const trimmedLines = trimTerminalOutput(manyLines, 200, DEFAULT_MAX_TAIL_BYTES);
    expect(trimmedLines.split('\n')).toHaveLength(200);
    expect(trimmedLines).not.toContain('line-0\n');
    expect(trimmedLines).toContain('line-299');

    const wide = 'x'.repeat(100_000);
    const trimmedBytes = trimTerminalOutput(wide, 200, DEFAULT_MAX_TAIL_BYTES);
    expect(Buffer.byteLength(trimmedBytes, 'utf8')).toBeLessThanOrEqual(DEFAULT_MAX_TAIL_BYTES);
  });

  it('caps output at append time', () => {
    const buffer = new TerminalOutputBuffer(3, 20);
    buffer.append('alpha\nbeta\n');
    buffer.append('gamma\ndelta\n');

    expect(buffer.toString().split('\n').length).toBeLessThanOrEqual(3);
    expect(buffer.byteLength).toBeLessThanOrEqual(20);
    expect(buffer.toString()).toContain('delta');
  });
});
