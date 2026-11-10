import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readBundledSkillModes } from '../../src/server/catalog/bundled-modes.js';
import { scenarioCatalog, scenarioSkillPackagePath } from '../../src/server/chains/presets.js';

it('binds the bundled mode manifest to the complete shipped file sets and content', async () => {
  for (const skill of scenarioCatalog.skills) {
    const root = scenarioSkillPackagePath(skill.name)!;
    const modes = await readBundledSkillModes(skill.name);
    const remaining = new Set(modes.map((file) => file.path));
    expect(remaining.size).toBe(modes.length);
    async function visit(path: string, prefix: string): Promise<void> {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) await visit(join(path, entry.name), `${relative}/`);
        else {
          expect(entry.isFile()).toBe(true);
          expect(remaining.delete(relative)).toBe(true);
          expect(modes.find((file) => file.path === relative)?.sha256)
            .toBe(createHash('sha256').update(await readFile(join(path, entry.name))).digest('hex'));
        }
      }
    }
    await visit(root, '');
    expect(remaining.size).toBe(0);
    const expectedExecutables = skill.name === 'minimax-docx'
      ? ['scripts/doc_to_docx.sh', 'scripts/docx_preview.sh', 'scripts/env_check.sh', 'scripts/setup.sh']
      : [];
    expect(modes.filter((file) => file.executable).map((file) => file.path).sort()).toEqual(expectedExecutables);
  }
});
