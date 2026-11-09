import { lstat, realpath } from 'node:fs/promises';

export async function canonicalConfigRoot(directory: string): Promise<string> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('The configured directory is not a real directory.');
  }
  return realpath(directory);
}
