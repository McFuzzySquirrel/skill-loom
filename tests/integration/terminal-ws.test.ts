import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createConfigStore } from '../../src/server/config/store.js';
import {
  createTerminalManager,
  type TerminalExit,
  type TerminalManager,
  type TerminalSession,
} from '../../src/server/terminal/pty.js';
import type {
  TerminalClientMessage,
  TerminalErrorCode,
  TerminalServerMessage,
} from '../../src/shared/terminal.js';

interface SocketMessageEvent {
  data: unknown;
}

interface TestSocket {
  readonly readyState: number;
  addEventListener(type: 'message', listener: (event: SocketMessageEvent) => void): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

type SocketConstructor = new (url: string) => TestSocket;

const WebSocketClient = (
  globalThis as unknown as { WebSocket?: SocketConstructor }
).WebSocket;

const CHILD_SCRIPT = `
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
      if (line === 'size?') {
        process.stdout.write('SIZE:' + process.stdout.columns + 'x' + process.stdout.rows + '\\r\\n');
      } else {
        process.stdout.write('ECHO:' + line + '\\r\\n');
      }
    }
  });
  process.stdout.write('READY\\r\\n');
  setInterval(() => {}, 1000);
`;

interface Harness {
  app: FastifyInstance;
  manager: TerminalManager;
  session: TerminalSession;
  baseUrl: string;
  sockets: TestSocket[];
}

let root: string;
let harness: Harness | null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-terminal-ws-'));
  harness = null;
});

afterEach(async () => {
  if (harness !== null) {
    for (const socket of harness.sockets.splice(0)) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
    await harness.app.close();
  }
  await rm(root, { recursive: true, force: true });
});

async function startHarness(): Promise<Harness> {
  if (WebSocketClient === undefined) {
    throw new Error('This Node runtime does not provide a WebSocket client.');
  }

  const manager = createTerminalManager();
  const app = await buildApp({
    env: {},
    serveStatic: false,
    configStore: createConfigStore({
      env: { LOOM_CONFIG_DIR: join(root, 'config') },
      homeDirectory: () => join(root, 'home'),
    }),
    terminalManager: manager,
  });
  harness = { app, manager, session: undefined as unknown as TerminalSession, baseUrl: '', sockets: [] };

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a loopback TCP address.');
  }
  const { port } = address as AddressInfo;
  harness.baseUrl = `ws://127.0.0.1:${port}`;

  harness.session = manager.createSession({
    executable: process.execPath,
    args: ['-e', CHILD_SCRIPT],
    cwd: root,
    cols: 100,
    rows: 30,
  });

  return harness;
}

function connect(target: Harness): TestSocket {
  if (WebSocketClient === undefined) {
    throw new Error('No WebSocket client.');
  }
  const socket = new WebSocketClient(`${target.baseUrl}/api/terminal/${target.session.id}`);
  target.sockets.push(socket);
  return socket;
}

function collect(socket: TestSocket): {
  messages: TerminalServerMessage[];
  output: () => string;
} {
  const messages: TerminalServerMessage[] = [];
  socket.addEventListener('message', (event) => {
    messages.push(JSON.parse(String(event.data)) as TerminalServerMessage);
  });
  return {
    messages,
    output: () =>
      messages
        .map((message) => (message.type === 'output' ? message.data : ''))
        .join(''),
  };
}

