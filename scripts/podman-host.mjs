#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_IMAGE = 'localhost/skill-loom';
const POD_NAME = 'skill-loom';
const APP_CONTAINER = 'skill-loom-app';
const PROXY_CONTAINER = 'skill-loom-proxy';
const CONFIG_VOLUME = 'skill-loom-config';
const APP_UNIT = 'skill-loom-app.container';
const UNIT_FILES = [
  'skill-loom-config.volume',
  'skill-loom.pod',
  APP_UNIT,
  'skill-loom-proxy.container',
];
const MANAGED_MARKER = '# Managed by Skill Loom; regenerate with scripts/podman-host.mjs.';
const CADDY_IMAGE = 'docker.io/library/caddy:2-alpine';

export class PodmanHostError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PodmanHostError';
    this.code = code;
  }
}

export function createQuadletFiles(options = {}) {
  const skillsDirectory = validateHostPath(
    options.skillsDirectory ?? join(options.homeDirectory ?? homedir(), '.agents', 'skills'),
    'LOOM_SKILLS_DIR',
  );
  const projectDirectory = validateHostPath(
    options.projectDirectory ?? join(options.homeDirectory ?? homedir(), '.local', 'share', 'skill-loom', 'workspace'),
    'LOOM_PROJECT_DIR',
  );
  const caddyFile = validateHostPath(
    options.caddyFile ?? join(REPOSITORY_ROOT, 'container', 'Caddyfile'),
    'Caddyfile',
  );
  const imageTag = validateImageTag(options.imageTag ?? 'development');
  const hostPort = options.hostPort;
  if (hostPort !== undefined &&
      (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535)) {
    throw new PodmanHostError('PORT_INVALID', 'LOOM_PODMAN_HOST_PORT must be an integer between 1 and 65535.');
  }

  const publishPort = hostPort === undefined ? '' : `PublishPort=127.0.0.1:${hostPort}:8080\n`;
  return {
    'skill-loom-config.volume': `${MANAGED_MARKER}
[Volume]
VolumeName=${CONFIG_VOLUME}
`,
    'skill-loom.pod': `${MANAGED_MARKER}
[Unit]
Description=Skill Loom private Podman pod

[Pod]
PodName=${POD_NAME}
UserNS=keep-id:uid=1000,gid=1000
${publishPort}[Install]
WantedBy=default.target
`,
    [APP_UNIT]: `${MANAGED_MARKER}
[Unit]
Description=Skill Loom application container

[Container]
Image=${APP_IMAGE}:${imageTag}
ContainerName=${APP_CONTAINER}
Pod=skill-loom.pod
User=1000:1000
Volume=${CONFIG_VOLUME}.volume:/var/lib/loom/config
Volume=${skillsDirectory}:/var/lib/loom/skills:ro
Volume=${projectDirectory}:/workspace
Environment=LOOM_HOST=127.0.0.1
Environment=LOOM_PORT=3000
Environment=LOOM_CONFIG_DIR=/var/lib/loom/config
Environment=LOOM_SKILLS_DIR=/var/lib/loom/skills
Pull=never

[Service]
Restart=on-failure
TimeoutStartSec=900

[Install]
WantedBy=default.target
`,
    'skill-loom-proxy.container': `${MANAGED_MARKER}
[Unit]
Description=Skill Loom Caddy proxy

[Container]
Image=${CADDY_IMAGE}
ContainerName=${PROXY_CONTAINER}
Pod=skill-loom.pod
Volume=${caddyFile}:/etc/caddy/Caddyfile:ro
Exec=caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
Pull=missing

[Service]
Restart=on-failure
TimeoutStartSec=900

[Install]
WantedBy=default.target
`,
  };
}

