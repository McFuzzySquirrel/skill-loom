import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyWindowsProfile } from './windows-control.js';

export class ProfileOwnerError extends Error {
  constructor(
    readonly code: 'PROFILE_IN_USE' | 'PROFILE_LOCK_UNSAFE' | 'PROFILE_LOCK_FAILED',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProfileOwnerError';
  }
}

export interface ProfileOwner {
  release(): void;
}

/**
 * Hold an OS-backed SQLite write lock for the lifetime of the profile owner.
 * The database is never used to store application state. SQLite releases the
 * lock when the process exits, so stale PIDs and lock-file deletion are not
 * needed for recovery.
 */
export async function acquireProfileOwner(configDirectory: string): Promise<ProfileOwner> {
  const requestedRoot = resolve(configDirectory);
  if (process.platform === 'win32') {
    await verifyWindowsProfile(requestedRoot, 'prepare');
  } else {
    await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
  }
  const root = await realpath(requestedRoot);
  const lockPath = join(root, 'profile-owner.sqlite');
  try {
    try {
      await writeFile(lockPath, '', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const info = await lstat(lockPath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new ProfileOwnerError('PROFILE_LOCK_UNSAFE', 'The profile ownership file is unsafe.');
    }
    if (process.platform === 'win32') await verifyWindowsProfile(root, 'lock');
  } catch (error) {
    if (error instanceof ProfileOwnerError) throw error;
    throw new ProfileOwnerError('PROFILE_LOCK_FAILED', 'The profile ownership file could not be opened.', { cause: error });
  }

  const { DatabaseSync } = await import('node:sqlite');
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = new DatabaseSync(lockPath);
    db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE');
  } catch (error) {
    db?.close();
    if (typeof error === 'object' && error !== null && 'errcode' in error &&
        typeof error.errcode === 'number' && (error.errcode & 0xff) === 5) {
      throw new ProfileOwnerError('PROFILE_IN_USE', 'Another Skill Loom process owns this configuration profile.', { cause: error });
    }
    throw new ProfileOwnerError('PROFILE_LOCK_FAILED', 'The configuration profile could not be locked.', { cause: error });
  }

  const database = db;
  let released = false;
  return {
    release() {
      if (released) return;
      database.close();
      released = true;
    },
  };
}
