import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const scripts = join(process.cwd(), '.github', 'skills', 'scenario-discovery', 'scripts');
const helper = join(scripts, 'authored-skill.mjs');

async function projectFixture(name = 'authored-review') {
  const root = await mkdtemp(join(tmpdir(), 'loom-authored-skill-'));
  roots.push(root);
  const packagePath = join(root, '.skill-loom-authored', name);
  await mkdir(packagePath, { recursive: true });
  await writeFile(
    join(packagePath, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Authored review fixture.\n---\n\n# Review\n\nReview the change.\n`,
  );
  await mkdir(join(packagePath, 'scripts'), { recursive: true });
  await writeFile(join(packagePath, 'scripts', 'check.sh'), '#!/bin/sh\nprintf safe\n', { mode: 0o755 });
  return { root, packagePath, name };
}

function run(args: string[]) {
  return spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('scenario-discovery authored-skill helper', () => {
  it('validates a staged package and reports a stable fingerprint and inventory', async () => {
    const { root, packagePath, name } = await projectFixture();
    const first = run(['check', '--package', packagePath, '--name', name, '--project', root]);
    expect(first.status).toBe(0);
    const report = JSON.parse(first.stdout) as {
      name: string;
      fingerprint: string;
      files: Array<{ path: string; executable: boolean }>;
    };
    expect(report.name).toBe(name);
    expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'SKILL.md', executable: false }),
      expect.objectContaining({ path: 'scripts/check.sh', executable: true }),
    ]));

    const second = run(['check', '--package', packagePath, '--name', name, '--project', root]);
    expect(second.status).toBe(0);
    expect((JSON.parse(second.stdout) as { fingerprint: string }).fingerprint).toBe(report.fingerprint);
  });

  it('rejects a package whose directory and frontmatter names differ', async () => {
    const { root, packagePath } = await projectFixture();
    const result = run(['check', '--package', packagePath, '--name', 'other-name', '--project', root]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/does not match|does not match the package directory/i);
  });

  it('rejects a symlink inside the package', async () => {
    const { root, packagePath, name } = await projectFixture();
    await symlink(join(root, 'outside.txt'), join(packagePath, 'linked.txt'));
    const result = run(['check', '--package', packagePath, '--name', name, '--project', root]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/symlink/i);
  });

  it('rejects excluded build and credential directories', async () => {
    const { root, packagePath, name } = await projectFixture();
    await mkdir(join(packagePath, 'node_modules'), { recursive: true });
    await writeFile(join(packagePath, 'node_modules', 'index.js'), 'module.exports = 1;\n');
    const result = run(['check', '--package', packagePath, '--name', name, '--project', root]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe or excluded path/i);
  });

  it('requires explicit confirmation before installing', async () => {
    const { root, packagePath } = await projectFixture();
    const result = run([
      'install', '--package', packagePath, '--root', join(root, '.agents', 'skills'), '--project', root,
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/explicit confirmation/i);
  });

  it('installs once, preserves executable bits, and refuses to overwrite', async () => {
    const { root, packagePath, name } = await projectFixture();
    const skillRoot = join(root, '.agents', 'skills');
    const installed = run([
      'install', '--package', packagePath, '--root', skillRoot, '--project', root, '--confirmed',
    ]);
    expect(installed.status).toBe(0);
    const report = JSON.parse(installed.stdout) as { path: string; fingerprint: string };
    expect(report.path).toBe(join(skillRoot, name));
    expect((await stat(join(report.path, 'scripts', 'check.sh'))).mode & 0o100).not.toBe(0);
    expect(await readFile(join(report.path, 'SKILL.md'), 'utf8')).toContain(`name: ${name}`);

    const second = run([
      'install', '--package', packagePath, '--root', skillRoot, '--project', root, '--confirmed',
    ]);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/refusing to overwrite/i);
  });

  it('rejects a package outside the declared project root', async () => {
    const { packagePath, name } = await projectFixture();
    const other = await mkdtemp(join(tmpdir(), 'loom-authored-project-'));
    roots.push(other);
    const result = run(['check', '--package', packagePath, '--name', name, '--project', other]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/inside the declared project root/i);
  });
});