export function createPodmanHostPlan(options = {}) {
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? env.HOME ?? homedir();
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const imageTag = validateImageTag(options.imageTag ?? 'development');
  const skillsDirectory = validateHostPath(
    env.LOOM_SKILLS_DIR ?? join(homeDirectory, '.agents', 'skills'),
    'LOOM_SKILLS_DIR',
  );
  const projectDirectory = validateHostPath(
    env.LOOM_PROJECT_DIR ?? join(homeDirectory, '.local', 'share', 'skill-loom', 'workspace'),
    'LOOM_PROJECT_DIR',
  );
  const hostPort = parseHostPort(env.LOOM_PODMAN_HOST_PORT);
  const unitDirectory = resolveXdgPath(
    env.XDG_CONFIG_HOME,
    join(homeDirectory, '.config'),
    'XDG_CONFIG_HOME',
    'containers',
    'systemd',
  );
  const stateDirectory = resolveXdgPath(
    env.XDG_STATE_HOME,
    join(homeDirectory, '.local', 'state'),
    'XDG_STATE_HOME',
    'skill-loom-host',
  );
  const image = `${APP_IMAGE}:${imageTag}`;
  const files = createQuadletFiles({
    skillsDirectory,
    projectDirectory,
    caddyFile: join(repositoryRoot, 'container', 'Caddyfile'),
    imageTag,
    hostPort,
  });

  return {
    image,
    imageTag,
    skillsDirectory,
    projectDirectory,
    hostPort: hostPort ?? null,
    unitDirectory,
    stateDirectory,
    files,
    buildArgs: ['build', '--tag', image, '--file', join(repositoryRoot, 'Containerfile'), repositoryRoot],
    startUnits: ['skill-loom-app.service', 'skill-loom-proxy.service'],
    allUnits: [
      'skill-loom-pod.service',
      'skill-loom-app.service',
      'skill-loom-proxy.service',
      'skill-loom-config-volume.service',
    ],
  };
}

export async function runPodmanHost(args = process.argv.slice(2), dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const spawn = dependencies.spawnSync ?? spawnSync;
  const platform = dependencies.platform ?? process.platform;
  const uid = dependencies.uid ?? process.getuid?.() ?? -1;
  const repositoryRoot = dependencies.repositoryRoot ?? REPOSITORY_ROOT;
  const homeDirectory = dependencies.homeDirectory ?? env.HOME ?? homedir();
  const action = args[0];

  if (action === undefined || action === '--help' || action === '-h') {
    stdout.write(
      'Usage: node scripts/podman-host.mjs <plan|install|start|stop|restart|status|logs|update|rollback|backup>\n' +
      'Production host management uses rootless Podman Quadlets and systemd user services.\n' +
      'Set LOOM_SKILLS_DIR and LOOM_PROJECT_DIR on initial install; optionally set LOOM_PODMAN_HOST_PORT for loopback-only HTTP.\n',
    );
    return 0;
  }

  try {
    if (action === 'plan') {
      if (args.length > 1) {
        throw new PodmanHostError('USAGE', 'The plan action does not accept arguments.');
      }
      const imageTag = await getImageTag({ env, spawn, repositoryRoot });
      stdout.write(`${JSON.stringify(createPodmanHostPlan({ env, homeDirectory, repositoryRoot, imageTag }), null, 2)}\n`);
      return 0;
    }
    if (!['install', 'start', 'stop', 'restart', 'status', 'logs', 'update', 'rollback', 'backup'].includes(action)) {
      throw new PodmanHostError('USAGE', `Unknown host management action: ${action}`);
    }

    const plan = await prepareHost(action, args.slice(1), {
      env, platform, uid, repositoryRoot, homeDirectory, spawn,
    });
    const run = (command, commandArgs, options = {}) => invoke(spawn, command, commandArgs, {
      cwd: repositoryRoot,
      env,
      capture: options.capture === true,
      allowFailure: options.allowFailure === true,
    });

    if (['start', 'stop', 'restart', 'status', 'logs'].includes(action)) {
      await manageService(action, args.slice(1), { env, run, plan, stdout });
      return 0;
    }
    if (action === 'install') {
      await installHost(plan, { env, run, stdout, replace: args.slice(1).includes('--replace') });
      return 0;
    }
    if (action === 'update') {
      await updateHost(plan, { env, run, spawn, repositoryRoot, stdout });
      return 0;
    }
    if (action === 'rollback') {
      await rollbackHost(plan, { env, run, stdout });
      return 0;
    }
    if (action === 'backup') {
      await backupHost(args.slice(1), { env, run, stdout });
      return 0;
    }
  } catch (error) {
    const code = error instanceof PodmanHostError ? error.code : 'PODMAN_HOST_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    return code === 'USAGE' ? 2 : 1;
  }
}

