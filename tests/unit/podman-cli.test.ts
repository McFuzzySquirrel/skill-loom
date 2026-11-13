import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

  it('copies exact reviewed catalog selections through the selected SSH connection', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-podman-selected-')));
    const projectPath = join(root, 'project');
    await mkdir(projectPath);
    const id = 'opencode-personal-formatting';
    const fingerprint = 'c08d43ccb9598a3f074dd780e160b42900a10dafa2b7ac3ebdb46feb9c51a828';
    const manifest = {
      format: 'skill-loom-project-skills',
      version: 2,
      skills: [{
        id,
        fingerprint,
        name: 'formatting',
        directory: 'formatting',
        files: [
          { path: 'SKILL.md', content: Buffer.from('---\nname: formatting\n---\n').toString('base64'), executable: false },
          { path: 'scripts/check.mjs', content: Buffer.from('process.exitCode = 0;\n').toString('base64'), executable: true },
        ],
      }],
    };
    const output = streams();
    let invokedArgs: string[] = [];
    let remoteInput = '';
    const exitCode = await runPodmanCli(
      ['catalog', 'skills', 'copy-local', '--project', projectPath, '--project-id', 'project-1', '--harness', 'opencode', '--selection', id, fingerprint],
      {
        env: { LOOM_PODMAN_CONNECTION: 'hosted' },
        stdin: { isTTY: false },
        stdout: output.stdout,
        stderr: output.stderr,
        spawnSync: (_command: string, args: string[], options: { input: string }) => {
          invokedArgs = args;
          remoteInput = options.input;
          return { status: 0, stdout: JSON.stringify({ protocolVersion: 1, ok: true, result: manifest }), stderr: '' };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(invokedArgs.slice(0, 3)).toEqual(['--connection', 'hosted', 'exec']);
    expect(invokedArgs.slice(-3)).toEqual(['catalog', 'skill', 'export']);
    expect(remoteInput).toBe(JSON.stringify({ projectId: 'project-1', harness: 'opencode', selections: [{ id, fingerprint }] }));
    expect(remoteInput).not.toContain(projectPath);
    expect(output.errors()).toBe('');
    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      installed: [{ name: 'formatting', destinationPath: join(projectPath, '.agents', 'skills', 'formatting') }],
    });
    expect(await readFile(join(projectPath, '.agents', 'skills', 'formatting', 'SKILL.md'), 'utf8'))
      .toContain('name: formatting');
    expect((await readFile(join(projectPath, '.agents', 'skills', 'formatting', 'scripts', 'check.mjs'))).toString())
      .toContain('exitCode');
    if (process.platform !== 'win32') {
      expect((await stat(join(projectPath, '.agents', 'skills', 'formatting', 'scripts', 'check.mjs'))).mode & 0o111)
        .not.toBe(0);
    }
  });

  it('rejects a selected manifest whose package bytes do not match the reviewed fingerprint before writing', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-podman-fingerprint-')));
    const projectPath = join(root, 'project');
    await mkdir(projectPath);
    const manifest = {
      format: 'skill-loom-project-skills',
      version: 2,
      skills: [{
        id: 'opencode-personal-formatting',
        fingerprint: 'c08d43ccb9598a3f074dd780e160b42900a10dafa2b7ac3ebdb46feb9c51a828',
        name: 'formatting',
        directory: 'formatting',
        files: [{ path: 'SKILL.md', content: Buffer.from('tampered').toString('base64'), executable: false }],
      }],
    };

    await expect(installTransferredSkills(projectPath, manifest, [{
      id: 'opencode-personal-formatting',
      fingerprint: 'c08d43ccb9598a3f074dd780e160b42900a10dafa2b7ac3ebdb46feb9c51a828',
    }])).rejects.toMatchObject({ code: 'TRANSFER_INVALID' });
    await expect(readFile(join(projectPath, '.agents', 'skills', 'formatting', 'SKILL.md')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed selected manifests and aggregate oversize content before project writes', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-podman-selected-invalid-')));
    const projectPath = join(root, 'project');
    await mkdir(projectPath);
    const selection = {
      id: 'opencode-personal-formatting',
      fingerprint: 'c08d43ccb9598a3f074dd780e160b42900a10dafa2b7ac3ebdb46feb9c51a828',
    };
    const malformed = {
      format: 'skill-loom-project-skills',
      version: 2,
      skills: [{
        ...selection,
        name: 'formatting',
        directory: 'formatting',
        files: [{ path: '../SKILL.md', content: '!!!!', executable: false }],
      }],
    };
    expect(() => validateSkillTransfer(malformed, [selection])).toThrow('unsafe package path');
    await expect(installTransferredSkills(projectPath, malformed, [selection])).rejects.toMatchObject({
      code: 'TRANSFER_INVALID',
    });
    await expect(readFile(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });

    const malformedBase64 = {
      ...malformed,
      skills: [{
        ...malformed.skills[0],
        files: [{ path: 'SKILL.md', content: '!!!!', executable: false }],
      }],
    };
    expect(() => validateSkillTransfer(malformedBase64, [selection])).toThrow('invalid package file data');
    await expect(installTransferredSkills(projectPath, malformedBase64, [selection])).rejects.toMatchObject({
      code: 'TRANSFER_INVALID',
    });
    await expect(readFile(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });

    const duplicateIdentity = {
      format: 'skill-loom-project-skills',
      version: 2,
      skills: [
        { ...selection, name: 'formatting', directory: 'formatting', files: validManifest().skills[0]!.files },
        { ...selection, name: 'formatting-copy', directory: 'formatting-copy', files: validManifest().skills[0]!.files },
      ],
    };
    const additionalSelection = { id: 'opencode-personal-other', fingerprint: selection.fingerprint };
    expect(() => validateSkillTransfer(duplicateIdentity, [selection, additionalSelection]))
      .toThrow('invalid skill package entry');
    await expect(installTransferredSkills(projectPath, duplicateIdentity, [selection, additionalSelection]))
      .rejects.toMatchObject({ code: 'TRANSFER_INVALID' });
    await expect(readFile(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });

    const oversized = {
      format: 'skill-loom-project-skills',
      version: 2,
      skills: [{
        ...selection,
        name: 'formatting',
        directory: 'formatting',
        files: [{ path: 'SKILL.md', content: Buffer.alloc(20 * 1024 * 1024 + 1).toString('base64'), executable: false }],
      }],
    };
    expect(() => validateSkillTransfer(oversized, [selection])).toThrow('20 MiB and 2,000 files');
    await expect(readFile(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')('reports earlier successful packages when a later local write fails', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-podman-partial-')));
    const projectPath = join(root, 'project');
    await mkdir(projectPath);
    const firstId = 'opencode-personal-first';
    const secondId = 'opencode-personal-second';
    const firstFingerprint = '86cea88bcfedf4ae0d8ea7073dd4fa835ac327e5b1d49bd919ea9449a636210c';
    const secondFingerprint = '79b59c3f24089e16e3a7007778edf26bd87eb194516871fb198b055b159104d5';
    const skillFile = { path: 'SKILL.md', content: Buffer.from('---\nname: formatting\n---\n').toString('base64'), executable: false };
    const manifest = {
      format: 'skill-loom-project-skills',
      version: 2,
      skills: [
        { id: firstId, fingerprint: firstFingerprint, name: 'first', directory: 'first', files: [skillFile] },
        {
          id: secondId,
          fingerprint: secondFingerprint,
          name: 'second',
          directory: 'second',
          files: [
            skillFile,
            { path: 'a'.repeat(256), content: Buffer.from('x').toString('base64'), executable: false },
          ],
        },
      ],
    };
    const selections = [
      { id: firstId, fingerprint: firstFingerprint },
      { id: secondId, fingerprint: secondFingerprint },
    ];
    const output = streams();
    const exitCode = await runPodmanCli(
      ['catalog', 'skills', 'copy-local', '--project', projectPath, '--project-id', 'project-1', '--harness', 'opencode',
        '--selection', firstId, firstFingerprint, '--selection', secondId, secondFingerprint],
      {
        env: {},
        stdin: { isTTY: false },
        stdout: output.stdout,
        stderr: output.stderr,
        spawnSync: () => ({ status: 0, stdout: JSON.stringify({ protocolVersion: 1, ok: true, result: manifest }), stderr: '' }),
      },
    );

    expect(exitCode).toBe(1);
    expect(output.output()).toBe('');
    expect(JSON.parse(output.errors())).toMatchObject({
      ok: false,
      error: {
        code: 'LOCAL_INSTALL_FAILED',
        details: {
          failedSkill: 'second',
          partialSuccess: true,
          cleanupIncomplete: false,
          installed: [{ name: 'first', destinationPath: join(projectPath, '.agents', 'skills', 'first') }],
        },
      },
    });
    expect(await readFile(join(projectPath, '.agents', 'skills', 'first', 'SKILL.md'), 'utf8'))
      .toContain('name: formatting');
    await expect(readFile(join(projectPath, '.agents', 'skills', 'second', 'SKILL.md')))
      .rejects.toMatchObject({ code: 'ENOENT' });
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

  it('refuses a symlink at a selected-skill destination', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'loom-podman-symlink-destination-')));
    const projectPath = join(root, 'project');
    const outside = join(root, 'outside');
    const destination = join(projectPath, '.agents', 'skills', 'formatting');
    await mkdir(projectPath);
    await mkdir(outside);
    await mkdir(join(projectPath, '.agents', 'skills'), { recursive: true });
    await writeFile(join(outside, 'marker.txt'), 'unchanged\n');
    await symlink(outside, destination);
    const id = 'opencode-personal-formatting';
    const fingerprint = 'c08d43ccb9598a3f074dd780e160b42900a10dafa2b7ac3ebdb46feb9c51a828';
    const manifest = {
      format: 'skill-loom-project-skills',
      version: 2,
      skills: [{
        id, fingerprint, name: 'formatting', directory: 'formatting',
        files: [
          { path: 'SKILL.md', content: Buffer.from('---\nname: formatting\n---\n').toString('base64'), executable: false },
          { path: 'scripts/check.mjs', content: Buffer.from('process.exitCode = 0;\n').toString('base64'), executable: true },
        ],
      }],
    };

    await expect(installTransferredSkills(projectPath, manifest, [{ id, fingerprint }]))
      .rejects.toMatchObject({ code: 'DESTINATION_CONFLICT' });
    expect(await readFile(join(outside, 'marker.txt'), 'utf8')).toBe('unchanged\n');
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
