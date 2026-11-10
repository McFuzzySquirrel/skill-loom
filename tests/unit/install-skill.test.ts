import { access, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeBundleSkillFiles } from '../../src/portable/install-skill.js';

const roots: string[] = [];
const files = [
  { path: 'SKILL.md', content: Buffer.from('---\nname: example\n---\nInstructions.\n').toString('base64'), executable: false },
  { path: 'scripts/review.txt', content: Buffer.from('review data').toString('base64'), executable: false },
];

async function setup(): Promise<{ root: string; destination: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-install-skill-')));
  roots.push(root);
  const destination = join(root, 'example');
  await mkdir(destination);
  return { root, destination };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundle skill installation', () => {
  it.each(['before', 'nested', 'after'])('keeps publication safe after an interrupted process (%s link)', async (phase) => {
    const { root, destination } = await setup();
    const child = spawn(process.execPath, [
      '--import', 'tsx', 'tests/fixtures/install-skill-crash.ts', destination, phase,
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    try {
      const [ready] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(10_000) });
      expect(String(ready)).toContain('READY');
      child.kill('SIGKILL');
      await exited;
      expect(await readFile(join(destination, 'scripts', 'review.txt'), 'utf8')).toBe('review data');
      expect(await readFile(join(destination, 'nested', 'reference.txt'), 'utf8')).toBe('nested data');
      if (phase !== 'after') {
        await expect(access(join(destination, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      } else {
        expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toContain('name: example');
      }
      if (phase === 'before') {
        await expect(access(join(destination, 'nested', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      } else {
        expect(await readFile(join(destination, 'nested', 'SKILL.md'), 'utf8')).toContain('name: nested');
      }
      expect((await readdir(root)).filter((name) => name.startsWith('.loom-skill-'))).toHaveLength(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  }, 20_000);

  it('publishes the entry only after other package files are complete', async () => {
    const { root, destination } = await setup();
    let publications = 0;
    await writeBundleSkillFiles(destination, files, {
      directoryMode: 0o700,
      publish: async (source, target) => {
        publications += 1;
        await expect(access(join(destination, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(join(destination, 'scripts', 'review.txt'), 'utf8')).toBe('review data');
        expect(await readFile(source, 'utf8')).toContain('name: example');
        await link(source, target);
      },
    });
    expect(publications).toBe(1);
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toContain('name: example');
    expect(await readdir(root)).toEqual(['example']);
  });

  it('publishes nested entries only after their supporting files and before the top-level entry', async () => {
    const { destination } = await setup();
    const nested = {
      path: 'nested/SKILL.md',
      content: Buffer.from('---\nname: nested\n---\nNested instructions.\n').toString('base64'),
      executable: false,
    };
    const deeper = {
      path: 'nested/deeper/SKILL.md',
      content: Buffer.from('---\nname: deeper\n---\nInstructions.\n').toString('base64'),
      executable: false,
    };
    const support = { path: 'nested/reference.txt', content: Buffer.from('nested data').toString('base64'), executable: false };
    const targets: string[] = [];
    await writeBundleSkillFiles(destination, [...files, nested, deeper, support], {
      directoryMode: 0o700,
      publish: async (source, target) => {
        targets.push(String(target));
        expect(await readFile(join(destination, 'nested', 'reference.txt'), 'utf8')).toBe('nested data');
        await expect(access(join(destination, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
        if (String(target) === join(destination, 'SKILL.md')) {
          expect(await readFile(join(destination, 'nested', 'SKILL.md'), 'utf8')).toContain('name: nested');
        } else if (String(target) === join(destination, 'nested', 'SKILL.md')) {
          expect(await readFile(join(destination, 'nested', 'deeper', 'SKILL.md'), 'utf8')).toContain('name: deeper');
          await expect(access(join(destination, 'nested', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
        } else {
          await expect(access(join(destination, 'nested', 'deeper', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
        }
        await link(source, target);
      },
    });
    expect(targets).toEqual([
      join(destination, 'nested', 'deeper', 'SKILL.md'),
      join(destination, 'nested', 'SKILL.md'),
      join(destination, 'SKILL.md'),
    ]);
  });

  it('leaves no discoverable entry or temporary file when publication fails', async () => {
    const { root, destination } = await setup();
    const failure = new Error('injected publication failure');
    await expect(writeBundleSkillFiles(destination, files, {
      directoryMode: 0o700,
      publish: async () => { throw failure; },
    })).rejects.toBe(failure);
    await expect(access(join(destination, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(destination, 'scripts', 'review.txt'), 'utf8')).toBe('review data');
    expect(await readdir(root)).toEqual(['example']);
  });

  it('does not replace an entry created concurrently', async () => {
    const { root, destination } = await setup();
    await writeFile(join(destination, 'SKILL.md'), 'existing');
    await expect(writeBundleSkillFiles(destination, files)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe('existing');
    expect(await readdir(root)).toEqual(['example']);
  });
});
import { spawn } from 'node:child_process';
import { once } from 'node:events';
