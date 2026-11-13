import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POD_NAME = 'skill-loom';
const IMAGE_NAME = 'skill-loom:dev';
const CONFIG_VOLUME = 'skill-loom-config';

function absoluteDirectory(value, fallback) {
  const directory = resolve(value ?? fallback);
  if (directory.includes('\0') || directory.includes(',')) {
    throw new TypeError('Podman bind-mount paths cannot contain NUL bytes or commas.');
  }
  return directory;
}

function bindMount(source, destination, readOnly = false) {
  return `type=bind,src=${source},dst=${destination}${readOnly ? ',ro' : ''}`;
}

export function createPodmanPlan(options = {}) {
  const env = options.env ?? process.env;
  const hostPlatform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const projectDirectory = absoluteDirectory(
    env.LOOM_PROJECT_DIR,
    options.cwd ?? process.cwd(),
  );
  const skillsDirectory = absoluteDirectory(
    env.LOOM_SKILLS_DIR,
    join(homeDirectory, '.agents', 'skills'),
  );
  const port = env.LOOM_PODMAN_PORT ?? '4317';
  if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new TypeError('LOOM_PODMAN_PORT must be an integer between 1 and 65535.');
  }

  const platform = env.LOOM_PODMAN_PLATFORM;
  if (platform !== undefined && platform !== 'linux/amd64' && platform !== 'linux/arm64') {
    throw new TypeError('LOOM_PODMAN_PLATFORM must be linux/amd64 or linux/arm64.');
  }

  const commands = [];
  if (hostPlatform === 'darwin' || hostPlatform === 'win32') {
    commands.push(['machine', 'start']);
  }
  const buildArgs = ['build', '--tag', IMAGE_NAME];
  if (platform !== undefined) buildArgs.push('--platform', platform);
  buildArgs.push('--file', join(REPOSITORY_ROOT, 'Containerfile'), REPOSITORY_ROOT);
  commands.push(buildArgs);
  commands.push(['volume', 'create', CONFIG_VOLUME]);

  const podArgs = [
    'pod', 'create', '--name', POD_NAME,
    '--userns=keep-id:uid=1000,gid=1000',
  ];
  if (options.privateNetwork !== true) {
    podArgs.push('--publish', `127.0.0.1:${port}:8080`);
  }
  commands.push(podArgs);
  commands.push([
    'run', '--detach', '--init', '--pod', POD_NAME, '--name', `${POD_NAME}-app`,
    '--user', '1000:1000',
    '--mount', `type=volume,source=${CONFIG_VOLUME},destination=/var/lib/loom/config`,
    '--mount', bindMount(skillsDirectory, '/var/lib/loom/skills', true),
    '--mount', bindMount(projectDirectory, '/workspace'),
    '--env', 'LOOM_HOST=127.0.0.1',
    '--env', 'LOOM_PORT=3000',
    '--env', 'LOOM_CONFIG_DIR=/var/lib/loom/config',
    '--env', 'LOOM_SKILLS_DIR=/var/lib/loom/skills',
    IMAGE_NAME,
  ]);
  commands.push([
    'run', '--detach', '--pod', POD_NAME, '--name', `${POD_NAME}-proxy`,
    '--mount', bindMount(join(REPOSITORY_ROOT, 'container', 'Caddyfile'), '/etc/caddy/Caddyfile', true),
    'docker.io/library/caddy:2-alpine',
    'caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile',
  ]);

  return {
    commands,
    configVolume: CONFIG_VOLUME,
    skillsDirectory,
    projectDirectory,
    port: Number(port),
    privateNetwork: options.privateNetwork === true,
    platform,
  };
}

function execute(args, options = {}) {
  const result = spawnSync(process.env.PODMAN ?? 'podman', args, {
    cwd: REPOSITORY_ROOT,
    stdio: options.capture === true ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run Podman: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`Podman exited with status ${String(result.status)}: ${args.join(' ')}`);
  }
  return result;
}

function printPlan(plan) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

function ensureDataDirectories(plan) {
  mkdirSync(plan.skillsDirectory, { recursive: true });
}

function runUp(plan) {
  ensureDataDirectories(plan);
  let podCreated = false;
  try {
    for (const args of plan.commands) {
      if (args[0] === 'volume' && args[1] === 'create') {
        const existing = spawnSync(process.env.PODMAN ?? 'podman', ['volume', 'exists', args[2]], {
          stdio: 'ignore',
          windowsHide: true,
        });
        if (existing.error !== undefined) {
          throw new Error(`Could not query Podman volume: ${existing.error.message}`, { cause: existing.error });
        }
        if (existing.status === 0) continue;
        if (existing.status !== 1) {
          throw new Error(`Podman volume check exited with status ${String(existing.status)}.`);
        }
      }
      if (args[0] === 'pod' && args[1] === 'create') {
        const existing = spawnSync(process.env.PODMAN ?? 'podman', ['pod', 'exists', POD_NAME], {
          stdio: 'ignore',
          windowsHide: true,
        });
        if (existing.error !== undefined) {
          throw new Error(`Could not query Podman: ${existing.error.message}`, { cause: existing.error });
        }
        if (existing.status === 0) {
          throw new Error(`Pod "${POD_NAME}" already exists; stop or rename it before starting this deployment.`);
        }
      }
      execute(args);
      if (args[0] === 'pod' && args[1] === 'create') podCreated = true;
    }
  } catch (error) {
    if (podCreated) {
      spawnSync(process.env.PODMAN ?? 'podman', ['pod', 'rm', '--force', POD_NAME], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    throw error;
  }

  if (plan.privateNetwork) {
    process.stdout.write(`Skill Loom is listening on the private Podman network at port 8080. Pod: ${POD_NAME}\n`);
    process.stdout.write('Expose it only through a private authenticated platform/VPN ingress.\n');
  } else {
    process.stdout.write(`Skill Loom is available at http://127.0.0.1:${String(plan.port)}\n`);
  }
}

function usage() {
  process.stdout.write(
    'Usage: node scripts/podman.mjs <up|down|plan> [--private-network] [--dry-run]\n',
  );
}

function main(argv) {
  const [action, ...flags] = argv;
  if (action === undefined || action === '--help' || action === '-h') {
    usage();
    return;
  }
  const allowedFlags = new Set(['--private-network', '--dry-run']);
  const unknown = flags.find((flag) => !allowedFlags.has(flag));
  if (unknown !== undefined) throw new TypeError(`Unknown option: ${unknown}`);

  if (action === 'down') {
    if (flags.includes('--private-network') || flags.includes('--dry-run')) {
      throw new TypeError('The down action does not accept deployment options.');
    }
    if (process.platform === 'darwin' || process.platform === 'win32') {
      execute(['machine', 'start']);
    }
    const existing = spawnSync(process.env.PODMAN ?? 'podman', ['pod', 'exists', POD_NAME], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (existing.error !== undefined) {
      throw new Error(`Could not query Podman: ${existing.error.message}`, { cause: existing.error });
    }
    if (existing.status !== 0) {
      process.stdout.write(`Pod "${POD_NAME}" is not present; persistent host directories were left untouched.\n`);
      return;
    }
    execute(['pod', 'rm', '--force', POD_NAME]);
    process.stdout.write('The Skill Loom pod was removed; persistent host directories were left untouched.\n');
    return;
  }
  if (action !== 'up' && action !== 'plan') {
    throw new TypeError(`Unknown action: ${action}`);
  }

  const plan = createPodmanPlan({ privateNetwork: flags.includes('--private-network') });
  if (action === 'plan' || flags.includes('--dry-run')) {
    printPlan(plan);
    return;
  }
  runUp(plan);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
