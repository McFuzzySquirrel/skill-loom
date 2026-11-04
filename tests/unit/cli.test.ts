import { describe, expect, it } from 'vitest';
import packageManifest from '../../package.json' with { type: 'json' };
import {
  CliUsageError,
  cliUsage,
  parseCliArgs,
  runCli,
} from '../../src/server/cli.js';

function captureOutput() {
  let output = '';
  return {
    stream: {
      write(chunk: string | Uint8Array): boolean {
        output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
        return true;
      },
      isTTY: false,
    } as NodeJS.WriteStream,
    read: () => output,
  };
}

describe('CLI argument parsing', () => {
  it('defaults to starting with browser opening enabled', () => {
    expect(parseCliArgs([])).toEqual({
      help: false,
      version: false,
      open: true,
    });
  });

  it('parses help, version, open, port, and config directory flags', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
    expect(parseCliArgs(['--no-open']).open).toBe(false);
    expect(parseCliArgs(['--port', '7400']).port).toBe(7400);
    expect(parseCliArgs(['--port=7401']).port).toBe(7401);
    expect(parseCliArgs(['--config-dir', '.tmp/profile']).configDir).toBe(
      `${process.cwd()}/.tmp/profile`,
    );
    expect(parseCliArgs(['--config-dir=.tmp/profile']).configDir).toBe(
      `${process.cwd()}/.tmp/profile`,
    );
  });

  it('rejects missing or invalid option values', () => {
    expect(() => parseCliArgs(['--port'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--port', '0'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--port', '65536'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--config-dir'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--unknown'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['unexpected'])).toThrow(CliUsageError);
  });
});

describe('CLI output and environment', () => {
  it('prints usage text with the package identity', () => {
    expect(cliUsage()).toContain('Skill Loom');
    expect(cliUsage()).toContain('skill-loom');
    expect(cliUsage()).toContain('LOOM_CONFIG_DIR');
  });

  it('prints help and version without starting the server', async () => {
    const stdout = captureOutput();
    let starts = 0;
    const start = async () => {
      starts += 1;
      return { settings: { host: '127.0.0.1', port: 7373 } };
    };

    expect(await runCli(['--help'], { start, stdout: stdout.stream })).toBe(0);
    expect(stdout.read()).toContain('Usage:');
    expect(await runCli(['--version'], { start, stdout: stdout.stream })).toBe(0);
    expect(stdout.read()).toContain(`Skill Loom ${packageManifest.version}`);
    expect(starts).toBe(0);
  });

  it('applies port and config overrides and prints the loopback URL', async () => {
    const stdout = captureOutput();
    const env: NodeJS.ProcessEnv = {};
    let openUrl: string | null = null;

    const code = await runCli(
      ['--no-open', '--port', '7411', '--config-dir', '.tmp/loom-profile'],
      {
        start: async () => ({ settings: { host: '127.0.0.1', port: 7411 } }),
        openBrowser: (url) => {
          openUrl = url;
        },
        stdout: stdout.stream,
        env,
      },
    );

    expect(code).toBe(0);
    expect(env.LOOM_PORT).toBe('7411');
    expect(env.LOOM_CONFIG_DIR).toContain('.tmp/loom-profile');
    expect(stdout.read()).toContain('URL: http://127.0.0.1:7411');
    expect(openUrl).toBeNull();
  });

  it('reports a port conflict as a typed startup failure', async () => {
    const stderr = captureOutput();
    const code = await runCli(['--no-open'], {
      start: async () => {
        throw Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
      },
      stderr: stderr.stream,
      env: {},
    });

    expect(code).toBe(1);
    expect(stderr.read()).toContain('port is already in use');
  });

  it('returns a usage failure for an invalid flag', async () => {
    const stderr = captureOutput();
    const code = await runCli(['--unknown'], {
      stderr: stderr.stream,
      env: {},
    });

    expect(code).toBe(2);
    expect(stderr.read()).toContain('Unknown option: --unknown');
  });
});
