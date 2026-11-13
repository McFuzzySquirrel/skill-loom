import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPodmanCliArgs,
  installTransferredSkills,
  runPodmanCli,
  validateSkillTransfer,
} from '../../.github/skills/loom-chain-workflow/scripts/skill-loom-podman.mjs';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

function streams() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: { write: (text: string) => { stdout += text; return true; }, isTTY: false },
    stderr: { write: (text: string) => { stderr += text; return true; } },
    output: () => stdout,
    errors: () => stderr,
  };
}

function validManifest() {
  return {
    format: 'skill-loom-project-skills',
    version: 1,
    skills: [{
      name: 'formatting',
      directory: 'formatting',
      files: [
        { path: 'SKILL.md', content: Buffer.from('---\nname: formatting\n---\n').toString('base64'), executable: false },
        { path: 'scripts/check.mjs', content: Buffer.from('process.exitCode = 0;\n').toString('base64'), executable: true },
      ],
    }],
  };
}

describe('Portable Podman CLI bridge', () => {
  it('forwards CLI args and stdin without a shell, with an explicit remote connection when configured', () => {
    expect(createPodmanCliArgs(['chain', 'project', 'apply'], false)).toEqual([
      'exec',
      '--interactive',
      'skill-loom-app',
      'node',
      '/app/dist/src/server/cli.js',
      'chain',
      'project',
      'apply',
    ]);
    expect(createPodmanCliArgs(['chain', 'project', 'apply'], false, 'hosted')).toEqual([
      '--connection',
      'hosted',
      'exec',
      '--interactive',
      'skill-loom-app',
      'node',
      '/app/dist/src/server/cli.js',
      'chain',
      'project',
      'apply',
    ]);
  });

  it('allocates a container TTY only for an interactive terminal', () => {
    expect(createPodmanCliArgs(['run', 'attach', '--run', 'run-1'], true)).toContain('--tty');
    expect(createPodmanCliArgs(['run', 'attach', '--run', 'run-1'], false)).not.toContain('--tty');
  });

  it('keeps service lifecycle under Podman deployment management', () => {
    expect(() => createPodmanCliArgs(['service', 'start'], false)).toThrow('podman:up');
    expect(() => createPodmanCliArgs(['service', 'stop'], false)).toThrow('podman:up');
    expect(createPodmanCliArgs(['service', 'status'], false)).toContain('status');
  });

  it('uses the selected SSH connection and keeps client project paths out of the remote request', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-podman-client-')));
    const projectPath = join(root, 'project');
    await mkdir(projectPath);
    const output = streams();
    let invokedArgs: string[] = [];
    let remoteInput = '';
    const exitCode = await runPodmanCli(
      ['chain', 'project', 'apply-local', '--project', projectPath, '--project-id', 'project-1', '--chain-id', 'chain-1'],
      {
        env: { LOOM_PODMAN_CONNECTION: 'hosted' },
        stdin: { isTTY: false },
        stdout: output.stdout,
        stderr: output.stderr,
        spawnSync: (_command: string, args: string[], options: { input: string }) => {
          invokedArgs = args;
          remoteInput = options.input;
          return {
            status: 0,
            stdout: JSON.stringify({ protocolVersion: 1, ok: true, result: validManifest() }),
            stderr: '',
          };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(invokedArgs.slice(0, 3)).toEqual(['--connection', 'hosted', 'exec']);
    expect(invokedArgs.slice(-3)).toEqual(['chain', 'project', 'export']);
    expect(remoteInput).toBe(JSON.stringify({ projectId: 'project-1', chainId: 'chain-1' }));
    expect(remoteInput).not.toContain(projectPath);
    expect(output.errors()).toBe('');
    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      installed: [{ name: 'formatting', destinationPath: join(projectPath, '.agents', 'skills', 'formatting') }],
    });
    expect(await readFile(join(projectPath, '.agents', 'skills', 'formatting', 'SKILL.md'), 'utf8'))
      .toContain('name: formatting');
    expect(await readFile(join(projectPath, '.agents', 'skills', 'formatting', 'scripts', 'check.mjs'), 'utf8'))
      .toContain('exitCode');
  });

  it('validates the entire transfer before writing and refuses traversal', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-podman-transfer-')));
    const projectPath = join(root, 'project');
    await mkdir(projectPath);
    const manifest = validManifest();
    manifest.skills[0]!.files[1]!.path = '../outside.mjs';

    expect(() => validateSkillTransfer(manifest)).toThrow('unsafe package path');
    await expect(installTransferredSkills(projectPath, manifest)).rejects.toMatchObject({
      code: 'TRANSFER_INVALID',
    });
    await expect(readFile(join(root, 'outside.mjs'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(projectPath, '.agents', 'skills', 'formatting', 'SKILL.md')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite an existing client skill', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-podman-conflict-')));
    const projectPath = join(root, 'project');
    const existing = join(projectPath, '.agents', 'skills', 'formatting');
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, 'SKILL.md'), 'Existing package\n');

    await expect(installTransferredSkills(projectPath, validManifest())).rejects.toMatchObject({
      code: 'DESTINATION_CONFLICT',
    });
    expect(await readFile(join(existing, 'SKILL.md'), 'utf8')).toBe('Existing package\n');
  });

  it('does not fall back to local Podman when a selected remote connection fails', async () => {
    const output = streams();
    let calls = 0;
    const exitCode = await runPodmanCli(['project', 'list'], {
      env: { LOOM_PODMAN_CONNECTION: 'hosted' },
      stdin: { isTTY: false },
      stdout: output.stdout,
      stderr: output.stderr,
      spawnSync: (_command: string, args: string[]) => {
        calls += 1;
        expect(args.slice(0, 2)).toEqual(['--connection', 'hosted']);
        return { status: 125, stderr: 'remote unavailable\n' };
      },
    });

    expect(exitCode).toBe(125);
    expect(calls).toBe(1);
    expect(output.errors()).toBe('');
  });
});
