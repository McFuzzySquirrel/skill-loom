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

export function snapshotReviewFingerprint(
  files: ReadonlyArray<{ path: string; content: Uint8Array; executable: boolean }>,
): string {
  const hash = createHash('sha256').update('skill-loom-snapshot-review-v1\0');
  const length = (value: number): Buffer => {
    const encoded = Buffer.alloc(8);
    encoded.writeBigUInt64BE(BigInt(value));
    return encoded;
  };
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  hash.update(length(sorted.length));
  for (const file of sorted) {
    const path = Buffer.from(file.path, 'utf8');
    hash.update(length(path.length)).update(path)
      .update(file.executable ? '\x01' : '\x00')
      .update(length(file.content.byteLength)).update(file.content);
  }
  return hash.digest('hex');
}
