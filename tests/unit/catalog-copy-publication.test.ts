import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const inspectPublication = vi.hoisted(() => vi.fn<(destination: string) => Promise<void>>());
vi.mock('../../src/portable/install-skill.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/portable/install-skill.js')>();
  return {
    ...original,
    publishSkillEntry: async (...args: Parameters<typeof original.publishSkillEntry>) => {
      await inspectPublication(args[0]);
      return original.publishSkillEntry(...args);
    },
  };
});

import { copyBundledScenarioSkill, copySkillIntoProject } from '../../src/server/catalog/copy.js';
import { scenarioCatalog, scenarioSkillPackagePath } from '../../src/server/chains/presets.js';
import { snapshotPackageFingerprint, snapshotReviewFingerprint } from '../../src/server/catalog/snapshot-fingerprint.js';
import { REMOTE_SNAPSHOT_CONTENT, type SkillEntry } from '../../src/server/catalog/types.js';

const roots: string[] = [];
afterEach(async () => {
  inspectPublication.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('writes bundled attribution before publishing the skill entry', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-copy-publication-')));
  roots.push(root);
  const source = scenarioCatalog.skills.find((item) => item.bundled)!;
  const packagePath = scenarioSkillPackagePath(source.name)!;
  const projectPath = join(root, 'project');
  await mkdir(projectPath);
  const entry: SkillEntry = {
    id: 'bundled', harness: 'opencode', source: 'builtin', name: source.name,
    description: '', path: join(packagePath, 'SKILL.md'), packagePath, enabled: true,
  };
  inspectPublication.mockImplementation(async (destination) => {
    await expect(access(join(destination, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(destination, 'SKILL-LOOM-SOURCE.md'), 'utf8')).toContain(source.revision);
  });
  const result = await copyBundledScenarioSkill({ projectPath, harness: 'opencode', entry, source });
  expect(inspectPublication).toHaveBeenCalledOnce();
  expect(await readFile(join(result.destinationPath, 'SKILL.md'), 'utf8')).not.toBe('');
});

it('does not publish a remote skill when snapshot verification fails', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-copy-publication-')));
  roots.push(root);
  const projectPath = join(root, 'project');
  const packagePath = join(root, 'package');
  await mkdir(projectPath);
  await mkdir(packagePath);
  await writeFile(join(packagePath, 'SKILL.md'), '---\nname: example\n---\nbody\n');
  const entry: SkillEntry = {
    id: 'remote', harness: 'opencode', source: 'remote', name: 'example',
    description: '', path: join(packagePath, 'SKILL.md'), packagePath, enabled: true,
    [REMOTE_SNAPSHOT_CONTENT]: { fingerprint: '0'.repeat(64), reviewFingerprint: '0'.repeat(64), executablePaths: [] },
  };
  await expect(copySkillIntoProject({ projectPath, harness: 'opencode', entry }))
    .rejects.toMatchObject({ code: 'SKILL_SOURCE_UNSAFE' });
  expect(inspectPublication).not.toHaveBeenCalled();
  await expect(access(join(projectPath, '.agents', 'skills', 'example'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('verifies and publishes nested remote skills after their supporting files', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-copy-publication-')));
  roots.push(root);
  const projectPath = join(root, 'project');
  const packagePath = join(root, 'package');
  await mkdir(projectPath);
  await mkdir(join(packagePath, 'nested'), { recursive: true });
  const files = [
    { path: 'SKILL.md', content: Buffer.from('---\nname: example\n---\nbody\n'), executable: false },
    { path: 'nested/SKILL.md', content: Buffer.from('---\nname: nested\n---\nbody\n'), executable: false },
    { path: 'nested/reference.txt', content: Buffer.from('reference'), executable: false },
  ];
  for (const file of files) await writeFile(join(packagePath, ...file.path.split('/')), file.content);
  const entry: SkillEntry = {
    id: 'remote', harness: 'opencode', source: 'remote', name: 'example',
    description: '', path: join(packagePath, 'SKILL.md'), packagePath, enabled: true,
    [REMOTE_SNAPSHOT_CONTENT]: {
      fingerprint: snapshotPackageFingerprint(files),
      reviewFingerprint: snapshotReviewFingerprint(files),
      executablePaths: [],
    },
  };
  const destinations: string[] = [];
  inspectPublication.mockImplementation(async (destination) => {
    destinations.push(destination);
    const packageRoot = join(projectPath, '.agents', 'skills', 'example');
    expect(await readFile(join(packageRoot, 'nested', 'reference.txt'), 'utf8')).toBe('reference');
    await expect(access(join(packageRoot, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (destination === packageRoot) {
      expect(await readFile(join(packageRoot, 'nested', 'SKILL.md'), 'utf8')).toContain('name: nested');
    } else {
      await expect(access(join(packageRoot, 'nested', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
  const result = await copySkillIntoProject({ projectPath, harness: 'opencode', entry });
  expect(destinations).toEqual([join(result.destinationPath, 'nested'), result.destinationPath]);
});
