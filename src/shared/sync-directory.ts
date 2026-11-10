import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export async function syncDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, constants.O_RDONLY);
    await directory.sync();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error &&
        ['EINVAL', 'EISDIR', 'EPERM', 'ENOTSUP'].includes(String(error.code)))) throw error;
  } finally {
    await directory?.close();
  }
}
