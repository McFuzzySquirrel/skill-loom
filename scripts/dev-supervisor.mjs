import { fork, spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.cwd();
const backendEntry = resolve(root, 'src/server/index.ts');
const viteEntry = resolve(root, 'node_modules/vite/bin/vite.js');
const backendWatchRoot = resolve(root, 'src/server');
const watchers = new Set();
const expectedExits = new WeakSet();
let backend = null;
let vite = null;
let stopping = false;
let restartTimer = null;
let restartChain = Promise.resolve();
let shutdownPromise = null;

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child) {
  if (exited(child)) return Promise.resolve();
  return new Promise((resolveExit) => {
    child.once('exit', resolveExit);
  });
}

async function stopChild(child) {
  if (child === null || exited(child)) return;
  const finished = waitForExit(child);
  child.kill('SIGTERM');
  const graceful = setTimeout(() => {
    if (!exited(child)) child.kill('SIGKILL');
  }, 4000);
  graceful.unref();
  await finished;
  clearTimeout(graceful);
}

function reportChildError(name, error) {
  console.error(`Skill Loom ${name} process failed.`, error);
}

function startBackend() {
  if (stopping) return;
  const child = fork(backendEntry, [], {
    cwd: root,
    env: { ...process.env, LOOM_DEV_SUPERVISOR: '1' },
    execArgv: ['--import', 'tsx/esm'],
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  backend = child;
  child.on('message', (message) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'loom:server-stopped' &&
      message.intent === 'stop'
    ) {
      void shutdown('server requested shutdown');
    }
  });
  child.on('error', (error) => reportChildError('backend', error));
  child.on('exit', (code, signal) => {
    if (backend === child) backend = null;
    if (!stopping && !expectedExits.has(child)) {
      console.error(
        `Skill Loom backend exited unexpectedly (${signal ?? code ?? 'unknown'}).`,
      );
      void shutdown('backend exited unexpectedly', 1);
    }
  });
}

function startVite() {
  if (stopping) return;
  const child = spawn(
    process.execPath,
    [viteEntry, '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    { cwd: root, stdio: 'inherit' },
  );
  vite = child;
  child.on('error', (error) => reportChildError('Vite', error));
  child.on('exit', (code, signal) => {
    if (vite === child) vite = null;
    if (!stopping) {
      console.error(`Skill Loom Vite exited (${signal ?? code ?? 'unknown'}).`);
      void shutdown('Vite exited', 1);
    }
  });
}

async function restartBackend() {
  restartChain = restartChain.then(async () => {
    if (stopping) return;
    const previous = backend;
    if (previous !== null) {
      expectedExits.add(previous);
      if (previous.connected) {
        await new Promise((resolveMessage, rejectMessage) => {
          const handleMessage = (message) => {
            if (
              typeof message === 'object' &&
              message !== null &&
              'type' in message &&
              message.type === 'loom:restart-ready'
            ) {
              previous.removeListener('message', handleMessage);
              previous.removeListener('exit', handleExit);
              resolveMessage();
            }
          };
          const handleExit = () => {
            previous.removeListener('message', handleMessage);
            rejectMessage(new Error('Backend exited before acknowledging its restart.'));
          };
          previous.on('message', handleMessage);
          previous.once('exit', handleExit);
          previous.send({ type: 'loom:prepare-restart' }, (error) => {
            if (error !== null) {
              previous.removeListener('message', handleMessage);
              previous.removeListener('exit', handleExit);
              rejectMessage(error);
            }
          });
        });
      }
      await stopChild(previous);
      if (backend === previous) backend = null;
    }
    if (!stopping) startBackend();
  });
  await restartChain;
}

function scheduleBackendRestart() {
  if (stopping) return;
  if (restartTimer !== null) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void restartBackend().catch((error) => {
      reportChildError('backend restart', error);
      void shutdown('backend restart failed', 1);
    });
  }, 150);
}

async function watchDirectories(directory) {
  const watcher = watch(directory, { persistent: true }, (_event, filename) => {
    if (filename !== null && String(filename).startsWith('.')) return;
    if (filename !== null) {
      void stat(join(directory, String(filename)))
        .then((entry) => {
          if (entry.isDirectory()) return watchDirectories(join(directory, String(filename)));
          return undefined;
        })
        .catch(() => undefined);
    }
    scheduleBackendRestart();
  });
  watchers.add(watcher);
  watcher.on('error', (error) => reportChildError('server file watcher', error));

  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => watchDirectories(join(directory, entry.name))),
  );
}

function shutdown(reason, exitCode = 0) {
  if (shutdownPromise !== null) return shutdownPromise;
  stopping = true;
  process.exitCode = exitCode;
  console.log(`Stopping Skill Loom development services (${reason}).`);
  if (restartTimer !== null) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  for (const watcher of watchers) watcher.close();
  watchers.clear();

  shutdownPromise = (async () => {
    const ownedBackend = backend;
    const ownedVite = vite;
    if (ownedBackend !== null) expectedExits.add(ownedBackend);
    await Promise.all([stopChild(ownedBackend), stopChild(ownedVite)]);
  })();
  return shutdownPromise;
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').then(() => {
    process.exitCode = 0;
  });
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => {
    process.exitCode = 0;
  });
});

try {
  await watchDirectories(backendWatchRoot);
  startBackend();
  startVite();
  console.log('Skill Loom development services starting on 127.0.0.1:5173.');
} catch (error) {
  reportChildError('development supervisor', error);
  await shutdown('startup failed');
  process.exitCode = 1;
}
