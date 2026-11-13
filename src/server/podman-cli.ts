#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_CONTAINER = 'skill-loom-app';
const CONTAINER_CLI = '/app/dist/src/server/cli.js';

export function createPodmanCliArgs(args: readonly string[], allocateTty: boolean): string[] {
  if (args.length === 0) {
    throw new TypeError('Pass a Skill Loom CLI command to forward into the Podman service.');
  }
  if (args[0] === 'service' && args[1] !== 'status') {
    throw new TypeError('The Podman service lifecycle is managed with podman:up and podman:down.');
  }
  return [
    'exec',
    '--interactive',
    ...(allocateTty ? ['--tty'] : []),
    APP_CONTAINER,
    'node',
    CONTAINER_CLI,
    ...args,
  ];
}

export function runPodmanCli(args: readonly string[]): number {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(
      'Usage: skill-loom-podman <skill-loom command...>\n' +
      'Forwards CLI commands to the running skill-loom Podman container.\n' +
      'Use npm run podman:up and npm run podman:down to manage the service.\n',
    );
    return 0;
  }

  const command = process.env.PODMAN ?? 'podman';
  const result = spawnSync(
    command,
    createPodmanCliArgs(args, process.stdin.isTTY === true && process.stdout.isTTY === true),
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.error !== undefined) {
    throw new Error(`Could not run Podman CLI bridge: ${result.error.message}`, { cause: result.error });
  }
  return result.status ?? 1;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    process.exitCode = runPodmanCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
