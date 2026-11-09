import { createHash } from 'node:crypto';

export function snapshotPackageFingerprint(
  files: ReadonlyArray<{ path: string; content: Uint8Array; executable: boolean }>,
): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    hash.update(file.path).update('\0').update(file.executable ? 'x' : '-')
      .update('\0').update(file.content);
  }
  return hash.digest('hex');
}
