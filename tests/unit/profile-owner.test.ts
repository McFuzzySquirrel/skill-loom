import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireProfileOwner } from '../../src/server/profile-owner.js';
import { verifyWindowsProfile } from '../../src/server/windows-control.js';

const roots: string[] = [];

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'loom-owner-'));
  roots.push(path);
  if (process.platform === 'win32') {
    const profile = join(path, 'profile');
    await verifyWindowsProfile(profile, 'prepare');
    return profile;
  }
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('profile owner', () => {
  it('excludes another process until the owner releases the lock', async () => {
    const directory = await root();
    const owner = await acquireProfileOwner(directory);
    const probe = `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      try { db.exec('BEGIN EXCLUSIVE'); process.stdout.write('acquired'); }
      catch (error) { if ((error.errcode & 255) !== 5) throw error; process.stdout.write('busy'); }
      finally { db.close(); }
    `;
    const check = () => execFileSync(process.execPath, [
      '--disable-warning=ExperimentalWarning',
      '-e',
      probe,
      join(directory, 'profile-owner.sqlite'),
    ], { encoding: 'utf8' });
    try {
      expect(check()).toBe('busy');
      await expect(acquireProfileOwner(directory)).rejects.toMatchObject({ code: 'PROFILE_IN_USE' });
      expect(check()).toBe('busy');
    } finally {
      owner.release();
    }
    expect(check()).toBe('acquired');
    const next = await acquireProfileOwner(directory);
    next.release();
    next.release();
  });

  it('recovers ownership after the holding process exits unexpectedly', async () => {
    const directory = await root();
    const seed = await acquireProfileOwner(directory);
    seed.release();
    const child = spawn(process.execPath, [
      '--disable-warning=ExperimentalWarning',
      '-e',
      "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN EXCLUSIVE');process.stdout.write('ready');setInterval(()=>{},1000);",
      join(directory, 'profile-owner.sqlite'),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      expect((await once(child.stdout, 'data'))[0].toString()).toBe('ready');
      await expect(acquireProfileOwner(directory)).rejects.toMatchObject({ code: 'PROFILE_IN_USE' });
    } finally {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    const recovered = await acquireProfileOwner(directory);
    recovered.release();
  });

  it('refuses a symlink ownership file', async () => {
    const directory = await root();
    await symlink(join(directory, 'elsewhere'), join(directory, 'profile-owner.sqlite'));
    await expect(acquireProfileOwner(directory)).rejects.toMatchObject({ code: 'PROFILE_LOCK_UNSAFE' });
  });
});
