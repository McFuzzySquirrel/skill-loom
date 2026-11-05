#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const packageName = JSON.parse(
  await readFile(join(repoRoot, 'package.json'), 'utf8'),
).name;
const packageVersion = JSON.parse(
  await readFile(join(repoRoot, 'package.json'), 'utf8'),
).version;

/** Assert the packed tarball has runtime files and no source/test payload. */
function assertPackageContents(files) {
  const required = [
    'package/package.json',
    'package/dist/package.json',
    'package/dist/src/server/cli.js',
    'package/dist/src/server/index.js',
    'package/dist/src/server/chains/scenario-skills/THIRD_PARTY_NOTICES.md',
    'package/dist/src/server/chains/scenario-skills/minimax-xlsx/SKILL.md',
    'package/dist/src/server/chains/scenario-skills/minimax-xlsx/LICENSE',
    'package/dist/web/index.html',
  ];
  for (const path of required) {
    if (!files.includes(path)) {
      throw new Error(`Packed tarball is missing ${path}.`);
    }
  }

  const forbiddenPrefixes = [
    'package/src/',
    'package/tests/',
    'package/scripts/',
    'package/node_modules/',
  ];
  for (const path of files) {
    if (forbiddenPrefixes.some((prefix) => path.startsWith(prefix))) {
      throw new Error(`Packed tarball unexpectedly includes ${path}.`);
    }
  }
}

async function findFreePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : null;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  if (port === null) {
    throw new Error('Could not allocate a free loopback port.');
  }
  return port;
}

async function waitForHealth(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${String(port)}/api/health`;

  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'ok') {
          return body;
        }
      }
    } catch {
      // The server may not be listening yet.
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the packaged server at ${url}.`);
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 100);
    });
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolveTimeout) => {
      setTimeout(() => resolveTimeout(false), 5_000);
    }),
  ]);
  if (!exited) {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => undefined);
  }
}

async function main() {
  await mkdir(join(repoRoot, '.tmp'), { recursive: true });
  const temporaryRoot = await mkdtemp(join(repoRoot, '.tmp', 'package-smoke-'));
  const tarDirectory = join(temporaryRoot, 'tarball');
  const configDirectory = join(temporaryRoot, 'config');
  await mkdir(tarDirectory, { recursive: true });
  await mkdir(configDirectory, { recursive: true });

  let child = null;

  try {
    const packed = await execFileAsync(
      npmCommand,
      ['pack', '--json', '--pack-destination', tarDirectory],
      { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 },
    );
    // `prepack` runs the build, whose output shares stdout with npm's JSON
    // summary. Parse the trailing JSON array rather than the whole stream.
    let packOutput;
    try {
      packOutput = JSON.parse(packed.stdout.trim());
    } catch {
      const start = packed.stdout.lastIndexOf('\n[');
      if (start < 0) {
        throw new Error('npm pack did not emit a parseable JSON summary.');
      }
      packOutput = JSON.parse(packed.stdout.slice(start + 1));
    }
    const filename = packOutput[0]?.filename;
    if (typeof filename !== 'string' || filename === '') {
      throw new Error('npm pack did not report a tarball filename.');
    }
    const tarball = join(tarDirectory, filename);

    const listed = await execFileAsync('tar', ['-tzf', tarball], {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
    });
    const files = listed.stdout.split(/\r?\n/).filter(Boolean);
    assertPackageContents(files);

    const version = await execFileAsync(
      npxCommand,
      ['--yes', `--package=${tarball}`, 'skill-loom', '--version'],
      { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, CI: '1' } },
    );
    if (!version.stdout.includes(`Skill Loom ${packageVersion}`)) {
      throw new Error(`Unexpected --version output: ${version.stdout.trim()}`);
    }

    const port = await findFreePort();
    child = spawn(
      process.execPath,
      [
        join(repoRoot, 'dist', 'src', 'server', 'cli.js'),
        '--no-open',
        '--port',
        String(port),
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CI: '1',
          LOOM_CONFIG_DIR: configDirectory,
          LOOM_PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const health = await waitForHealth(port);
    if (health.status !== 'ok') {
      throw new Error('Packaged server health response is not ok.');
    }

    const projectPath = join(temporaryRoot, 'scenario-project');
    await mkdir(projectPath, { recursive: true });
    const projectResponse = await fetch(`http://127.0.0.1:${String(port)}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'open', path: projectPath }),
    });
    if (!projectResponse.ok) {
      throw new Error(`Could not register the packaged scenario project: HTTP ${projectResponse.status}.`);
    }
    const projectBody = await projectResponse.json();
    const projectId = projectBody?.project?.id;
    if (typeof projectId !== 'string' || projectId === '') {
      throw new Error('Packaged server returned no project id for the scenario smoke test.');
    }

    const skillResponse = await fetch(
      `http://127.0.0.1:${String(port)}/api/projects/${encodeURIComponent(projectId)}/catalog/scenario-skills/minimax-xlsx/copy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness: 'opencode' }),
      },
    );
    if (skillResponse.status !== 201) {
      throw new Error(`Packaged server could not copy the bundled scenario skill: HTTP ${skillResponse.status}.`);
    }
    const skill = await skillResponse.json();
    const sourceNotice = await readFile(
      join(projectPath, '.opencode', 'skills', 'minimax-xlsx', 'SKILL-LOOM-SOURCE.md'),
      'utf8',
    );
    if (
      skill?.name !== 'minimax-xlsx' ||
      typeof skill.revision !== 'string' ||
      !sourceNotice.includes(skill.revision)
    ) {
      throw new Error('Packaged scenario copy is missing its source attribution.');
    }

    console.log(
      `Package smoke passed: ${packageName}@${packageVersion}, ${String(files.length)} files, ${String(files.filter((path) => path.startsWith('package/dist/')).length)} dist files.`,
    );
  } finally {
    if (child !== null) {
      await stopProcess(child);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Package smoke failed:', error);
  process.exitCode = 1;
});
