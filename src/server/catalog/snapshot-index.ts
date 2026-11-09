import { chmod, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { RemoteSkillSnapshot } from './remote.js';

const INDEX_FILE = 'snapshot-index.sqlite';
export const MAX_SNAPSHOT_INDEX_BYTES = 1024 * 1024 * 1024;
export class SnapshotIndexTooLarge extends Error {}
const metadataSchema = z.strictObject({
  version: z.literal(1),
  sourceId: z.string(),
  revision: z.string(),
  repository: z.string().min(1).max(2048),
  manifestSize: z.string(),
  manifestModified: z.string(),
  manifestInode: z.string(),
  requiresJsSearch: z.boolean(),
  skills: z.number().int().min(0),
  agents: z.number().int().min(0),
});

function hasUnpairedSurrogate(value: string): boolean {
  return value !== value.toWellFormed();
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function writeSnapshotIndex(root: string, snapshot: RemoteSkillSnapshot): Promise<void> {
  const manifest = await lstat(join(root, 'snapshot.json'), { bigint: true });
  const entries = [
    ...snapshot.packages.map((entry) => ({ kind: 'skill', entry })),
    ...snapshot.agents.map((entry) => ({ kind: 'agent', entry })),
  ].sort((a, b) => comparePaths(a.entry.name, b.entry.name) ||
    comparePaths(a.entry.repositoryPath, b.entry.repositoryPath) || comparePaths(a.entry.directory, b.entry.directory));
  const metadata = {
    version: 1,
    sourceId: snapshot.sourceId,
    revision: snapshot.revision,
    repository: snapshot.repository,
    manifestSize: String(manifest.size),
    manifestModified: String(manifest.mtimeNs),
    manifestInode: String(manifest.ino),
    requiresJsSearch: entries.some(({ entry }) =>
      hasUnpairedSurrogate(`${entry.name}\n${entry.description}\n${entry.repositoryPath}`)),
    skills: snapshot.packages.length,
    agents: snapshot.agents.length,
  };
  const database = new DatabaseSync(join(root, INDEX_FILE));
  try {
    database.exec('CREATE TABLE metadata (value TEXT NOT NULL); CREATE TABLE entries (kind TEXT NOT NULL, position INTEGER NOT NULL, search TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY (kind, position)); BEGIN');
    database.prepare('INSERT INTO metadata (value) VALUES (?)').run(JSON.stringify(metadata));
    const insert = database.prepare('INSERT INTO entries (kind, position, search, item) VALUES (?, ?, ?, ?)');
    entries.forEach(({ kind, entry }, position) => {
      const search = `${entry.name}\n${entry.description}\n${entry.repositoryPath}`.toLowerCase();
      insert.run(kind, position, search, JSON.stringify(entry));
    });
    database.exec('COMMIT');
  } finally {
    database.close();
  }
  await chmod(join(root, INDEX_FILE), 0o600);
  if ((await lstat(join(root, INDEX_FILE))).size > MAX_SNAPSHOT_INDEX_BYTES) {
    throw new SnapshotIndexTooLarge('The snapshot page index exceeds its 1 GiB safety limit.');
  }
}

export async function readSnapshotIndex(
  root: string,
  sourceId: string,
  revision: string,
  request: { kind: 'skill' | 'agent'; search: string; offset: number; limit: number },
): Promise<{ repository: string; total: number; items: unknown[] } | { stale: true } | null> {
  const indexPath = join(root, INDEX_FILE);
  let indexInfo;
  try {
    indexInfo = await lstat(indexPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root ||
      !indexInfo.isFile() || indexInfo.isSymbolicLink() || indexInfo.size > MAX_SNAPSHOT_INDEX_BYTES) {
    throw new Error('Unsafe snapshot index.');
  }
  const manifestPath = join(root, 'snapshot.json');
  const manifest = await lstat(manifestPath, { bigint: true });
  if (!manifest.isFile() || manifest.isSymbolicLink() || manifest.size > BigInt(256 * 1024 * 1024)) {
    throw new Error('Unsafe snapshot manifest.');
  }
  const database = new DatabaseSync(indexPath, { readOnly: true });
  try {
    database.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON');
    const row = database.prepare('SELECT value FROM metadata').all();
    if (row.length !== 1 || typeof row[0]?.value !== 'string') throw new Error('Invalid snapshot index metadata.');
    const metadata = metadataSchema.parse(JSON.parse(row[0].value) as unknown);
    if (metadata.sourceId !== sourceId || metadata.revision !== revision) throw new Error('Snapshot index identity is invalid.');
    if (metadata.manifestSize !== String(manifest.size) || metadata.manifestModified !== String(manifest.mtimeNs) ||
        metadata.manifestInode !== String(manifest.ino)) return { stale: true };
    const expectedCount = request.kind === 'skill' ? metadata.skills : metadata.agents;
    const wholeCount = database.prepare('SELECT count(*) AS total FROM entries WHERE kind = ?').get(request.kind);
    if (wholeCount?.total !== expectedCount) throw new Error('Snapshot index entry count changed.');
    if (metadata.requiresJsSearch || hasUnpairedSurrogate(request.search)) return null;
    const search = request.search.toLowerCase();
    const count = database.prepare('SELECT count(*) AS total FROM entries WHERE kind = ? AND instr(search, ?) > 0')
      .get(request.kind, search);
    if (typeof count?.total !== 'number' || !Number.isSafeInteger(count.total) ||
        count.total < 0 || count.total > expectedCount) {
      throw new Error('Invalid snapshot index count.');
    }
    const rows = database.prepare('SELECT item FROM entries WHERE kind = ? AND instr(search, ?) > 0 ORDER BY position LIMIT ? OFFSET ?')
      .all(request.kind, search, request.limit, request.offset);
    const items = rows.map((item) => {
      if (typeof item.item !== 'string') throw new Error('Invalid snapshot index entry.');
      return JSON.parse(item.item) as unknown;
    });
    const after = await lstat(manifestPath, { bigint: true });
    if (after.size !== manifest.size || after.mtimeNs !== manifest.mtimeNs || after.ino !== manifest.ino) {
      throw new Error('Snapshot manifest changed during paging.');
    }
    return { repository: metadata.repository, total: count.total, items };
  } finally {
    database.close();
  }
}
