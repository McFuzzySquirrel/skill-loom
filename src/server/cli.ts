#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import packageManifest from '../../package.json' with { type: 'json' };
import { runPortableCli } from '../portable/cli.js';
import { runCatalogCli } from './catalog/cli.js';
import { callControl, ControlError } from './control.js';
import { WindowsControlSecurityError } from './windows-control.js';
import { runControlCli } from './control-cli.js';
import { createBundleCli } from './bundle-cli.js';
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

const SERVICE_HELP = `Usage:
  skill-loom service start [--config-dir <path>] [--port <number>]
  skill-loom service status [--config-dir <path>]
  skill-loom service stop [--config-dir <path>]

Start explicitly owns the profile and does not open a browser. Status and stop
contact the existing owner; normal stop refuses an active or changing run.`;

const BUNDLE_HELP = `Usage:
  skill-loom bundle inspect --bundle <absolute-path> [--project <absolute-path>]
  skill-loom bundle create (--draft <id> | --project <id> --chain <id>) --output <absolute-path> [--config-dir <path>]
  skill-loom bundle review|import [--config-dir <path>]  # JSON on stdin
  skill-loom bundle --help

Inspect is read-only and does not require the service. Create uses the service
and never overwrites an output file. Review reads {"projectId":"...","bundlePath":"/absolute/file"}.
Import reads the same fields plus "reviewDigest" and "confirmed":true; reuse of
existing skills requires "reuseSkills", and differing reuse requires separate
"differingReuseConfirmed":true. Review, installation and execution are separate
decisions; a digest does not prove a human reviewed the contents.`;