async function prepareHost(action, actionArgs, dependencies) {
  const { env, platform, uid, repositoryRoot, homeDirectory, spawn } = dependencies;
  if (actionArgs.some((arg) => arg !== '--replace') && action === 'install') {
    throw new PodmanHostError('USAGE', 'Install accepts only the optional --replace flag.');
  }
  if (action === 'install' && actionArgs.filter((arg) => arg === '--replace').length > 1) {
    throw new PodmanHostError('USAGE', 'Install accepts --replace at most once.');
  }
  if (action !== 'install' && actionArgs.length > 0) {
    if (action === 'logs' && actionArgs.length === 1) {
      // The selected log target is validated by manageService.
    } else if (action === 'backup' && actionArgs.length === 2 && actionArgs[0] === '--output') {
      // The output path is validated by backupHost.
    } else {
      throw new PodmanHostError('USAGE', `The ${action} action does not accept these arguments.`);
    }
  }

  verifyHostPlatform(platform, uid);
  if (action === 'install' || action === 'update') {
    await verifyHostPrerequisites({ env, spawn, repositoryRoot });
  }
  const imageTag = action === 'install' || action === 'update'
    ? await getImageTag({ env, spawn, repositoryRoot })
    : 'development';
  const plan = createPodmanHostPlan({ env, homeDirectory, repositoryRoot, imageTag });
  if (action === 'install') {
    ensureDirectory(plan.skillsDirectory);
    ensureDirectory(plan.projectDirectory);
  }
  return plan;
}

function verifyHostPlatform(platform, uid) {
  if (platform !== 'linux') {
    throw new PodmanHostError(
      'PLATFORM_UNSUPPORTED',
      'Persistent host management requires Linux with systemd; use npm run podman:up for local Podman Machine deployments.',
    );
  }
  if (uid === 0) {
    throw new PodmanHostError('ROOTFUL_UNSUPPORTED', 'Run host management as the dedicated non-root Podman account.');
  }
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new PodmanHostError('NODE_VERSION_UNSUPPORTED', 'Host management requires Node.js 24 or newer.');
  }
}

async function verifyHostPrerequisites({ env, spawn, repositoryRoot }) {
  const podman = env.PODMAN ?? 'podman';
  const version = invoke(spawn, podman, ['--version'], { env, capture: true }).stdout;
  const parsed = /podman version (\d+)\.(\d+)\.(\d+)/i.exec(version);
  if (parsed === null || Number(parsed[1]) < 4 ||
      (Number(parsed[1]) === 4 && Number(parsed[2]) < 4)) {
    throw new PodmanHostError('PODMAN_VERSION_UNSUPPORTED', 'Quadlet host deployment requires Podman 4.4 or newer.');
  }

  const cgroups = invoke(spawn, podman, ['info', '--format', '{{.Host.CgroupsVersion}}'], { env, capture: true }).stdout;
  if (cgroups !== '2' && cgroups !== 'v2') {
    throw new PodmanHostError('CGROUPS_UNSUPPORTED', 'Rootless Quadlet deployment requires cgroup v2.');
  }

  const linger = invoke(spawn, env.LOGINCTL ?? 'loginctl', ['show-user', '--property=Linger', '--value'], { env, capture: true }).stdout;
  if (linger !== 'yes' && linger !== 'true') {
    throw new PodmanHostError(
      'LINGER_DISABLED',
      `Enable the user service at boot with "sudo loginctl enable-linger ${env.USER ?? 'loom'}", then retry.`,
    );
  }
  invoke(spawn, env.SYSTEMCTL ?? 'systemctl', ['--user', 'show-environment'], { env, capture: true });

  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
    const result = spawn(env.GIT ?? 'git', args, {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    });
    if (result.error !== undefined) {
      throw new PodmanHostError('GIT_UNAVAILABLE', `Could not check the deployment checkout: ${result.error.message}`, { cause: result.error });
    }
    if (result.status !== 0) {
      throw new PodmanHostError('CHECKOUT_DIRTY', 'Commit or discard tracked changes before building a hosted image.');
    }
  }
}

