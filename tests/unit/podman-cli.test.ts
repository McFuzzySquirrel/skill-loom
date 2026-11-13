import { describe, expect, it } from 'vitest';
import { createPodmanCliArgs } from '../../src/server/podman-cli.js';

describe('Podman CLI bridge', () => {
  it('forwards CLI args and stdin without a shell', () => {
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
});
