import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID, X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { connect as connectTls, createServer as createTlsServer, type ConnectionOptions } from 'node:tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigStore } from '../../src/server/config/store.js';
import { attachControlTerminal, callControl, startControlServer, streamControlEvents } from '../../src/server/control.js';
import { acquireProfileOwner } from '../../src/server/profile-owner.js';
import { createWindowsControlCertificates, readWindowsControlMetadata, verifyWindowsProfile } from '../../src/server/windows-control.js';
import { createRunOwner } from '../../src/server/runs/owner.js';
import { CHAIN_VERSION, parseChain } from '../../src/server/chains/model.js';
import { createRunRecord } from '../../src/server/runs/model.js';
import type { RunOrchestrator } from '../../src/server/runs/orchestrator.js';
import { createTerminalManager } from '../../src/server/terminal/pty.js';

describe.skipIf(process.platform !== 'win32')('Windows private control', () => {
  let temporary: string;
  let profile: string;
  beforeEach(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'loom-windows-control-'));
    profile = join(temporary, 'private profile');
    await verifyWindowsProfile(profile, 'prepare');
  }, 60_000);
  afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

  async function config() {
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: profile } });
    await store.update({});
    return store;
  }
  async function fixture(input: Record<string, unknown>): Promise<unknown> {
    return new Promise((done, reject) => {
      const child = execFile(join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', 'tests/fixtures/windows-control-probe.ps1',
      ], { encoding: 'utf8', windowsHide: true, timeout: 90_000 }, (error, stdout) => {
        if (error !== null) reject(error);
        else {
          try { done(JSON.parse(stdout) as unknown); } catch (parseError) { reject(parseError); }
        }
      });
      child.stdin?.end(JSON.stringify(input));
    });
  }
  async function metadata() {
    return JSON.parse(await readFile(join(profile, 'control.json'), 'utf8')) as {
      token: string; socket: string; applicationVersion: string;
      tls: { serverCertificate: string; clientCertificate: string; clientPfx: string };
    };
  }
  async function tlsOptions(): Promise<ConnectionOptions> {
    const current = await metadata();
    return {
      host: '127.0.0.1', port: Number(current.socket.split(':').at(-1)), servername: 'localhost',
      minVersion: 'TLSv1.3', ALPNProtocols: ['loom-control-v1'],
      ca: new X509Certificate(Buffer.from(current.tls.serverCertificate, 'base64')).toString(),
      pfx: Buffer.from(current.tls.clientPfx, 'base64'), passphrase: '',
    };
  }

  it('creates a protected profile, authenticates both peers, and checks protocol tokens', async () => {
    const owner = await acquireProfileOwner(profile);
    const service = await startControlServer(await config());
    try {
      expect(await callControl(profile, 'status', {})).toMatchObject({ ok: true, result: { state: 'running' } });
      await expect(acquireProfileOwner(profile)).rejects.toMatchObject({ code: 'PROFILE_IN_USE' });
      await expect(startControlServer(await config())).rejects.toMatchObject({ code: 'CONTROL_ENDPOINT_IN_USE' });
      const current = await metadata();
      expect(current.socket).toMatch(/^tls:\/\/127\.0\.0\.1:\d+$/);
      expect(JSON.parse((await readWindowsControlMetadata(profile))!)).toEqual(current);
      const socket = connectTls(await tlsOptions());
      try {
        await once(socket, 'secureConnect');
        expect(socket.authorized).toBe(true);
        expect(socket.getPeerCertificate().raw).toEqual(Buffer.from(current.tls.serverCertificate, 'base64'));
        const reply = once(socket, 'data');
        socket.write(`${JSON.stringify({ version: 1, token: 'A'.repeat(43), operation: 'status', input: {} })}\n`);
        expect(JSON.parse((await reply)[0].toString())).toMatchObject({ ok: false, error: { code: 'CONTROL_AUTH_FAILED' } });
      } finally { socket.destroy(); }
    } finally { await service.close(); owner.release(); }
    await expect(access(join(profile, 'control.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 90_000);

  it('denies absent and untrusted client certificates without returning application bytes', async () => {
    const service = await startControlServer(await config());
    try {
      const original = await tlsOptions();
      const other = await createWindowsControlCertificates();
      for (const pfx of [undefined, Buffer.from(other.client.pfx, 'base64')]) {
        const options = { ...original };
        if (pfx === undefined) delete options.pfx;
        else options.pfx = pfx;
        const socket = connectTls(options);
        let received = '';
        socket.on('data', (chunk: Buffer) => { received += chunk.toString(); });
        const error = new Promise<Error>((done) => socket.once('error', done));
        const timeout = setTimeout(() => socket.destroy(new Error('Authentication did not finish.')), 8_000);
        try {
          expect((await error).message).not.toBe('Authentication did not finish.');
          expect(received).toBe('');
        } finally { clearTimeout(timeout); socket.destroy(); }
      }
    } finally { await service.close(); }
  }, 90_000);

  it('never sends the token to a port impersonator', async () => {
    const store = await config();
    const service = await startControlServer(store);
    const current = await metadata();
    await service.close();
    const other = await createWindowsControlCertificates();
    let received = '';
    const impostor = createTlsServer({
      pfx: Buffer.from(other.server.pfx, 'base64'), passphrase: '', minVersion: 'TLSv1.3',
      ALPNProtocols: ['loom-control-v1'],
    }, (socket) => {
      socket.on('data', (chunk: Buffer) => { received += chunk.toString(); });
    });
    await new Promise<void>((ready, reject) => {
      impostor.once('error', reject);
      impostor.listen(0, '127.0.0.1', ready);
    });
    try {
      const address = impostor.address();
      if (address === null || typeof address === 'string') throw new Error('No impostor address.');
      await writeFile(join(profile, 'control.json'), JSON.stringify({ ...current, socket: `tls://127.0.0.1:${address.port}` }));
      await expect(callControl(profile, 'status', {})).rejects.toMatchObject({ code: 'CONTROL_UNAVAILABLE' });
      await expect(startControlServer(store)).rejects.toMatchObject({ code: 'CONTROL_UNSAFE' });
      expect(received).toBe('');
    } finally { await new Promise<void>((done) => impostor.close(() => done())); }
  }, 90_000);

  it('recovers stale metadata after a real owner crash without stealing a live owner', async () => {
    const script = `
      import { acquireProfileOwner } from './src/server/profile-owner.ts';
      import { createConfigStore } from './src/server/config/store.ts';
      import { startControlServer } from './src/server/control.ts';
      const owner = await acquireProfileOwner(process.argv[1]);
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: process.argv[1] } });
      await store.update({});
      const service = await startControlServer(store);
      process.once('SIGTERM', () => { void service.close().then(() => owner.release()); });
      process.stdout.write('ready\\n');
    `;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, profile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let startupError = '';
    child.stderr.on('data', (chunk: Buffer) => { startupError += chunk.toString(); });
    try {
      await new Promise<void>((ready, reject) => {
        child.once('error', reject);
        child.once('exit', () => reject(new Error(`Owner exited before startup: ${startupError}`)));
        child.stdout.once('data', () => ready());
      });
      await expect(acquireProfileOwner(profile)).rejects.toMatchObject({ code: 'PROFILE_IN_USE' });
      const old = await metadata();
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      const owner = await acquireProfileOwner(profile);
      try {
        const restarted = await startControlServer(await config());
        try {
          expect((await metadata()).token).not.toBe(old.token);
          expect(await callControl(profile, 'status', {})).toMatchObject({ ok: true });
        } finally { await restarted.close(); }
      } finally { owner.release(); }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
  }, 90_000);

  it('rejects unsafe profiles and linked metadata without changing existing contents', async () => {
    const unsafe = join(temporary, 'inherited-profile');
    await mkdir(unsafe);
    await expect(verifyWindowsProfile(unsafe, 'prepare')).rejects.toMatchObject({ code: 'WINDOWS_PROFILE_UNSAFE' });
    const store = await config();
    const elsewhere = join(profile, 'elsewhere.json');
    await writeFile(elsewhere, '{}');
    await symlink(elsewhere, join(profile, 'control.json'));
    await expect(startControlServer(store)).rejects.toMatchObject({ code: 'CONTROL_UNSAFE' });
    expect(await readFile(elsewhere, 'utf8')).toBe('{}');
    const alias = join(temporary, 'junction');
    await symlink(profile, alias, 'junction');
    await expect(verifyWindowsProfile(alias)).rejects.toMatchObject({ code: 'WINDOWS_PROFILE_UNSAFE' });
  }, 90_000);

  it('rejects explicitly broad file ACLs even inside a protected private directory', async () => {
    const store = await config();
    const service = await startControlServer(store);
    const original = await readFile(join(profile, 'control.json'), 'utf8');
    await service.close();
    await writeFile(join(profile, 'control.json'), original);
    await fixture({ operation: 'widen-file', path: join(profile, 'control.json') });
    await expect(callControl(profile, 'status', {})).rejects.toMatchObject({ code: 'WINDOWS_PROFILE_UNSAFE' });
    await expect(startControlServer(store)).rejects.toMatchObject({ code: 'WINDOWS_PROFILE_UNSAFE' });
    expect(await readFile(join(profile, 'control.json'), 'utf8')).toBe(original);
    const owner = await acquireProfileOwner(profile);
    owner.release();
    await fixture({ operation: 'widen-file', path: join(profile, 'profile-owner.sqlite') });
    await expect(acquireProfileOwner(profile)).rejects.toMatchObject({
      code: 'PROFILE_LOCK_FAILED', cause: { code: 'WINDOWS_PROFILE_UNSAFE' },
    });
  }, 90_000);

  it.skipIf(process.env.LOOM_TEST_WINDOWS_CROSS_USER !== '1')('denies a real second local user access to metadata and authenticated IPC', async () => {
    const parent = join(process.env.PUBLIC!, `loom-ipc-${randomUUID()}`);
    await fixture({ operation: 'public-parent', path: parent });
    const privateProfile = join(parent, 'profile');
    let service: Awaited<ReturnType<typeof startControlServer>> | undefined;
    try {
      await verifyWindowsProfile(privateProfile, 'prepare');
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: privateProfile } });
      await store.update({});
      service = await startControlServer(store);
      const current = JSON.parse(await readFile(join(privateProfile, 'control.json'), 'utf8')) as {
        socket: string; tls: { serverCertificate: string };
      };
      const probe = join(parent, 'foreign-probe.cjs');
      await writeFile(join(parent, 'public-marker'), 'visible');
      // Only public endpoint information is shared with the foreign account.
      await writeFile(probe, `
        const fs = require('node:fs');
        const tls = require('node:tls');
        const crypto = require('node:crypto');
        const result = { parentReadable: fs.readFileSync(${JSON.stringify(join(parent, 'public-marker'))}, 'utf8') === 'visible' };
        try { fs.readFileSync(${JSON.stringify(join(privateProfile, 'control.json'))}); result.metadataDenied = false; }
        catch (error) { result.metadataDenied = error.code === 'EACCES' || error.code === 'EPERM'; }
        try { fs.writeFileSync(${JSON.stringify(join(privateProfile, 'injected'))}, 'bad', { flag: 'wx' }); result.writeDenied = false; }
        catch (error) { result.writeDenied = error.code === 'EACCES' || error.code === 'EPERM'; }
        const socket = tls.connect({
          host: '127.0.0.1', port: ${Number(current.socket.split(':').at(-1))}, servername: 'localhost',
          minVersion: 'TLSv1.3', ALPNProtocols: ['loom-control-v1'],
          ca: new crypto.X509Certificate(Buffer.from(${JSON.stringify(current.tls.serverCertificate)}, 'base64')).toString(),
        });
        let received = false;
        const timeout = setTimeout(() => { socket.destroy(); process.exitCode = 1; }, 8000);
        socket.on('data', () => { received = true; });
        socket.once('error', () => { clearTimeout(timeout); result.ipcDenied = !received; process.stdout.write(JSON.stringify(result)); });
      `);
      expect(await fixture({ operation: 'cross-user', node: process.execPath, probe })).toEqual({
        parentReadable: true, metadataDenied: true, writeDenied: true, ipcDenied: true,
      });
    } finally {
      await service?.close();
      await rm(parent, { recursive: true, force: true });
    }
  }, 120_000);

  it('preserves bounded event and interactive terminal protocols over TLS', async () => {
    const store = await config();
    const manager = createTerminalManager();
    const session = manager.createSession({
      executable: process.execPath,
      args: ['-e', "process.stdin.setRawMode(true);process.stdin.on('data',data=>process.stdout.write('ECHO:'+data));setInterval(()=>{},1000);"],
    }, { id: 'loom_run_tls' });
    const view = { run: { id: 'run-tls' }, terminalId: session.id, actions: [] };
    const now = new Date().toISOString();
    const chain = parseChain({
      version: CHAIN_VERSION, id: 'chain-tls', name: 'TLS', harness: 'copilot', sessionMode: 'shared',
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review.' }], inputs: [],
      automaticPermissionOptIn: false, createdAt: now, updatedAt: now,
    });
    const run = createRunRecord({ id: 'run-tls', projectId: 'project-tls', chain, mode: 'supervised' });
    const unsubscribe = vi.fn();
    const orchestrator: RunOrchestrator = {
      createRun: vi.fn(), getRun: vi.fn(), getRunView: vi.fn().mockResolvedValue(view),
      getActiveRun: vi.fn(), hasLiveProject: vi.fn().mockReturnValue(false),
      applyAction: vi.fn(), recoverOnStartup: vi.fn(), shutdown: vi.fn(),
      subscribe: async (runId, listener) => {
        listener({
          type: 'snapshot', runId, sequence: 0, run, terminalId: session.id, recovery: null,
          actions: {
            next: false, retry: false, skip: false, abort: true, pause: false, resume: false,
            runNext: false, done: true, failed: true, continue: false, restart: false,
          },
        });
        return unsubscribe;
      },
    };
    const owner = createRunOwner({
      configStore: store, terminalManager: manager, runOrchestrator: orchestrator, runRecoverOnStartup: false,
    });
    const service = await startControlServer(store, { runOwner: owner, terminalManager: manager });
    const input = new PassThrough();
    const setRawMode = vi.fn();
    Object.assign(input, { isTTY: true, setRawMode });
    let output = '';
    try {
      const snapshots: unknown[] = [];
      const abort = new AbortController();
      await streamControlEvents(profile, 'run-tls', (event) => { snapshots.push(event); abort.abort(); return true; }, abort.signal);
      expect(snapshots).toMatchObject([{ ok: true, event: { type: 'snapshot', runId: 'run-tls', terminalId: session.id } }]);
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
      const attached = attachControlTerminal(profile, 'run-tls', input, {
        isTTY: true, columns: 120, rows: 32, write: (chunk) => { output += String(chunk); return true; },
      });
      await vi.waitFor(() => expect(setRawMode).toHaveBeenCalledWith(true), { timeout: 15_000 });
      input.write('hello');
      await vi.waitFor(() => expect(output).toContain('ECHO:hello'), { timeout: 10_000 });
      input.write('\x1d');
      await attached;
      expect(setRawMode).toHaveBeenLastCalledWith(false);
      expect(session.isRunning()).toBe(true);
    } finally {
      input.destroy();
      await service.close();
      await owner.shutdown();
      await manager.shutdown();
    }
  }, 90_000);

  it('closes stalled unauthenticated connections before shutdown completes', async () => {
    const service = await startControlServer(await config());
    const current = await metadata();
    const { createConnection } = await import('node:net');
    const socket = createConnection({ host: '127.0.0.1', port: Number(current.socket.split(':').at(-1)) });
    await once(socket, 'connect');
    try {
      await service.close();
      await expect(service.close()).resolves.toBeUndefined();
    } finally { socket.destroy(); }
  }, 90_000);
});
