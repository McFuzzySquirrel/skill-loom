#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmArguments = process.platform === 'win32'
  ? [process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
  : [];
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
    'package/install/ensure-pty-helper.mjs',
    'package/dist/package.json',
    'package/dist/src/server/cli.js',
    'package/dist/src/server/index.js',
    'package/dist/src/server/windows-control.ps1',
    'package/dist/src/server/chains/scenario-skills/THIRD_PARTY_NOTICES.md',
    'package/dist/src/server/chains/scenario-skill-modes.json',
    'package/dist/src/server/chains/scenario-skills/minimax-xlsx/SKILL.md',
    'package/dist/src/server/chains/scenario-skills/minimax-xlsx/LICENSE',
    'package/dist/web/index.html',
    'package/dist/skills/loom-run-bundle.zip',
    'package/dist/skills/loom-run-bundle/SKILL.md',
    'package/dist/skills/loom-run-bundle/scripts/loom-bundle.mjs',
    'package/dist/skills/scenario-discovery-v1.zip',
    'package/dist/skills/scenario-discovery/VERSION',
    'package/dist/skills/scenario-discovery/LICENSE',
    'package/dist/skills/scenario-discovery/scripts/read-handoff.mjs',
    'package/dist/skills/scenario-discovery/scripts/build-from-handoff.mjs',
    'package/dist/skills/loom-chain-workflow.zip',
    'package/dist/skills/loom-chain-workflow/SKILL.md',
    'package/dist/skills/loom-chain-workflow/LICENSE',
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

async function smokePortableSkill(temporaryRoot) {
  const archive = await readFile(join(repoRoot, 'dist', 'skills', 'loom-run-bundle.zip'));
  const files = unzipSync(archive);
  const helper = files['loom-run-bundle/scripts/loom-bundle.mjs'];
  if (!helper || !files['loom-run-bundle/SKILL.md'] ||
    !files['loom-run-bundle/licenses/zod-LICENSE'] ||
    !files['loom-run-bundle/licenses/yaml-LICENSE']) {
    throw new Error('The portable skill archive is missing its helper, instructions, or dependency licenses.');
  }
  for (const skillDirectory of [
    join(repoRoot, '.github', 'skills', 'loom-run-bundle'),
    join(repoRoot, 'skill', 'loom-run-bundle'),
  ]) {
    const sourceHelper = await readFile(join(skillDirectory, 'scripts', 'loom-bundle.mjs'));
    if (!sourceHelper.equals(helper)) {
      throw new Error(`The repository skill helper is missing or out of sync: ${skillDirectory}`);
    }
  }

  const extracted = join(temporaryRoot, 'standalone-skill');
  await mkdir(join(extracted, 'scripts'), { recursive: true });
  const helperPath = join(extracted, 'scripts', 'loom-bundle.mjs');
  await writeFile(helperPath, helper, { mode: 0o755 });
  const bundlePath = join(temporaryRoot, 'inspection.loom.json');
  await writeFile(bundlePath, JSON.stringify({
    format: 'skill-loom-chain',
    version: 1,
    chain: {
      name: 'Package smoke',
      harness: 'copilot',
      sessionMode: 'shared',
      steps: [{ id: 'step-1', kind: 'instruction', instruction: 'Verify the packaged helper.' }],
      inputs: [],
    },
    skills: [],
  }));
  const inspected = await execFileAsync(
    process.execPath,
    [helperPath, 'inspect', '--bundle', bundlePath],
    { cwd: temporaryRoot, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const result = JSON.parse(inspected.stdout);
  if (result.ok !== true || result.chain.name !== 'Package smoke') {
    throw new Error('The standalone helper could not inspect a bundle outside the repository.');
  }
  if (result.reviewDigest !== null) throw new Error('Project-free inspection must not authorize preparation.');
  const project = join(temporaryRoot, 'portable-project');
  await mkdir(project);
  const invoke = async (command, args, input, expectedError) => {
    const options = command === 'inspect' && input !== undefined ? ['--stdin-json'] : [];
    const child = spawn(process.execPath, [helperPath, command, ...args, ...options], {
      cwd: temporaryRoot, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const closed = once(child, 'close');
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
    const [code] = await closed;
    if (code !== 0) {
      if (expectedError !== undefined && JSON.parse(stderr).error?.code === expectedError) return;
      throw new Error(`Portable ${command} failed: ${stderr}`);
    }
    if (expectedError !== undefined) throw new Error(`Portable ${command} unexpectedly succeeded.`);
    return JSON.parse(stdout);
  };
  const review = await invoke('inspect', ['--bundle', bundlePath, '--project', project]);
  if (!/^[a-f0-9]{64}$/.test(review.reviewDigest)) throw new Error('Portable review digest is missing.');
  const prepareInput = {
    installConfirmed: true,
    reviewDigest: review.reviewDigest,
    actualHost: 'copilot',
    progression: 'supervised',
    sessionDecision: {
      requested: 'shared',
      mechanism: 'current-conversation',
      description: 'Package smoke test in a simulated host.',
      confirmed: true,
    },
    inputs: {},
  };
  const prepareArgs = ['--bundle', bundlePath, '--project', project];
  const prepared = await invoke('prepare', prepareArgs, prepareInput);
  await invoke('prepare', prepareArgs, prepareInput, 'RUN_ACTIVE_CONFLICT');
  const runArgs = ['--project', project, '--run-id', prepared.runId];
  const step = await invoke('step', runArgs, { revision: prepared.revision, confirmed: true });
  if (step.step.instruction !== 'Instruction:\nVerify the packaged helper.') {
    throw new Error('The packaged helper did not return the reviewed instruction.');
  }
  const recorded = await invoke('record', runArgs, {
    revision: step.revision, outcome: 'done', confirmed: true, summary: 'Simulated host outcome.',
  });
  const status = await invoke('status', runArgs);
  if (recorded.status !== 'completed' || status.run.status !== 'completed') {
    throw new Error('The packaged helper did not persist its simulated run outcome.');
  }
  const next = await invoke('prepare', prepareArgs, prepareInput);
  await invoke('record', ['--project', project, '--run-id', next.runId], { revision: next.revision, action: 'abort' });

  const globalSkillPath = join(temporaryRoot, 'global-skills', 'review');
  await mkdir(globalSkillPath, { recursive: true });
  const globalSkillMarkdown = '---\nname: review\ndescription: Check work\n---\nReview the current changes.\n';
  await writeFile(join(globalSkillPath, 'SKILL.md'), globalSkillMarkdown);
  const globalBundlePath = join(temporaryRoot, 'global-skill.loom.json');
  await writeFile(globalBundlePath, JSON.stringify({
    format: 'skill-loom-chain',
    version: 1,
    chain: {
      name: 'Global reuse smoke',
      harness: 'copilot',
      sessionMode: 'shared',
      steps: [{ id: 'global-review', skillName: 'review', instruction: 'Review the current changes.' }],
      inputs: [],
    },
    skills: [{
      name: 'review',
      directory: 'review',
      files: [{
        path: 'SKILL.md',
        content: Buffer.from(globalSkillMarkdown).toString('base64'),
        executable: false,
      }],
    }],
  }));
  const globalSkillPaths = { review: globalSkillPath };
  const globalPrepareArgs = ['--bundle', globalBundlePath, '--project', project];
  const globalReview = await invoke('inspect', globalPrepareArgs, { globalSkillPaths });
  if (globalReview.skills[0]?.globalReuse?.path !== globalSkillPath) {
    throw new Error('The standalone helper did not inspect the host-resolved global package.');
  }
  const globalRun = await invoke('prepare', globalPrepareArgs, {
    ...prepareInput,
    reviewDigest: globalReview.reviewDigest,
    globalSkillPaths,
    reuseSkills: ['review'],
  });
  if (globalRun.installedSkills[0]?.source !== 'global' ||
      globalRun.installedSkills[0]?.path !== globalSkillPath) {
    throw new Error('The standalone helper did not retain the global package reference.');
  }
  try {
    await access(join(project, '.agents', 'skills', 'review'));
    throw new Error('Global reuse unexpectedly copied the skill into the project.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const globalRunArgs = ['--project', project, '--run-id', globalRun.runId];
  const globalStep = await invoke('step', globalRunArgs, { revision: globalRun.revision, confirmed: true });
  if (globalStep.step.skillPath !== globalSkillPath) {
    throw new Error('The standalone helper did not return the selected global skill path.');
  }
  await invoke('record', globalRunArgs, {
    revision: globalStep.revision, outcome: 'done', confirmed: true,
  });
}

async function smokeScenarioDiscoverySkill() {
  const archive = await readFile(join(repoRoot, 'dist', 'skills', 'scenario-discovery-v1.zip'));
  const files = unzipSync(archive);
  const required = [
    'scenario-discovery/VERSION',
    'scenario-discovery/LICENSE',
    'scenario-discovery/SKILL.md',
    'scenario-discovery/scripts/build-bundle.mjs',
    'scenario-discovery/scripts/handoff-validator.mjs',
    'scenario-discovery/scripts/read-handoff.mjs',
    'scenario-discovery/scripts/build-from-handoff.mjs',
  ];
  for (const path of required) {
    if (!files[path]) throw new Error(`The scenario-discovery archive is missing ${path}.`);
  }
  for (const directory of [
    join(repoRoot, '.github', 'skills', 'scenario-discovery'),
    join(repoRoot, 'skill', 'scenario-discovery'),
  ]) {
    for (const path of required.slice(2)) {
      const sourceFile = await readFile(join(directory, path.slice('scenario-discovery/'.length)));
      if (!sourceFile.equals(files[path])) {
        throw new Error(`The scenario-discovery package is missing or out of sync: ${directory}/${path}`);
      }
    }
  }
}

async function smokeChainWorkflowSkill() {
  const archive = await readFile(join(repoRoot, 'dist', 'skills', 'loom-chain-workflow.zip'));
  const files = unzipSync(archive);
  const skill = files['loom-chain-workflow/SKILL.md'];
  const license = files['loom-chain-workflow/LICENSE'];
  if (!skill || !license || Object.keys(files).length !== 2) {
    throw new Error('The loom-chain-workflow archive has unexpected or missing files.');
  }
  for (const directory of [
    join(repoRoot, '.github', 'skills', 'loom-chain-workflow'),
    join(repoRoot, 'skill', 'loom-chain-workflow'),
  ]) {
    if (!(await readFile(join(directory, 'SKILL.md'))).equals(skill)) {
      throw new Error(`The loom-chain-workflow package is missing or out of sync: ${directory}`);
    }
  }
  if (!(await readFile(join(repoRoot, 'LICENSE'))).equals(license)) {
    throw new Error('The loom-chain-workflow archive has an unexpected license.');
  }
}

async function main() {
  await mkdir(join(repoRoot, '.tmp'), { recursive: true });
  const temporaryRoot = await mkdtemp(join(repoRoot, '.tmp', 'package-smoke-'));
  const tarDirectory = join(temporaryRoot, 'tarball');
  const profileParent = process.platform === 'win32'
    ? await mkdtemp(join(tmpdir(), 'loom-package-profile-')) : temporaryRoot;
  const configDirectory = join(profileParent, 'config');
  await mkdir(tarDirectory, { recursive: true });

  let child = null;
  let operationError;

  try {
    const packed = await execFileAsync(
      npmCommand,
      [...npmArguments, 'pack', '--json', '--pack-destination', tarDirectory],
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
    await smokePortableSkill(temporaryRoot);
    await smokeScenarioDiscoverySkill();
    await smokeChainWorkflowSkill();

    const version = await execFileAsync(
      npmCommand,
      [...npmArguments, 'exec', '--yes', `--package=${tarball}`, '--', 'skill-loom', '--version'],
      {
        cwd: repoRoot, maxBuffer: 20 * 1024 * 1024,
        // A fresh tarball path gives npm exec a fresh installation cache. Keep
        // it inside this smoke's cleanup boundary instead of growing ~/.npm.
        env: { ...process.env, CI: '1', npm_config_cache: join(temporaryRoot, 'npm-cache') },
      },
    );
    if (!version.stdout.includes(`Skill Loom ${packageVersion}`)) {
      throw new Error(`Unexpected --version output: ${version.stdout.trim()}`);
    }

    const installedRoot = join(temporaryRoot, 'installed-package');
    await mkdir(installedRoot);
    await writeFile(join(installedRoot, 'package.json'), '{"private":true}\n');
    await execFileAsync(
      npmCommand,
      [...npmArguments, 'install', '--no-audit', '--no-fund', '--no-package-lock', '--no-save', tarball],
      { cwd: installedRoot, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, CI: '1' } },
    );
    const terminalProbe = `
      const { pathToFileURL } = require('node:url');
      (async () => {
        process.stderr.write('Packaged PTY: importing runtime\\n');
        const path = require.resolve('skill-loom-cli/dist/src/server/terminal/pty.js');
        const { createTerminalSession } = await import(pathToFileURL(path).href);
        for (let index = 0; index < 3; index++) {
          process.stderr.write('Packaged PTY: creating session ' + index + '\\n');
          await new Promise((resolve, reject) => {
            const session = createTerminalSession({
              executable: process.execPath,
              args: ['-e', "process.stdin.setRawMode(true);process.stdin.once('data',()=>{process.stdin.pause();process.stdout.write('PACKAGED_PTY_DRAINED\\\\r\\\\n',()=>{process.exitCode=0})});process.stdout.write('PACKAGED_PTY_OK\\\\r\\\\n');"],
            });
            let acknowledged = false;
            const acknowledge = () => {
              if (!acknowledged && session.getBufferedOutput().includes('PACKAGED_PTY_OK')) {
                acknowledged = true;
                session.write('\\r');
              }
            };
            const unsubscribe = session.onData(acknowledge);
            acknowledge();
            const timeout = setTimeout(() => {
              session.kill();
              reject(new Error('Packaged PTY timed out.'));
            }, 10000);
            session.onExit(({ exitCode }) => {
              process.stderr.write('Packaged PTY: exit received ' + index + '\\n');
              clearTimeout(timeout);
              unsubscribe();
              // Must not kill by a recycled PID after natural exit.
              session.kill();
              session.kill();
              if (exitCode !== 0 || !session.getBufferedOutput().includes('PACKAGED_PTY_DRAINED')) {
                reject(new Error('Packaged PTY lost its final output.'));
              } else {
                resolve();
              }
            });
          });
        }
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `;
    const port = await findFreePort();
    const installedCli = join(installedRoot, 'node_modules', packageName, 'dist/src/server/cli.js');
    child = spawn(
      process.execPath,
      [
        installedCli,
        '--no-open',
        '--port',
        String(port),
      ],
      {
        cwd: installedRoot,
        env: {
          ...process.env,
          CI: '1',
          LOOM_CONFIG_DIR: configDirectory,
          LOOM_PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const health = await waitForHealth(port, process.platform === 'win32' ? 60_000 : 15_000);
    if (health.status !== 'ok') {
      throw new Error('Packaged server health response is not ok.');
    }
    const control = await execFileAsync(process.execPath, [
      installedCli, 'service', 'status', '--config-dir', configDirectory,
    ], { cwd: installedRoot, timeout: 30_000 });
    if (JSON.parse(control.stdout).result?.state !== 'running') {
      throw new Error('The installed CLI could not authenticate to the packaged server.');
    }
    // The packaged server exposes only health, lifecycle, draft/chain save,
    // and the authenticated control channel. Project, catalog, and
    // portable-skill HTTP routes were removed with the multi-screen UI, so the
    // smoke test verifies startup, control authentication, and clean stop here;
    // CLI contract coverage lives in the unit and integration suites.
    const stopped = await execFileAsync(process.execPath, [
      installedCli, 'service', 'stop', '--config-dir', configDirectory,
    ], { cwd: installedRoot, timeout: 30_000 });
    if (JSON.parse(stopped.stdout).ok !== true) {
      throw new Error('The installed CLI could not stop the packaged server.');
    }
    if (child.exitCode === null && child.signalCode === null) {
      let timeout;
      try {
        await Promise.race([
          once(child, 'exit'),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Packaged server did not stop.')), 15_000);
          }),
        ]);
      } finally { clearTimeout(timeout); }
    }
    if (child.exitCode !== 0) throw new Error('The packaged server did not stop cleanly.');
    const terminalProbePath = join(installedRoot, 'terminal-probe.cjs');
    await writeFile(terminalProbePath, terminalProbe);
    await execFileAsync(process.execPath, [terminalProbePath], {
      cwd: installedRoot, maxBuffer: 20 * 1024 * 1024, timeout: 15_000,
    });

    console.log(
      `Package smoke passed: ${packageName}@${packageVersion}, ${String(files.length)} files, ${String(files.filter((path) => path.startsWith('package/dist/')).length)} dist files.`,
    );
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (child !== null) {
      try { await stopProcess(child); } catch (error) { cleanupErrors.push(error); }
    }
    if (profileParent !== temporaryRoot) {
      try { await rm(profileParent, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    }
    try { await rm(temporaryRoot, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        operationError === undefined ? cleanupErrors : [operationError, ...cleanupErrors],
        'Package smoke operation or cleanup failed.',
      );
    }
  }
}

main().catch((error) => {
  console.error('Package smoke failed:', error);
  process.exitCode = 1;
});