async function installHost(plan, { env, run, stdout, replace }) {
  const podman = env.PODMAN ?? 'podman';
  const existing = inspectUnitFiles(plan.unitDirectory, plan.files);
  if (existing.conflicts.length > 0 && !replace) {
    throw new PodmanHostError(
      'UNIT_CONFLICT',
      `Existing Quadlet files differ from this deployment: ${existing.conflicts.join(', ')}. Use install --replace only after reviewing them.`,
    );
  }

  run(podman, plan.buildArgs);
  const previous = writeUnitFiles(plan.unitDirectory, plan.files);
  try {
    run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'daemon-reload']);
    run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'start', ...plan.startUnits]);
    await checkServiceHealth({ run, podman });
  } catch (error) {
    restoreUnitFiles(plan.unitDirectory, previous);
    const restoreErrors = [];
    try {
      run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'daemon-reload']);
      if (Object.values(previous).some((value) => value !== null)) {
        run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'restart', ...plan.startUnits]);
      } else {
        run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'stop', ...plan.startUnits]);
      }
    } catch (restoreError) {
      restoreErrors.push(restoreError instanceof Error ? restoreError.message : String(restoreError));
    }
    throw new PodmanHostError(
      'INSTALL_FAILED',
      `Host installation failed: ${error instanceof Error ? error.message : String(error)}${restoreErrors.length === 0 ? '' : ` Rollback also failed: ${restoreErrors.join('; ')}`}`,
      { cause: error },
    );
  }
  stdout.write(`Skill Loom installed and running as rootless Quadlets. Config volume: ${CONFIG_VOLUME}\n`);
  stdout.write(`Skills: ${plan.skillsDirectory}\nWorkspace: ${plan.projectDirectory}\n`);
  stdout.write('Only SSH/Podman access is needed for remote clients; no host HTTP port is published by default.\n');
}

async function manageService(action, actionArgs, { env, run, plan, stdout }) {
  const systemctl = env.SYSTEMCTL ?? 'systemctl';
  const units = ['skill-loom-pod.service', ...plan.startUnits, 'skill-loom-config-volume.service'];
  if (action === 'status') {
    run(systemctl, ['--user', 'status', '--no-pager', ...units]);
    return;
  }
  if (action === 'logs') {
    const target = actionArgs[0] ?? 'app';
    if (!['app', 'proxy'].includes(target)) {
      throw new PodmanHostError('USAGE', 'Logs target must be app or proxy.');
    }
    run(env.PODMAN ?? 'podman', ['logs', '--tail', '100', '--follow', target === 'app' ? APP_CONTAINER : PROXY_CONTAINER]);
    return;
  }
  const operationUnits = action === 'stop' ? [...plan.startUnits, 'skill-loom-pod.service'] : plan.startUnits;
  const verb = action === 'restart' ? 'restart' : action;
  run(systemctl, ['--user', verb, ...operationUnits]);
  if (action === 'start' || action === 'restart') {
    await checkServiceHealth({ run, podman: env.PODMAN ?? 'podman' });
  }
  stdout.write(`Skill Loom ${action} completed.\n`);
}

async function updateHost(plan, { env, run, stdout }) {
  const currentPath = join(plan.unitDirectory, APP_UNIT);
  const current = readManagedUnit(currentPath);
  const currentTag = imageTagFromUnit(current);
  if (currentTag === plan.imageTag) {
    throw new PodmanHostError('ALREADY_CURRENT', `The hosted service already uses ${APP_IMAGE}:${plan.imageTag}.`);
  }

  const podman = env.PODMAN ?? 'podman';
  run(podman, plan.buildArgs);
  const previousPath = rollbackUnitPath(plan.stateDirectory);
  ensureDirectory(plan.stateDirectory);
  const newUnit = replaceImageTag(current, plan.imageTag);
  const previousContent = current;
  writeTextAtomically(previousPath, previousContent);
  writeTextAtomically(currentPath, newUnit);

  try {
    run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'daemon-reload']);
    run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'restart', 'skill-loom-app.service']);
    await checkServiceHealth({ run, podman });
  } catch (error) {
    writeTextAtomically(currentPath, previousContent);
    const rollbackErrors = [];
    try {
      run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'daemon-reload']);
      run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'restart', 'skill-loom-app.service']);
      await checkServiceHealth({ run, podman });
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    }
    throw new PodmanHostError(
      'UPDATE_FAILED',
      `The new image failed to start; the previous unit was restored.${rollbackErrors.length === 0 ? '' : ` Recovery failed: ${rollbackErrors.join('; ')}`}`,
      { cause: error },
    );
  }
  stdout.write(`Updated Skill Loom to ${APP_IMAGE}:${plan.imageTag}; previous image retained for rollback.\n`);
}