function send(socket: TestSocket, message: TerminalClientMessage): void {
  socket.send(JSON.stringify(message));
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 8_000,
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

describe('terminal WebSocket transport through the composition root', () => {
  it('streams output and accepts input and resize messages', async () => {
    const target = await startHarness();
    const socket = connect(target);
    const received = collect(socket);

    await waitFor(
      () => received.messages.some((message) => message.type === 'ready'),
      'The registered WebSocket route did not send a ready message.',
    );

    const ready = received.messages.find((message) => message.type === 'ready');
    expect(ready).toMatchObject({
      type: 'ready',
      sessionId: target.session.id,
      pid: target.session.pid,
      cols: 100,
      rows: 30,
    });
    await waitFor(
      () => received.output().includes('READY'),
      'The PTY output did not reach the WebSocket subscriber.',
    );

    send(socket, { type: 'input', data: 'hello loom\n' });
    await waitFor(
      () => received.output().includes('ECHO:hello loom'),
      'Client input did not reach the PTY.',
    );

    send(socket, { type: 'resize', cols: 132, rows: 41 });
    await waitFor(
      () => target.session.cols === 132 && target.session.rows === 41,
      'Resize did not reach the PTY.',
    );
    send(socket, { type: 'input', data: 'size?\n' });
    await waitFor(
      () => received.output().includes('SIZE:132x41'),
      'The child did not observe the resized geometry.',
    );
    expect(target.session.cols).toBe(132);
    expect(target.session.rows).toBe(41);
  });

  it('rejects a second subscriber without disturbing the active one', async () => {
    const target = await startHarness();
    const first = connect(target);
    const firstMessages = collect(first);

    await waitFor(
      () => firstMessages.messages.some((message) => message.type === 'ready'),
      'The first subscriber did not become ready.',
    );

    const second = connect(target);
    const secondMessages = collect(second);

    await waitFor(
      () => secondMessages.messages.some((message) => message.type === 'error'),
      'The second subscriber was not rejected.',
    );

    const error = secondMessages.messages.find((message) => message.type === 'error');
    expect(error).toMatchObject({
      type: 'error',
      code: 'TERMINAL_SUBSCRIBER_CONFLICT' satisfies TerminalErrorCode,
    });
    expect(first.readyState).toBe(1);

    send(first, { type: 'input', data: 'still active\n' });
    await waitFor(
      () => firstMessages.output().includes('ECHO:still active'),
      'Rejecting the second subscriber disturbed the first.',
    );
  });

  it('terminates the child process and forgets the session when the socket closes', async () => {
    const target = await startHarness();
    const socket = connect(target);
    const received = collect(socket);

    await waitFor(
      () => received.messages.some((message) => message.type === 'ready'),
      'The subscriber did not become ready.',
    );

    const pid = target.session.pid;
    const exit = new Promise<TerminalExit>((resolveExit) => {
      target.session.onExit(resolveExit);
    });

    socket.close();

    const event = await exit;
    expect(Number.isInteger(event.exitCode)).toBe(true);
    expect(target.session.isRunning()).toBe(false);
    await waitFor(
      () => !target.manager.hasSession(target.session.id),
      'The manager did not release the terminal session after socket close.',
    );

    expect(() => process.kill(pid, 0)).toThrow(
      expect.objectContaining({ code: 'ESRCH' }),
    );
  });

  it('terminates live sessions when the composition root closes', async () => {
    const target = await startHarness();
    const exit = new Promise<TerminalExit>((resolveExit) => {
      target.session.onExit(resolveExit);
    });

    await target.app.close();
    harness = null;

    const event = await exit;
    expect(Number.isInteger(event.exitCode)).toBe(true);
    expect(target.session.isRunning()).toBe(false);
    expect(target.manager.hasSession(target.session.id)).toBe(false);
  });

  it('returns a typed error for an unknown session id', async () => {
    const target = await startHarness();
    if (WebSocketClient === undefined) {
      throw new Error('No WebSocket client.');
    }
    const socket = new WebSocketClient(`${target.baseUrl}/api/terminal/term_missing`);
    target.sockets.push(socket);
    const received = collect(socket);

    await waitFor(
      () => received.messages.some((message) => message.type === 'error'),
      'Unknown terminal session was not rejected.',
    );

    expect(received.messages.find((message) => message.type === 'error')).toMatchObject({
      type: 'error',
      code: 'TERMINAL_NOT_FOUND',
    });
  });
});
