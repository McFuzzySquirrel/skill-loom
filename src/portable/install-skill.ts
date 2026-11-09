import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { BundleSkill } from '../shared/bundles.js';
import { BundleError, decodeBundleFile, validatePackagePath } from './bundle.js';

/**
 * Publish the top-level skill entry only after the other package files.
 * Nested skill entries may still be discovered before this publication.
 */
export async function writeBundleSkillFiles(
  destination: string,
  files: BundleSkill['files'],
  options: { directoryMode: number; enforceFileMode?: boolean; publish?: typeof link } = { directoryMode: 0o700 },
): Promise<void> {
  const entry = files.find((file) => file.path === 'SKILL.md');
  if (entry === undefined) throw new BundleError('BUNDLE_INVALID', 'Each skill package must include SKILL.md.');
  for (const file of files) validatePackagePath(file.path);

  async function ensureParent(target: string): Promise<void> {
    let current = destination;
    for (const segment of relative(destination, dirname(target)).split(sep).filter(Boolean)) {
      current = join(current, segment);
      try {
        await mkdir(current, { mode: options.directoryMode });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current) {
        throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'A skill package directory changed during installation.');
      }
    }
  }

  async function writeFile(target: string, file: BundleSkill['files'][number]): Promise<void> {
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      file.executable ? 0o755 : 0o644);
    try {
      await handle.writeFile(decodeBundleFile(file.content));
      if (options.enforceFileMode) await handle.chmod(file.executable ? 0o755 : 0o644);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  for (const file of files) {
    if (file.path === 'SKILL.md') continue;
    const target = join(destination, ...file.path.split('/'));
    await ensureParent(target);
    await writeFile(target, file);
  }

  await publishSkillEntry(destination, decodeBundleFile(entry.content), entry.executable ? 0o755 : 0o644, options);
}

export async function publishSkillEntry(
  destination: string,
  content: Uint8Array,
  mode: number,
  options: { enforceFileMode?: boolean; publish?: typeof link } = {},
): Promise<void> {
  const temporary = join(dirname(destination), `.loom-skill-${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    created = true;
    try {
      await handle.writeFile(content);
      if (options.enforceFileMode) await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await (options.publish ?? link)(temporary, join(destination, 'SKILL.md'));
  } finally {
    if (created) await unlink(temporary);
  }
}