async function rollbackHost(plan, { env, run, stdout }) {
  const currentPath = join(plan.unitDirectory, APP_UNIT);
  const previousPath = rollbackUnitPath(plan.stateDirectory);
  const current = readManagedUnit(currentPath);
  let previous;
  try {
    previous = readManagedUnit(previousPath);
  } catch (error) {
    if (error instanceof PodmanHostError && error.code === 'UNIT_UNAVAILABLE') {
      throw new PodmanHostError('ROLLBACK_UNAVAILABLE', 'No previous host image is available for rollback.');
    }
    throw error;
  }

  const oldTag = imageTagFromUnit(previous);
  const podman = env.PODMAN ?? 'podman';
  const imageExists = run(podman, ['image', 'exists', `${APP_IMAGE}:${oldTag}`], {
    allowFailure: true,
  });
  if (imageExists.status !== 0) {
    throw new PodmanHostError('IMAGE_UNAVAILABLE', `Rollback image ${APP_IMAGE}:${oldTag} is not present locally.`);
  }

  const currentTag = imageTagFromUnit(current);
  writeTextAtomically(currentPath, previous);
  try {
    run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'daemon-reload']);
    run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'restart', 'skill-loom-app.service']);
    await checkServiceHealth({ run, podman });
  } catch (error) {
    writeTextAtomically(currentPath, current);
    try {
      run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'daemon-reload']);
      run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'restart', 'skill-loom-app.service']);
      await checkServiceHealth({ run, podman });
    } catch (rollbackError) {
      throw new PodmanHostError(
        'ROLLBACK_FAILED',
        `Rollback to ${oldTag} failed and restoring ${currentTag} also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: error },
      );
    }
    throw new PodmanHostError('ROLLBACK_FAILED', `Rollback to ${oldTag} failed; ${currentTag} was restored.`, { cause: error });
  }

  writeTextAtomically(previousPath, current);
  stdout.write(`Rolled back Skill Loom to ${APP_IMAGE}:${oldTag}.\n`);
}

async function backupHost(args, { env, run, stdout }) {
  if (args.length !== 2 || args[0] !== '--output' || !isAbsolute(args[1])) {
    throw new PodmanHostError('USAGE', 'Backup requires --output with an absolute, new archive path.');
  }
  const destination = resolve(args[1]);
  if (lstatIfPresent(destination) !== null) {
    throw new PodmanHostError('BACKUP_EXISTS', `Refusing to overwrite existing backup: ${destination}`);
  }
  const active = run(env.SYSTEMCTL ?? 'systemctl', ['--user', 'is-active', '--quiet', 'skill-loom-app.service'], {
    allowFailure: true,
  }).status === 0;
  if (active) {
    throw new PodmanHostError('SERVICE_RUNNING', 'Stop Skill Loom with "node scripts/podman-host.mjs stop" before exporting the config volume.');
  }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    run(env.PODMAN ?? 'podman', ['volume', 'export', CONFIG_VOLUME, '--output', temporary]);
    chmodSync(temporary, 0o600);
    linkSync(temporary, destination);
  } finally {
    unlinkSyncIfPresent(temporary);
  }
  stdout.write(`Exported ${CONFIG_VOLUME} to ${destination}. Back up the skills and workspace directories separately.\n`);
}

async function checkServiceHealth({ run, podman }) {
  run(podman, ['exec', APP_CONTAINER, 'node', '/app/dist/src/server/cli.js', 'service', 'status'], { capture: true });
}

function inspectUnitFiles(unitDirectory, files) {
  const conflicts = [];
  for (const [fileName, content] of Object.entries(files)) {
    const path = join(unitDirectory, fileName);
    const info = lstatIfPresent(path);
    if (info === null) continue;
    if (!info.isFile() || info.isSymbolicLink() || readFileSync(path, 'utf8') !== content) {
      conflicts.push(fileName);
      continue;
    }
  }
  return { conflicts };
}

function writeUnitFiles(unitDirectory, files) {
  mkdirSync(unitDirectory, { recursive: true, mode: 0o700 });
  const previous = {};
  for (const [fileName, content] of Object.entries(files)) {
    const path = join(unitDirectory, fileName);
    const info = lstatIfPresent(path);
    if (info !== null) {
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new PodmanHostError('UNIT_CONFLICT', `Refusing to replace non-regular Quadlet path: ${path}`);
      }
      previous[fileName] = readFileSync(path, 'utf8');
    } else {
      previous[fileName] = null;
    }
  }

  const written = [];
  try {
    for (const [fileName, content] of Object.entries(files)) {
      writeTextAtomically(join(unitDirectory, fileName), content);
      written.push(fileName);
    }
  } catch (error) {
    const restoreErrors = [];
    for (const fileName of written.reverse()) {
      const path = join(unitDirectory, fileName);
      try {
        const content = previous[fileName];
        if (content === null) rmSync(path, { force: true });
        else writeTextAtomically(path, content);
      } catch (restoreError) {
        restoreErrors.push(restoreError instanceof Error ? restoreError.message : String(restoreError));
      }
    }
    if (restoreErrors.length > 0) {
      throw new PodmanHostError(
        'UNIT_WRITE_ROLLBACK_FAILED',
        `Writing Quadlet files failed; restoring prior files also failed: ${restoreErrors.join('; ')}`,
        { cause: error },
      );
    }
    throw error;
  }
  return previous;
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function unlinkSyncIfPresent(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}

function restoreUnitFiles(unitDirectory, previous) {
  for (const [fileName, content] of Object.entries(previous)) {
    const path = join(unitDirectory, fileName);
    if (content === null) rmSync(path, { force: true });
    else writeTextAtomically(path, content);
  }
}

function readManagedUnit(path) {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new PodmanHostError('UNIT_UNAVAILABLE', `Managed Quadlet is not a regular file: ${path}`);
    }
    const content = readFileSync(path, 'utf8');
    if (!content.startsWith(`${MANAGED_MARKER}\n`)) {
      throw new PodmanHostError('UNIT_UNAVAILABLE', `Quadlet is not marked as Skill Loom managed: ${path}`);
    }
    return content;
  } catch (error) {
    if (error instanceof PodmanHostError) throw error;
    throw new PodmanHostError('UNIT_UNAVAILABLE', `Could not read the Skill Loom Quadlet: ${path}`, { cause: error });
  }
}

function imageTagFromUnit(content) {
  const matches = [...content.matchAll(/^Image=localhost\/skill-loom:([a-f0-9]{7,40})$/gm)];
  if (matches.length !== 1) {
    throw new PodmanHostError('UNIT_INVALID', 'The Skill Loom app Quadlet does not contain exactly one managed image tag.');
  }
  return matches[0][1];
}

function replaceImageTag(content, imageTag) {
  const currentTag = imageTagFromUnit(content);
  return content.replace(`${APP_IMAGE}:${currentTag}`, `${APP_IMAGE}:${validateImageTag(imageTag)}`);
}

function rollbackUnitPath(stateDirectory) {
  return join(stateDirectory, APP_UNIT);
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o750 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new PodmanHostError('PATH_UNSAFE', `Deployment path is not a real directory: ${path}`);
  }
  return realpathSync(path);
}

function writeTextAtomically(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new PodmanHostError('FILE_WRITE_FAILED', `Could not atomically write ${path}.`, { cause: error });
  }
}

function invoke(spawn, command, args, options = {}) {
  const result = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture === true ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw new PodmanHostError('COMMAND_FAILED', `Could not run ${command}: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0 && options.allowFailure !== true) {
    const details = options.capture === true && typeof result.stderr === 'string'
      ? result.stderr.trim()
      : '';
    throw new PodmanHostError(
      'COMMAND_FAILED',
      `${command} ${args.join(' ')} exited with status ${String(result.status)}${details === '' ? '.' : `: ${details}`}`,
    );
  }
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout.trim() : '',
    stderr: typeof result.stderr === 'string' ? result.stderr.trim() : '',
  };
}

