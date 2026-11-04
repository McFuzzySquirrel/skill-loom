#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageManifest from '../../package.json' with { type: 'json' };
import type { ServerSettings } from './app.js';
import { resolveConfigDir } from './config/store.js';
import { startServer } from './index.js';

/**
 * Package CLI entry point.
 *
 * The CLI is a thin launcher over the same production server used by
 * `npm start`. It never bypasses the loopback-only server contract; options
 * only set the documented environment overrides before `buildApp` runs.
 */

export interface CliOptions {
  help: boolean;
  version: boolean;
  open: boolean;
  port?: number;
  configDir?: string;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

const DEFAULT_PORT = 7373;

export function cliUsage(): string {
  return `Skill Loom ${packageManifest.version}

Usage:
  skill-loom [options]

Options:
  -h, --help              Show this help text
  -v, --version           Print the version
      --no-open           Do not open a browser
      --port <number>     Loopback port (default: ${String(DEFAULT_PORT)})
      --config-dir <path> Override the global config directory

Environment:
  LOOM_CONFIG_DIR         Global config directory
  LOOM_PORT               Loopback port
  LOOM_HOST               Loopback host (127.0.0.1 by default)
  LOOM_WEB_ROOT           Built web asset directory override

The server always binds to loopback. Open the printed URL in a browser.`;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    version: false,
    open: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;

    if (argument === '-h' || argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument === '-v' || argument === '--version') {
      options.version = true;
      continue;
    }
    if (argument === '--no-open') {
      options.open = false;
      continue;
    }
    if (argument === '--open') {
      options.open = true;
      continue;
    }

    if (argument === '--port' || argument.startsWith('--port=')) {
      const inline = argument.startsWith('--port=') ? argument.slice('--port='.length) : null;
      const value = inline ?? argv[index + 1];
      if (value === undefined || value.trim() === '') {
        throw new CliUsageError('--port requires a number from 1 to 65535.');
      }
      if (inline === null) {
        index += 1;
      }
      options.port = parsePort(value);
      continue;
    }

    if (argument === '--config-dir' || argument.startsWith('--config-dir=')) {
      const inline = argument.startsWith('--config-dir=')
        ? argument.slice('--config-dir='.length)
        : null;
      const value = inline ?? argv[index + 1];
      if (value === undefined || value.trim() === '') {
        throw new CliUsageError('--config-dir requires an absolute or relative path.');
      }
      if (inline === null) {
        index += 1;
      }
      options.configDir = resolve(value);
      continue;
    }

    if (argument.startsWith('-')) {
      throw new CliUsageError(`Unknown option: ${argument}`);
    }
    throw new CliUsageError(`Unexpected argument: ${argument}`);
  }

  return options;
}

export interface CliStartedServer {
  settings: ServerSettings;
}

export interface RunCliDependencies {
  start?: (options: { logger?: boolean }) => Promise<CliStartedServer>;
  openBrowser?: (url: string) => void;
  stdout?: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  env?: NodeJS.ProcessEnv;
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: RunCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const env = dependencies.env ?? process.env;

  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      stderr.write(`${error.message}\n\n${cliUsage()}\n`);
      return 2;
    }
    throw error;
  }

  if (options.help) {
    stdout.write(`${cliUsage()}\n`);
    return 0;
  }
  if (options.version) {
    stdout.write(`Skill Loom ${packageManifest.version}\n`);
    return 0;
  }

  if (options.port !== undefined) {
    env.LOOM_PORT = String(options.port);
  }
  if (options.configDir !== undefined) {
    env.LOOM_CONFIG_DIR = options.configDir;
  }

  try {
    const started = await (dependencies.start ?? startServer)({ logger: false });
    const url = `http://${started.settings.host}:${String(started.settings.port)}`;
    const configDirectory = resolveConfigDir({ env });

    stdout.write(
      `Skill Loom ${packageManifest.version}\nConfig: ${configDirectory}\nURL: ${url}\nPress Ctrl+C to stop.\n`,
    );

    if (
      options.open &&
      stdout.isTTY === true &&
      env.CI === undefined &&
      env.CI !== 'true'
    ) {
      (dependencies.openBrowser ?? openBrowser)(url);
    }

    return 0;
  } catch (error) {
    stderr.write(`Skill Loom failed to start: ${describeStartFailure(error)}\n`);
    return 1;
  }
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new CliUsageError('--port requires a number from 1 to 65535.');
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CliUsageError('--port requires a number from 1 to 65535.');
  }
  return port;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args =
    process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

  try {
    const child = spawn(command, args, {
      shell: false,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      // Opening a browser is a convenience; the printed URL is authoritative.
    });
    child.unref();
  } catch {
    // The printed URL remains available when no opener is installed.
  }
}

function describeStartFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'EADDRINUSE') {
      return 'the configured port is already in use. Choose another port with --port or LOOM_PORT.';
    }
    if (typeof code === 'string' && code !== '') {
      return `${code}. Check the server settings and try again.`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return (
      realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli().then((code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  });
}
