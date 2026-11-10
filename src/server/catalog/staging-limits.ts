import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RemoteCatalogLimits } from '../config/schema.js';

export interface StagingLimit {
  dimension: 'maxStagingEntries' | 'maxStagingBytes';
  limit: number;
}

interface StagingEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface StagingFilesystem {
  opendir(path: string): Promise<AsyncIterable<StagingEntry>>;
  lstat(path: string): Promise<{ size: number }>;
}

const filesystem: StagingFilesystem = { opendir, lstat };

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function exceedsStagingLimits(
  root: string,
  limits: Pick<RemoteCatalogLimits, 'maxStagingEntries' | 'maxStagingBytes'>,
  fs: StagingFilesystem = filesystem,
): Promise<StagingLimit | null> {
  const pending = [root];
  let entries = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let handle: AsyncIterable<StagingEntry>;
    try {
      handle = await fs.opendir(directory);
    } catch (error) {
      if (directory !== root && isMissing(error)) continue;
      throw error;
    }
    for await (const entry of handle) {
      entries += 1;
      if (entries > limits.maxStagingEntries) return { dimension: 'maxStagingEntries', limit: limits.maxStagingEntries };
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        try {
          bytes += (await fs.lstat(path)).size;
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
        if (bytes > limits.maxStagingBytes) return { dimension: 'maxStagingBytes', limit: limits.maxStagingBytes };
      }
    }
  }
  return null;
}