async function getImageTag({ env, spawn, repositoryRoot }) {
  const result = invoke(spawn, env.GIT ?? 'git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: repositoryRoot,
    env,
    capture: true,
  });
  return validateImageTag(result.stdout);
}

function validateImageTag(imageTag) {
  if (typeof imageTag !== 'string' || !/^(?:[a-f0-9]{7,40}|development)$/.test(imageTag)) {
    throw new PodmanHostError('IMAGE_TAG_INVALID', 'Image tags must be a Git commit id or "development".');
  }
  return imageTag;
}

function validateHostPath(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new PodmanHostError('PATH_INVALID', `${label} must be an absolute host path.`);
  }
  const normalized = resolve(path);
  if (/[\s,:,\u0000-\u001f\u007f%\\"#]/.test(normalized)) {
    throw new PodmanHostError('PATH_INVALID', `${label} contains a character that cannot be represented safely in a Quadlet volume.`);
  }
  return normalized;
}

function parseHostPort(value) {
  if (value === undefined || value === '') return undefined;
  if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new PodmanHostError('PORT_INVALID', 'LOOM_PODMAN_HOST_PORT must be an integer between 1 and 65535.');
  }
  return Number(value);
}

function resolveXdgPath(value, fallback, name, ...segments) {
  if (value !== undefined && (!isAbsolute(value) || value.trim() === '')) {
    throw new PodmanHostError('PATH_INVALID', `${name} must be an absolute path.`);
  }
  return join(value ?? fallback, ...segments);
}

function isMainModule() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) process.exitCode = await runPodmanHost();
