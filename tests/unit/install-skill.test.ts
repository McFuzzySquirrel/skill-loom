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
