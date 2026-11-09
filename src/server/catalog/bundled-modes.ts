import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BundleError } from '../../portable/bundle.js';
import { InstalledModeIndexSchema, type InstalledModeIndex } from '../../portable/installed-modes.js';
import { readBoundedFile } from '../../portable/runtime.js';

const Schema = z.strictObject({
  version: z.literal(1),
  packages: z.array(z.strictObject({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128),
    files: InstalledModeIndexSchema.shape.files,
  })).max(100),
});

export async function readBundledSkillModes(name: string): Promise<InstalledModeIndex['files']> {
  const path = fileURLToPath(new URL('../chains/scenario-skill-modes.json', import.meta.url));
  const { content } = await readBoundedFile(path, 2 * 1024 * 1024);
  const result = Schema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as unknown);
  if (!result.success || new Set(result.data.packages.map((item) => item.name)).size !== result.data.packages.length) {
    throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'Bundled skill mode metadata is invalid. Reinstall Skill Loom before retrying.');
  }
  const selected = result.data.packages.find((item) => item.name === name);
  if (selected === undefined) throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'Bundled skill mode metadata is missing. Reinstall Skill Loom before retrying.');
  return selected.files;
}
