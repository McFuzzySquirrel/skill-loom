import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPodmanHostPlan,
  createQuadletFiles,
  runPodmanHost,
} from '../../scripts/podman-host.mjs';

describe('Persistent Podman host deployment', () => {
  it('creates a rootless SSH-only Quadlet deployment with persistent and scoped mounts', () => {
    const files = createQuadletFiles({
      homeDirectory: '/srv/loom',
      skillsDirectory: '/srv/loom/skills',
      projectDirectory: '/srv/loom/workspace',
      caddyFile: '/opt/skill-loom/container/Caddyfile',
      imageTag: '0123456789ab',
    });

    expect(files['skill-loom.pod']).toContain('PodName=skill-loom');
    expect(files['skill-loom.pod']).toContain('UserNS=keep-id:uid=1000,gid=1000');
    expect(files['skill-loom.pod']).not.toContain('PublishPort=');
    expect(files['skill-loom-config.volume']).toContain('VolumeName=skill-loom-config');
    expect(files['skill-loom-app.container']).toContain('Image=localhost/skill-loom:0123456789ab');
    expect(files['skill-loom-app.container']).toContain('Volume=skill-loom-config.volume:/var/lib/loom/config');
    expect(files['skill-loom-app.container']).toContain('Volume=/srv/loom/skills:/var/lib/loom/skills:ro');
    expect(files['skill-loom-app.container']).toContain('Volume=/srv/loom/workspace:/workspace');
    expect(files['skill-loom-app.container']).toContain('Restart=on-failure');
    expect(files['skill-loom-proxy.container']).toContain('Volume=/opt/skill-loom/container/Caddyfile:/etc/caddy/Caddyfile:ro');
  });

  it('allows only an optional loopback host port and validates host paths and image tags', () => {
    const files = createQuadletFiles({ hostPort: 4317, imageTag: '0123456789ab' });
    expect(files['skill-loom.pod']).toContain('PublishPort=127.0.0.1:4317:8080');
    expect(() => createQuadletFiles({ hostPort: 0 })).toThrow('LOOM_PODMAN_HOST_PORT');
    expect(() => createQuadletFiles({ skillsDirectory: 'relative/path' })).toThrow('LOOM_SKILLS_DIR');
    expect(() => createQuadletFiles({ skillsDirectory: '/srv/loom/skill files' })).toThrow('LOOM_SKILLS_DIR');
    expect(() => createQuadletFiles({ projectDirectory: '/srv/loom/work,space' })).toThrow('Quadlet volume');
    expect(() => createQuadletFiles({ imageTag: 'latest;rm' })).toThrow('Image tags');
  });

  it('plans immutable image builds and a dedicated systemd user unit set', () => {
    const plan = createPodmanHostPlan({
      env: {
        HOME: '/srv/loom',
        LOOM_SKILLS_DIR: '/srv/loom/skills',
        LOOM_PROJECT_DIR: '/srv/loom/workspace',
        LOOM_PODMAN_HOST_PORT: '4317',
      },
      imageTag: '0123456789ab',
      repositoryRoot: '/opt/skill-loom',
    });

    expect(plan.image).toBe('localhost/skill-loom:0123456789ab');
    expect(plan.unitDirectory).toBe('/srv/loom/.config/containers/systemd');
    expect(plan.buildArgs).toEqual([
      'build',
      '--tag',
      'localhost/skill-loom:0123456789ab',
      '--file',
      '/opt/skill-loom/Containerfile',
      '/opt/skill-loom',
    ]);
    expect(plan.startUnits).toEqual(['skill-loom-app.service', 'skill-loom-proxy.service']);
    expect(plan.files['skill-loom.pod']).toContain('PublishPort=127.0.0.1:4317:8080');
  });

  it('manages the service through argument arrays and checks the in-container CLI health', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const output = { write: (_text: string) => true };
    const result = await runPodmanHost(['start'], {
      env: { HOME: '/srv/loom', SYSTEMCTL: 'systemctl', PODMAN: 'podman' },
      platform: 'linux',
      uid: 1000,
      homeDirectory: '/srv/loom',
      stdout: output,
      stderr: output,
      spawnSync: (command, args) => {
        calls.push({ command, args });
        return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
      },
    });

    expect(result).toBe(0);
    expect(calls).toEqual([
      { command: 'systemctl', args: ['--user', 'start', 'skill-loom-app.service', 'skill-loom-proxy.service'] },
      { command: 'podman', args: ['exec', 'skill-loom-app', 'node', '/app/dist/src/server/cli.js', 'service', 'status'] },
    ]);
  });

  it('installs the generated units and starts the app only after host preflight', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-loom-host-test-'));
    try {
      const calls: Array<{ command: string; args: string[] }> = [];
      const env = {
        HOME: root,
        XDG_CONFIG_HOME: join(root, '.config'),
        XDG_STATE_HOME: join(root, '.state'),
        LOOM_SKILLS_DIR: join(root, 'skills'),
        LOOM_PROJECT_DIR: join(root, 'workspace'),
        PODMAN: 'podman-test',
        SYSTEMCTL: 'systemctl-test',
        LOGINCTL: 'loginctl-test',
        GIT: 'git-test',
        USER: 'loom',
      };
      const output = { write: (_text: string) => true };
      const result = await runPodmanHost(['install'], {
        env,
        platform: 'linux',
        uid: 1000,
        homeDirectory: root,
        repositoryRoot: '/opt/skill-loom',
        stdout: output,
        stderr: output,
        spawnSync: (command, args) => {
          calls.push({ command, args });
          if (command === 'podman-test' && args[0] === '--version') {
            return { status: 0, stdout: 'podman version 5.7.0', stderr: '' };
          }
          if (command === 'podman-test' && args[0] === 'info') {
            return { status: 0, stdout: '2', stderr: '' };
          }
          if (command === 'loginctl-test') return { status: 0, stdout: 'yes', stderr: '' };
          if (command === 'git-test' && args[0] === 'rev-parse') {
            return { status: 0, stdout: '0123456789ab', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        },
      });

      expect(result).toBe(0);
      expect(readFileSync(join(root, '.config/containers/systemd/skill-loom-app.container'), 'utf8'))
        .toContain('Image=localhost/skill-loom:0123456789ab');
      expect(calls).toContainEqual({
        command: 'systemctl-test',
        args: ['--user', 'start', 'skill-loom-app.service', 'skill-loom-proxy.service'],
      });
      expect(calls.at(-1)).toEqual({
        command: 'podman-test',
        args: ['exec', 'skill-loom-app', 'node', '/app/dist/src/server/cli.js', 'service', 'status'],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('updates to a commit-tagged image and restores the retained app unit on rollback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-loom-update-test-'));
    try {
      const unitDirectory = join(root, '.config/containers/systemd');
      const stateDirectory = join(root, '.local/state/skill-loom-host');
      const files = createQuadletFiles({
        homeDirectory: root,
        skillsDirectory: join(root, 'skills'),
        projectDirectory: join(root, 'workspace'),
        caddyFile: join(root, 'Caddyfile'),
        imageTag: '0123456789ab',
      });
      mkdirSync(unitDirectory, { recursive: true });
      const appUnit = join(unitDirectory, 'skill-loom-app.container');
      const previousUnit = files['skill-loom-app.container'];
      if (previousUnit === undefined) throw new Error('Expected the generated app Quadlet.');
      const updatedUnit = previousUnit.replace('0123456789ab', 'abcdef123456');
      writeFileSync(appUnit, previousUnit);
      const env = {
        HOME: root,
        XDG_CONFIG_HOME: join(root, '.config'),
        XDG_STATE_HOME: join(root, '.local/state'),
        LOOM_SKILLS_DIR: join(root, 'skills'),
        LOOM_PROJECT_DIR: join(root, 'workspace'),
        PODMAN: 'podman-test',
        SYSTEMCTL: 'systemctl-test',
        LOGINCTL: 'loginctl-test',
        GIT: 'git-test',
        USER: 'loom',
      };
      const output = { write: (_text: string) => true };
      const dependencies = {
        env,
        platform: 'linux' as const,
        uid: 1000,
        homeDirectory: root,
        repositoryRoot: '/opt/skill-loom',
        stdout: output,
        stderr: output,
        spawnSync: (command: string, args: string[]) => {
          if (command === 'podman-test' && args[0] === '--version') {
            return { status: 0, stdout: 'podman version 5.7.0', stderr: '' };
          }
          if (command === 'podman-test' && args[0] === 'info') {
            return { status: 0, stdout: '2', stderr: '' };
          }
          if (command === 'loginctl-test') return { status: 0, stdout: 'yes', stderr: '' };
          if (command === 'git-test' && args[0] === 'rev-parse') {
            return { status: 0, stdout: 'abcdef123456', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        },
      };

      expect(await runPodmanHost(['update'], dependencies)).toBe(0);
      expect(readFileSync(appUnit, 'utf8')).toBe(updatedUnit);
      expect(readFileSync(join(stateDirectory, 'skill-loom-app.container'), 'utf8')).toBe(previousUnit);

      expect(await runPodmanHost(['rollback'], dependencies)).toBe(0);
      expect(readFileSync(appUnit, 'utf8')).toBe(previousUnit);
      expect(readFileSync(join(stateDirectory, 'skill-loom-app.container'), 'utf8')).toBe(updatedUnit);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('backs up only a stopped service volume and refuses to overwrite an archive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-loom-backup-test-'));
    try {
      const destination = join(root, 'config.tar');
      const output = { write: (_text: string) => true };
      const errors: string[] = [];
      const calls: Array<{ command: string; args: string[] }> = [];
      let serviceActive = false;
      const dependencies = {
        env: {
          HOME: root,
          SYSTEMCTL: 'systemctl-test',
          PODMAN: 'podman-test',
        },
        platform: 'linux' as const,
        uid: 1000,
        homeDirectory: root,
        stdout: output,
        stderr: { write: (text: string) => { errors.push(text); return true; } },
        spawnSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          if (command === 'podman-test' && args[0] === 'volume' && args[1] === 'export') {
            const exportPath = args[4];
            if (exportPath === undefined) throw new Error('Expected a temporary backup path.');
            writeFileSync(exportPath, 'archive');
          }
          return {
            status: command === 'systemctl-test' ? (serviceActive ? 0 : 3) : 0,
            stdout: '',
            stderr: '',
          };
        },
      };

      const backupResult = await runPodmanHost(['backup', '--output', destination], dependencies);
      expect(errors).toEqual([]);
      expect(backupResult).toBe(0);
      const exportCall = calls.at(-1);
      expect(exportCall?.command).toBe('podman-test');
      expect(exportCall?.args.slice(0, 4)).toEqual([
        'volume',
        'export',
        'skill-loom-config',
        '--output',
      ]);
      expect(exportCall?.args[4]?.startsWith(`${destination}.`)).toBe(true);
      expect(exportCall?.args[4]?.endsWith('.tmp')).toBe(true);
      expect(readFileSync(destination, 'utf8')).toBe('archive');
      expect(statSync(destination).mode & 0o777).toBe(0o600);

      writeFileSync(destination, 'existing backup');
      calls.length = 0;
      expect(await runPodmanHost(['backup', '--output', destination], dependencies)).toBe(1);
      expect(calls).toEqual([]);

      serviceActive = true;
      const activeDestination = join(root, 'active.tar');
      expect(await runPodmanHost(['backup', '--output', activeDestination], dependencies)).toBe(1);
      expect(calls).toHaveLength(1);
      expect(errors.at(-1)).toContain('Stop Skill Loom');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses host operations outside Linux and under a root account', async () => {
    const output = { write: (_text: string) => true };
    const errors: string[] = [];
    const result = await runPodmanHost(['start'], {
      env: { HOME: '/srv/loom' },
      platform: 'darwin',
      uid: 1000,
      homeDirectory: '/srv/loom',
      stdout: output,
      stderr: { write: (text: string) => { errors.push(text); return true; } },
      spawnSync: () => ({ status: 0 }),
    });

    expect(result).toBe(1);
    expect(errors.join('')).toContain('requires Linux with systemd');

    errors.length = 0;
    const rootResult = await runPodmanHost(['start'], {
      env: { HOME: '/srv/loom' },
      platform: 'linux',
      uid: 0,
      homeDirectory: '/srv/loom',
      stdout: output,
      stderr: { write: (text: string) => { errors.push(text); return true; } },
      spawnSync: () => ({ status: 0 }),
    });

    expect(rootResult).toBe(1);
    expect(errors.join('')).toContain('dedicated non-root Podman account');
  });
});