export function cliUsage(): string {
  return `Skill Loom ${packageManifest.version}

Usage:
  skill-loom [options]
  skill-loom bundle inspect --bundle <absolute-path> [--project <absolute-path>]
  skill-loom bundle create (--draft <id> | --project <id> --chain <id>) --output <absolute-path> [--config-dir <path>]
  skill-loom bundle review|import [--config-dir <path>]  # JSON on stdin
  skill-loom catalog --help
  skill-loom discovery --help
  skill-loom service start [--config-dir <path>] [--port <number>]
  skill-loom service status [--config-dir <path>]
  skill-loom service stop [--config-dir <path>]
  skill-loom service --help
  skill-loom edit (--draft <id> | --project <id> --chain <id>) [--no-open] [--port <number>] [--config-dir <path>]
  skill-loom project --help
  skill-loom chain --help
  skill-loom run --help
  skill-loom workspace --help

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

Edit opens the visual chain editor, the only web screen; saving writes to the chain.
Bundle inspection is read-only and returns JSON without starting the server.
Read-only catalog source, limit, and snapshot commands do not start the server.
Catalog mutations and project catalog paging require a running service.
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

export interface EditTarget {
  path: string;
  rest: string[];
}

/** Resolve `edit` arguments to an editor URL path plus the remaining server options. */
export function parseEditArgs(argv: readonly string[]): EditTarget {
  let draft: string | undefined;
  let project: string | undefined;
  let chain: string | undefined;
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const takesValue = argument === '--draft' || argument === '--project' || argument === '--chain';
    if (!takesValue) {
      rest.push(argument);
      if ((argument === '--port' || argument === '--config-dir') && argv[index + 1] !== undefined) {
        rest.push(argv[index + 1]!);
        index += 1;
      }
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      throw new CliUsageError(`${argument} requires an id.`);
    }
    index += 1;
    if (argument === '--draft') draft = value;
    else if (argument === '--project') project = value;
    else chain = value;
  }
  if (draft !== undefined && project === undefined && chain === undefined) {
    return { path: `/drafts/${encodeURIComponent(draft)}`, rest };
  }
  if (draft === undefined && project !== undefined && chain !== undefined) {
    return { path: `/projects/${encodeURIComponent(project)}/chains/${encodeURIComponent(chain)}`, rest };
  }
  throw new CliUsageError('edit needs either --draft <id> or both --project <id> and --chain <id>.');
}

export interface CliStartedServer {
  settings: ServerSettings;
}

export interface RunCliDependencies {
  start?: (options: { logger?: boolean; env?: NodeJS.ProcessEnv; enableControl?: boolean }) => Promise<CliStartedServer>;
  openBrowser?: (url: string) => void;
  /** Local control seam; defaults to the real control transport. */
  controlCall?: (configDirectory: string, operation: string, input: unknown) => Promise<ControlStatusResponse>;
  stdout?: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  env?: NodeJS.ProcessEnv;
  stdin?: Readable;
}

interface ControlStatusResponse {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

function readHttpEndpoint(result: unknown): { host: string; port: number } | null {
  if (typeof result !== 'object' || result === null || !('httpEndpoint' in result)) {
    return null;
  }
  const endpoint = (result as { httpEndpoint?: unknown }).httpEndpoint;
  if (typeof endpoint !== 'object' || endpoint === null) {
    return null;
  }
  const { host, port } = endpoint as { host?: unknown; port?: unknown };
  if (
    typeof host !== 'string' ||
    host === '' ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return null;
  }
  return { host, port };
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: RunCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const env = dependencies.env ?? process.env;

  if ((argv[0] === 'service' || argv[0] === 'bundle') &&
      ((argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')) ||
       (argv.length === 3 && (argv[2] === '--help' || argv[2] === '-h') &&
        (argv[0] === 'service' ? ['start', 'status', 'stop'] : ['inspect', 'create', 'review', 'import']).includes(argv[1] ?? '')))) {
    stdout.write(`${argv[0] === 'service' ? SERVICE_HELP : BUNDLE_HELP}\n`);
    return 0;
  }
  if (argv[0] === 'bundle' && argv[1] === 'inspect') {
    return runPortableCli(['inspect', ...argv.slice(2)], { stdout, stderr });
  }
  if (argv[0] === 'bundle' && argv[1] === 'create') {
    return createBundleCli(argv.slice(2), { stdout, stderr, env });
  }
  if (argv[0] === 'catalog') {
    return runCatalogCli(argv.slice(1), { stdout, stderr, env, stdin: dependencies.stdin ?? process.stdin });
  }
  if (argv[0] === 'project' || argv[0] === 'chain' ||
      (argv[0] === 'bundle' && (argv[1] === 'review' || argv[1] === 'import')) ||
      argv[0] === 'run' || argv[0] === 'workspace' || argv[0] === 'discovery') {
    return runControlCli(argv, { stdout, stderr, env, stdin: dependencies.stdin ?? process.stdin });
  }
  if (argv[0] === 'service' && (argv[1] === 'start' || argv[1] === 'status' || argv[1] === 'stop')) {
    try {
      const options = parseCliArgs(argv.slice(2));
      if (options.help || options.version || (argv[1] !== 'start' && options.port !== undefined)) {
        throw new CliUsageError('Invalid service option.');
      }
      if (options.configDir !== undefined) env.LOOM_CONFIG_DIR = options.configDir;
      if (options.port !== undefined) env.LOOM_PORT = String(options.port);
      if (argv[1] === 'start') {
        const started = await (dependencies.start ?? startServer)({ logger: false, env, enableControl: true });
        stdout.write(`${JSON.stringify({ protocolVersion: 1, ok: true, result: {
          state: 'running', host: started.settings.host, port: started.settings.port,
        } })}\n`);
      } else {
        const response = await callControl(resolveConfigDir({ env }), argv[1] === 'stop' ? 'service.stop' : 'status', {});
        (response.ok ? stdout : stderr).write(`${JSON.stringify(response)}\n`);
        return response.ok ? 0 : 1;
      }
      return 0;
    } catch (error) {
      const code = error instanceof CliUsageError ? 'CLI_USAGE'
        : error instanceof ControlError ? error.code
          : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
            ? error.code : 'SERVICE_START_FAILED';
      const message = error instanceof CliUsageError || error instanceof ControlError || error instanceof WindowsControlSecurityError
        ? error.message : 'The Skill Loom service could not be started.';
      stderr.write(`${JSON.stringify({ protocolVersion: 1, ok: false, error: { code, message } })}\n`);
      return error instanceof CliUsageError ? 2 : 1;
    }
  }

  let editPath: string | undefined;
  let serverArgs = argv;
  if (argv[0] === 'edit') {
    if (argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')) {
      stdout.write(`${cliUsage()}\n`);
      return 0;
    }
    try {
      const target = parseEditArgs(argv.slice(1));
      editPath = target.path;
      serverArgs = target.rest;
    } catch (error) {
      if (error instanceof CliUsageError) {
        stderr.write(`${error.message}\n\n${cliUsage()}\n`);
        return 2;
      }
      throw error;
    }
  }

  let options: CliOptions;
  try {
    options = parseCliArgs(serverArgs);
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

  const configDirectory = resolveConfigDir({ env });

  try {
    let baseUrl: string;
    try {
      const started = await (dependencies.start ?? startServer)({ logger: false });
      baseUrl = `http://${started.settings.host}:${String(started.settings.port)}`;
    } catch (error) {
      const inUse = typeof error === 'object' && error !== null && 'code' in error &&
        (error as { code?: unknown }).code === 'PROFILE_IN_USE';
      if (editPath === undefined || !inUse) throw error;
      // Another process owns the profile. Ask the owner for the endpoint it is
      // actually serving instead of assuming LOOM_PORT matches it.
      const status = await (dependencies.controlCall ?? callControl)(configDirectory, 'status', {});
      if (!status.ok) {
        throw new ControlError(
          status.error?.code ?? 'CONTROL_UNAVAILABLE',
          status.error?.message ?? 'The running Skill Loom service rejected the status request.',
        );
      }
      const endpoint = readHttpEndpoint(status.result);
      if (endpoint === null) {
        throw new ControlError(
          'CONTROL_ENDPOINT_UNAVAILABLE',
          'The running Skill Loom service did not report its editor endpoint. Retry, or pass the same --port the service uses.',
        );
      }
      baseUrl = `http://${endpoint.host}:${String(endpoint.port)}`;
    }
    const url = editPath === undefined ? baseUrl : `${baseUrl}${editPath}`;

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
  if (error instanceof ControlError) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'EADDRINUSE') {
      return 'the configured port is already in use. Choose another port with --port or LOOM_PORT.';
    }
    if (code === 'PROFILE_IN_USE') {
      return 'another Skill Loom process owns this configuration profile. Stop it or use a different --config-dir.';
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
