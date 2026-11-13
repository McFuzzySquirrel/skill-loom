import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createPodmanPlan } from '../../scripts/podman.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function podmanPlan(args: string[], env: NodeJS.ProcessEnv = {}): {
  commands: string[][];
  configVolume: string;
  skillsDirectory: string;
  projectDirectory: string;
  port: number;
  privateNetwork: boolean;
} {
  const output = execFileSync(
    process.execPath,
    [join(root, 'scripts', 'podman.mjs'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  return JSON.parse(output) as ReturnType<typeof podmanPlan>;
}

describe('Podman deployment plan', () => {
  it('uses a persistent config volume and global skills mount with loopback-only publishing', () => {
    const skillsDirectory = join(homedir(), 'loom-skills-test');
    const projectDirectory = join(homedir(), 'loom-project-test');
    const plan = podmanPlan(['plan', '--dry-run'], {
      LOOM_SKILLS_DIR: skillsDirectory,
      LOOM_PROJECT_DIR: projectDirectory,
    });

    expect(plan.configVolume).toBe('skill-loom-config');
    expect(plan.skillsDirectory).toBe(resolve(skillsDirectory));
    expect(plan.projectDirectory).toBe(resolve(projectDirectory));
    expect(plan.commands).toContainEqual([
      'pod', 'create', '--name', 'skill-loom', '--userns=keep-id:uid=1000,gid=1000',
      '--publish', '127.0.0.1:4317:8080',
    ]);
    expect(plan.commands).toContainEqual(['volume', 'create', 'skill-loom-config']);
    expect(plan.commands.flat().join(' ')).toContain(`src=${resolve(skillsDirectory)},dst=/var/lib/loom/skills,ro`);
    expect(plan.commands.flat().join(' ')).toContain('type=volume,source=skill-loom-config,destination=/var/lib/loom/config');
  });

  it('does not publish a host port for a private-network deployment', () => {
    const plan = podmanPlan(['plan', '--private-network'], {
      LOOM_PODMAN_PORT: '5317',
    });

    expect(plan.privateNetwork).toBe(true);
    expect(plan.port).toBe(5317);
    expect(plan.commands.find((command) => command[0] === 'pod')).toEqual([
      'pod', 'create', '--name', 'skill-loom', '--userns=keep-id:uid=1000,gid=1000',
    ]);
  });

  it('starts Podman Machine on macOS and Windows and honors explicit target architectures', () => {
    for (const platform of ['darwin', 'win32']) {
      const plan = createPodmanPlan({
        platform,
        env: { LOOM_PODMAN_PLATFORM: 'linux/arm64' },
      });
      expect(plan.commands[0]).toEqual(['machine', 'start']);
      expect(plan.commands[1]).toContain('--platform');
      expect(plan.commands[1]).toContain('linux/arm64');
    }

    const linux = createPodmanPlan({ platform: 'linux', env: { LOOM_PODMAN_PLATFORM: 'linux/amd64' } });
    expect(linux.commands[0]?.[0]).toBe('build');
    expect(linux.commands[0]).toContain('linux/amd64');
  });

  it('rejects invalid platform, port, and bind-mount paths', () => {
    expect(() => podmanPlan(['plan'], { LOOM_PODMAN_PLATFORM: 'windows/amd64' })).toThrow(
      'LOOM_PODMAN_PLATFORM',
    );
    expect(() => podmanPlan(['plan'], { LOOM_PODMAN_PORT: '0' })).toThrow(
      'LOOM_PODMAN_PORT',
    );
    expect(() => podmanPlan(['plan'], { LOOM_SKILLS_DIR: 'comma,path' })).toThrow(
      'bind-mount paths',
    );
  });
});
