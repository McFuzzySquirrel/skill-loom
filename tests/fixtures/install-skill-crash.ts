import { link } from 'node:fs/promises';
import { writeBundleSkillFiles } from '../../src/portable/install-skill.js';

const destination = process.argv[2]!;
const phase = process.argv[3]!;
const files = [
  { path: 'SKILL.md', content: Buffer.from('---\nname: example\n---\nInstructions.\n').toString('base64'), executable: false },
  { path: 'scripts/review.txt', content: Buffer.from('review data').toString('base64'), executable: false },
];

await writeBundleSkillFiles(destination, files, {
  directoryMode: 0o700,
  publish: async (source, target) => {
    if (phase === 'after') await link(source, target);
    process.stdout.write('READY\n');
    await new Promise<void>(() => { setInterval(() => undefined, 1_000); });
  },
});
