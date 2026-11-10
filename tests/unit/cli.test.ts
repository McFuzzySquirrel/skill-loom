import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { snapshotReviewFingerprint } from '../../src/server/catalog/snapshot-fingerprint.js';
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
      join(process.cwd(), '.tmp', 'profile'),
    );
    expect(parseCliArgs(['--config-dir=.tmp/profile']).configDir).toBe(
      join(process.cwd(), '.tmp', 'profile'),
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
  it('lists catalog defaults without creating a profile or starting a server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-cli-catalog-'));
    try {
      const stdout = captureOutput();
      const stderr = captureOutput();
      const code = await runCli(['catalog', 'source', 'list'], {
        stdout: stdout.stream,
        stderr: stderr.stream,
        env: { LOOM_CONFIG_DIR: join(root, 'missing') },
        start: async () => { throw new Error('must not start the server'); },
      });
      expect(code).toBe(0);
      expect(JSON.parse(stdout.read())).toEqual({ protocolVersion: 1, ok: true, result: { sources: [] } });
      expect(stderr.read()).toBe('');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists and searches pinned snapshot pages without changing the saved files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-cli-catalog-pages-'));
    try {
      const revision = 'a'.repeat(40);
      const snapshotDirectory = join(root, 'catalog-sources', 'source', revision);
      await mkdir(snapshotDirectory, { recursive: true });
      const snapshot = {
        version: 1,
        sourceId: 'source',
        repository: 'https://example.invalid/skills.git',
        revision,
        packages: ['zulu', 'alpha'].map((name) => ({
          name, description: `${name} skill`, repositoryPath: name,
          directory: 'b'.repeat(64), files: 1, bytes: 10, fingerprint: 'c'.repeat(64),
        })),
        agents: [],
      };
      await writeFile(join(snapshotDirectory, 'snapshot.json'), JSON.stringify(snapshot));
      const stdout = captureOutput();
      const stderr = captureOutput();
      const env = { LOOM_CONFIG_DIR: root };
      expect(await runCli([
        'catalog', 'snapshot', 'page', '--source', 'source', '--revision', revision,
        '--kind', 'skill', '--search', 'SKILL', '--limit', '1',
      ], { stdout: stdout.stream, stderr: stderr.stream, env })).toBe(0);
      expect(JSON.parse(stdout.read())).toMatchObject({
        ok: true, protocolVersion: 1,
        result: { revision, total: 2, nextOffset: 1, items: [{ name: 'alpha' }] },
      });
      expect(stderr.read()).toBe('');
      expect(await readdir(root)).toEqual(['catalog-sources']);

      const failure = captureOutput();
      const empty = captureOutput();
      expect(await runCli([
        'catalog', 'snapshot', 'list', '--source', '../escape',
      ], { stdout: empty.stream, stderr: failure.stream, env })).toBe(1);
      expect(JSON.parse(failure.read())).toMatchObject({ ok: false, error: { code: 'REMOTE_SOURCE_NOT_FOUND' } });
      expect(empty.read()).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('locates an exact pinned candidate only after verifying its content', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-cli-catalog-inspect-')));
    try {
      const revision = 'a'.repeat(40);
      const directory = 'b'.repeat(64);
      const snapshotDirectory = join(root, 'catalog-sources', 'source', revision);
      const packageDirectory = join(snapshotDirectory, 'packages', directory);
      const content = Buffer.from('---\nname: alpha\n---\nReview.\n');
      const fingerprint = createHash('sha256').update('SKILL.md\0-\0').update(content).digest('hex');
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(join(packageDirectory, 'SKILL.md'), content);
      await mkdir(join(snapshotDirectory, 'modes'));
      await writeFile(join(snapshotDirectory, 'modes', `${directory}.review.json`), JSON.stringify({
        version: 1,
        fingerprint: snapshotReviewFingerprint([{ path: 'SKILL.md', executable: false, content }]),
      }));
      await writeFile(join(snapshotDirectory, 'modes', `${directory}.json`), JSON.stringify({
        version: 1, executablePaths: [],
      }));
      await writeFile(join(snapshotDirectory, 'snapshot.json'), JSON.stringify({
        version: 1, sourceId: 'source', repository: 'https://example.invalid/skills.git', revision,
        packages: [{ name: 'alpha', description: '', repositoryPath: 'skills/alpha',
          directory, files: 1, bytes: content.length, fingerprint }], agents: [],
      }));
      const args = ['catalog', 'snapshot', 'inspect', '--source', 'source', '--revision', revision,
        '--kind', 'skill', '--path', 'skills/alpha'];
      const stdout = captureOutput();
      const stderr = captureOutput();
      const env = { LOOM_CONFIG_DIR: root };
      expect(await runCli(args, { stdout: stdout.stream, stderr: stderr.stream, env })).toBe(0);
      expect(JSON.parse(stdout.read())).toMatchObject({
        ok: true, result: { revision, kind: 'skill', path: packageDirectory,
          candidate: { repositoryPath: 'skills/alpha', fingerprint } },
      });
      await writeFile(join(packageDirectory, 'SKILL.md'), 'changed');
      const failure = captureOutput();
      expect(await runCli(args, { stdout: captureOutput().stream, stderr: failure.stream, env })).toBe(1);
      expect(JSON.parse(failure.read())).toMatchObject({ ok: false, error: { code: 'REMOTE_SOURCE_SNAPSHOT_CORRUPT' } });
      expect(await readdir(root)).toEqual(['catalog-sources']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('inspects a bundle without starting the server or modifying the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-cli-inspect-'));
    try {
      const bundlePath = join(root, 'example.loom.json');
      await writeFile(bundlePath, JSON.stringify({
        format: 'skill-loom-chain',
        version: 1,
        chain: {
          name: 'Example',
          harness: 'copilot',
          sessionMode: 'shared',
          steps: [{ id: 'one', kind: 'instruction', instruction: 'Review the task.' }],
          inputs: [],
        },
        skills: [],
      }));
      const stdout = captureOutput();
      const stderr = captureOutput();
      let starts = 0;
      const code = await runCli(['bundle', 'inspect', '--bundle', bundlePath, '--project', root], {
        stdout: stdout.stream,
        stderr: stderr.stream,
        start: async () => {
          starts += 1;
          return { settings: { host: '127.0.0.1', port: 7373 } };
        },
      });
      expect(code).toBe(0);
      expect(starts).toBe(0);
      expect(stderr.read()).toBe('');
      expect(JSON.parse(stdout.read())).toMatchObject({
        ok: true,
        chain: { name: 'Example' },
        skills: [],
        agents: [],
      });
      expect(await readdir(root)).toEqual(['example.loom.json']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports invalid bundle inspection without starting the server', async () => {
    const stdout = captureOutput();
    const stderr = captureOutput();
    const code = await runCli(['bundle', 'inspect', '--bundle', 'relative.json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(code).toBe(1);
    expect(stdout.read()).toBe('');
    expect(JSON.parse(stderr.read())).toMatchObject({
      ok: false,
      error: { code: 'BUNDLE_PATH_INVALID' },
    });
  });

  it('prints usage text with the package identity', () => {
    expect(cliUsage()).toContain('Skill Loom');
    expect(cliUsage()).toContain('skill-loom');
    expect(cliUsage()).toContain('LOOM_CONFIG_DIR');
    expect(cliUsage()).toContain('Catalog mutations and project catalog paging require a running service.');
  });

  it('shows group and command help without reading stdin or starting the service', async () => {
    for (const [args, expected] of [
      [['service', '--help'], 'normal stop refuses'],
      [['service', 'start', '--help'], 'explicitly owns the profile'],
      [['bundle', '--help'], 'differingReuseConfirmed'],
      [['bundle', 'inspect', '--help'], 'Inspect is read-only'],
      [['bundle', 'review', '--help'], 'reviewDigest'],
      [['run', 'start', '--help'], 'Skill-bearing managed CLI starts remain blocked'],
      [['workspace', 'evaluate', '-h'], 'not an OS'],
      [['chain', 'draft', 'create', '--help'], 'Validate checks the chain model only'],
      [['catalog', 'snapshot', 'page', '--help'], 'Project catalog discovery'],
      [['catalog', 'snapshot', '-h'], 'snapshot page'],
      [['project', '-h'], 'Coordination review'],
    ] as const) {
      const stdout = captureOutput();
      const stderr = captureOutput();
      let starts = 0;
      const stdin = new Readable({
        read() { throw new Error('Help must not read stdin.'); },
      });
      expect(await runCli(args, {
        env: {}, stdin, stdout: stdout.stream, stderr: stderr.stream,
        start: async () => { starts += 1; throw new Error('Help must not start a service.'); },
      })).toBe(0);
      expect(stdout.read()).toContain(expected);
      expect(stderr.read()).toBe('');
      expect(starts).toBe(0);
    }
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
    expect(env.LOOM_CONFIG_DIR).toBe(join(process.cwd(), '.tmp', 'loom-profile'));
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
