import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRemoteCloneStagingDirectory,
  listRetainedRemoteClones,
  removeRetainedRemoteClones,
  resolveRetainedRemoteCloneShutdown,
  retainRemoteClone,
} from '../../src/server/catalog/remote-clones.js';

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loom-retained-clone-'));
  roots.push(root);
  return root;
}

async function retainOne(configDirectory: string): Promise<void> {
  const stagingDirectory = await createRemoteCloneStagingDirectory(configDirectory);
  await mkdir(join(stagingDirectory, 'repository', '.git'), { recursive: true });
  await retainRemoteClone(configDirectory, {
    stagingDirectory,
    sourceId: 'source',
    revision: 'a'.repeat(40),
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('retained remote clones', () => {
  it('keeps clones when shutdown is non-interactive and reports their paths', async () => {
    const root = await createRoot();
    const configDirectory = join(root, 'config');
    await retainOne(configDirectory);
    const input = new PassThrough();
    const output = new PassThrough();
    let message = '';
    output.on('data', (chunk: Buffer) => { message += chunk.toString(); });

    await resolveRetainedRemoteCloneShutdown(configDirectory, {
      interactive: false,
      input,
      output,
    });

    expect(await listRetainedRemoteClones(configDirectory)).toHaveLength(1);
    expect(message).toContain('They were kept');
  });

  it('deletes only the owned clones after an explicit interactive yes', async () => {
    const root = await createRoot();
    const configDirectory = join(root, 'config');
    await retainOne(configDirectory);
    const input = new PassThrough();
    const output = new PassThrough();
    let message = '';
    output.on('data', (chunk: Buffer) => { message += chunk.toString(); });
    input.end('y\n');

    await resolveRetainedRemoteCloneShutdown(configDirectory, {
      interactive: true,
      input,
      output,
    });

    expect(await listRetainedRemoteClones(configDirectory)).toEqual([]);
    expect(message).toContain('Pinned snapshots and saved work were not changed');
  });

  it('keeps clones when an interactive user accepts the default answer', async () => {
    const root = await createRoot();
    const configDirectory = join(root, 'config');
    await retainOne(configDirectory);
    const input = new PassThrough();
    const output = new PassThrough();
    input.end('\n');

    await resolveRetainedRemoteCloneShutdown(configDirectory, {
      interactive: true,
      input,
      output,
    });

    expect(await listRetainedRemoteClones(configDirectory)).toHaveLength(1);
  });

  it('does not delete a clone whose Git metadata changed', async () => {
    const root = await createRoot();
    const configDirectory = join(root, 'config');
    await retainOne(configDirectory);
    const clones = await listRetainedRemoteClones(configDirectory);
    const path = clones[0]!.path;
    await rm(path, { recursive: true });
    await mkdir(path);
    await rm(join(path, '.git'), { recursive: true, force: true });
    await expect(removeRetainedRemoteClones(configDirectory)).rejects.toThrow(
      'no safe Git metadata',
    );
  });
});
