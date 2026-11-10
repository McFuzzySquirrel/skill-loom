import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readGitExecutablePaths } from '../../src/server/chains/git-file-modes.js';

let root: string;
let skill: string;

function git(...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-git-modes-')));
  skill = join(root, 'skills', 'example');
  await mkdir(join(skill, 'scripts'), { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), 'instructions\n');
  await writeFile(join(skill, 'scripts', 'run.sh'), 'echo example\n');
  git('init', '--quiet');
  git('add', '--', 'skills');
  git('update-index', '--chmod=+x', '--', 'skills/example/scripts/run.sh');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('Git package executable modes', () => {
  it('reads the index relative to a nested package, independent of filesystem chmod', async () => {
    vi.stubEnv('GIT_INDEX_FILE', join(root, 'other-index'));
    const result = await readGitExecutablePaths(skill, ['SKILL.md', 'scripts/run.sh']);
    expect([...result]).toEqual(['scripts/run.sh']);
  });

  it('rejects conflicted index entries instead of choosing a stage', async () => {
    const path = 'skills/example/scripts/run.sh';
    const object = execFileSync('git', ['-C', root, 'hash-object', '-w', '--', path], { encoding: 'utf8' }).trim();
    git('update-index', '--force-remove', '--', path);
    execFileSync('git', ['-C', root, 'update-index', '--index-info'], {
      input: `100755 ${object} 1\t${path}\n100755 ${object} 2\t${path}\n`,
    });
    await expect(readGitExecutablePaths(skill, ['scripts/run.sh']))
      .rejects.toMatchObject({ code: 'BUNDLE_SOURCE_UNAVAILABLE' });
  });

  it('refuses to infer modes for an untracked package file', async () => {
    await writeFile(join(skill, 'new.sh'), 'untracked\n');
    await expect(readGitExecutablePaths(skill, ['SKILL.md', 'new.sh']))
      .rejects.toMatchObject({ code: 'BUNDLE_SOURCE_UNAVAILABLE' });
  });

  it('fails explicitly when the package is outside a Git repository', async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'loom-git-untracked-')));
    try {
      await expect(readGitExecutablePaths(outside, ['SKILL.md']))
        .rejects.toMatchObject({ code: 'BUNDLE_SOURCE_UNAVAILABLE' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
