import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const DATABASE_NAME = 'project-claim.sqlite';
export const PROJECT_CLAIM_DATABASE_VERSION = 2;
export const PROJECT_CLAIM_APPLICATION_ID = 0x4c4f4f4d;
const DATABASE_VERSION = PROJECT_CLAIM_DATABASE_VERSION;
const APPLICATION_ID = PROJECT_CLAIM_APPLICATION_ID;
const MAX_DATABASE_BYTES = 8 * 1024 * 1024;
const MAX_IGNORE_BYTES = 1024 * 1024;
const CREATE_TABLE = 'CREATE TABLE claim (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)';
const CREATE_PROTOCOL = 'CREATE TABLE protocol (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)';
const CREATE_LIFECYCLE = 'CREATE TABLE lifecycle (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)';

const ProtocolSchema = z.strictObject({
  version: z.literal(1),
  projectPath: z.string(),
  projectDevice: z.string().regex(/^[0-9]+$/),
  projectInode: z.string().regex(/^[0-9]+$/),
  enabledAt: z.iso.datetime({ offset: true }),
});

export const ProjectRetirementSchema = z.strictObject({
  version: z.literal(1),
  projectPath: z.string(),
  projectDevice: z.string().regex(/^[0-9]+$/),
  projectInode: z.string().regex(/^[0-9]+$/),
  retiredAt: z.iso.datetime({ offset: true }),
});

export const ProjectClaimSchema = z.strictObject({
  version: z.literal(1),
  projectPath: z.string().refine((path) => isAbsolute(path) && !path.includes('\0')),
  projectDevice: z.string().regex(/^[0-9]+$/),
  projectInode: z.string().regex(/^[0-9]+$/),
  kind: z.enum(['managed', 'portable']),
  runId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  createdAt: z.iso.datetime({ offset: true }),
}).refine((claim) => claim.kind !== 'portable' || /^[a-f0-9-]{36}$/.test(claim.runId));
export type ProjectClaim = z.infer<typeof ProjectClaimSchema>;

export class ProjectClaimError extends Error {
  constructor(
    readonly code: 'PROJECT_CLAIM_UNSAFE' | 'PROJECT_CLAIM_BUSY' | 'PROJECT_CLAIM_CONFLICT' | 'PROJECT_CLAIM_MISMATCH' | 'PROJECT_CLAIM_RETIRED',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProjectClaimError';
  }
}

export interface ProjectClaimTransaction {
  readonly identity: Pick<ProjectClaim, 'projectPath' | 'projectDevice' | 'projectInode'>;
  protocol(): z.infer<typeof ProtocolSchema> | null;
  enableProtocol(now: string): void;
  read(): ProjectClaim | null;
  acquire(claim: ProjectClaim): void;
  release(expected: Pick<ProjectClaim, 'kind' | 'runId'>): void;
  retired(): boolean;
  retire(now: string): void;
}

const queues = new Map<string, Promise<void>>();

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function unsafe(message: string, cause?: unknown): ProjectClaimError {
  return new ProjectClaimError('PROJECT_CLAIM_UNSAFE', message, cause === undefined ? undefined : { cause });
}

function isDatabaseBusy(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'errcode' in error &&
    typeof error.errcode === 'number' && (error.errcode & 255) === 5;
}

async function openExclusiveDatabase(path: string): Promise<DatabaseSync> {
  const deadline = performance.now() + 100;
  for (;;) {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(path);
      database.exec('PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL; BEGIN EXCLUSIVE');
      return database;
    } catch (error) {
      // Concurrent connection initialization can transiently block both
      // contenders. Drop all locks before retrying; never replay a callback.
      database?.close();
      const remaining = deadline - performance.now();
      if (!isDatabaseBusy(error) || remaining <= 0) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(10 + Math.random() * 10, remaining)));
    }
  }
}

async function ensureDatabase(projectPath: string): Promise<{
  identity: ProjectClaimTransaction['identity']; path: string;
}> {
  if (!isAbsolute(projectPath) || projectPath.includes('\0')) {
    throw unsafe('The project path must be absolute.');
  }
  const project = await realpath(projectPath);
  const projectInfo = await stat(project, { bigint: true });
  if (!projectInfo.isDirectory()) throw unsafe('The project is not a directory.');
  const loom = join(project, '.loom');
  try {
    await mkdir(loom, { mode: 0o700 });
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error;
  }
  const directory = await lstat(loom);
  if (!directory.isDirectory() || directory.isSymbolicLink() || await realpath(loom) !== loom) {
    throw unsafe('The project coordination directory is unsafe.');
  }
  await ensureIgnored(loom);
  const path = join(loom, DATABASE_NAME);
  try {
    await lstat(path);
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw unsafe('The project claim database could not be inspected.', error);
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.close();
    try {
      const database = new DatabaseSync(temporary);
      try {
        database.exec(`PRAGMA synchronous = FULL; BEGIN EXCLUSIVE; ${CREATE_TABLE}; ${CREATE_PROTOCOL}; ${CREATE_LIFECYCLE}; PRAGMA user_version = ${DATABASE_VERSION}; PRAGMA application_id = ${APPLICATION_ID}; COMMIT`);
      } finally {
        database.close();
      }
      try {
        await link(temporary, path);
        await syncDirectory(loom);
      } catch (linkError) {
        if (!isErrno(linkError, 'EEXIST')) throw linkError;
      }
    } finally {
      await unlink(temporary);
    }
    await syncDirectory(loom);
  }
  let info = await lstat(path);
  // Publication briefly creates a second link; never accept a persistent hard link.
  for (let attempt = 0; info.nlink !== 1 && attempt < 10; attempt++) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    info = await lstat(path);
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_DATABASE_BYTES ||
      resolve(await realpath(path)) !== path) {
    throw unsafe('The project claim database is unsafe.');
  }
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try {
      const sidecar = await lstat(path + suffix);
      if (!sidecar.isFile() || sidecar.isSymbolicLink() || sidecar.nlink !== 1 ||
          sidecar.size > MAX_DATABASE_BYTES) {
        throw unsafe('A project claim database sidecar is unsafe.');
      }
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error;
    }
  }
  return {
    identity: { projectPath: project, projectDevice: String(projectInfo.dev), projectInode: String(projectInfo.ino) },
    path,
  };
}

async function ensureIgnored(loom: string): Promise<void> {
  let file;
  try {
    file = await open(join(loom, '.gitignore'),
      constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_IGNORE_BYTES) {
      throw unsafe('The project ignore file is unsafe.');
    }
    const text = await file.readFile('utf8');
    const lines = text.split(/\r?\n/).filter((line) => line !== '');
    if (lines.at(-1) !== `${DATABASE_NAME}*`) {
      await file.writeFile(`${text === '' || text.endsWith('\n') ? '' : '\n'}${DATABASE_NAME}*\n`, 'utf8');
      await file.sync();
      await syncDirectory(loom);
    }
  } catch (error) {
    if (error instanceof ProjectClaimError) throw error;
    throw unsafe('The project ignore file could not be updated.', error);
  } finally {
    await file?.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try {
    try {
      await directory.sync();
    } catch (error) {
      if (!isErrno(error, 'EINVAL') && !isErrno(error, 'EISDIR') &&
          !isErrno(error, 'EPERM') && !isErrno(error, 'ENOTSUP')) {
        throw error;
      }
    }
  } finally {
    await directory.close();
  }
}

function parseClaim(value: unknown, identity: ProjectClaimTransaction['identity']): ProjectClaim {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 4096) {
    throw unsafe('The project claim is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw unsafe('The project claim is invalid.', error);
  }
  const result = ProjectClaimSchema.safeParse(parsed);
  if (!result.success || result.data.projectPath !== identity.projectPath ||
      result.data.projectDevice !== identity.projectDevice || result.data.projectInode !== identity.projectInode) {
    throw unsafe('The project claim is invalid or belongs to another project.');
  }
  return result.data;
}

/**
 * Run one short, cross-process transaction. Callers must commit a durable claim
 * before performing side effects and retain it until cleanup is verified.
 */
export async function withProjectClaimTransaction<T>(
  projectPath: string,
  task: (transaction: ProjectClaimTransaction) => Promise<T>,
): Promise<T> {
  return runProjectClaimTransaction(projectPath, task, false);
}

/** Permit a removal retry to inspect an already retired workspace. */
export async function withProjectRetirementTransaction<T>(
  projectPath: string,
  task: (transaction: ProjectClaimTransaction) => Promise<T>,
): Promise<T> {
  return runProjectClaimTransaction(projectPath, task, true);
}

async function runProjectClaimTransaction<T>(
  projectPath: string,
  task: (transaction: ProjectClaimTransaction) => Promise<T>,
  allowRetired: boolean,
): Promise<T> {
  if (!isAbsolute(projectPath) || projectPath.includes('\0')) {
    throw unsafe('The project path must be absolute.');
  }
  let canonical: string;
  try {
    canonical = await realpath(projectPath);
  } catch (error) {
    throw unsafe('The project coordination path could not be resolved.', error);
  }
  const previous = queues.get(canonical) ?? Promise.resolve();
  const operation = previous.then(async () => {
    let identity: ProjectClaimTransaction['identity'];
    let path: string;
    try {
      ({ identity, path } = await ensureDatabase(canonical));
    } catch (error) {
      if (error instanceof ProjectClaimError) throw error;
      throw unsafe('The project claim database could not be prepared.', error);
    }
    let database: DatabaseSync | undefined;
    let begun = false;
    let active = true;
    let taskFailed = false;
    try {
      database = await openExclusiveDatabase(path);
      begun = true;
      const versionRow = database.prepare('PRAGMA user_version').get();
      const version = versionRow?.user_version;
      if (version !== 1 && version !== DATABASE_VERSION) {
        throw unsafe('The project claim database has an unsupported or incomplete version.');
      }
      const application = database.prepare('PRAGMA application_id').get();
      if (application?.application_id !== APPLICATION_ID) throw unsafe('The project claim database identity is invalid.');
      const journal = database.prepare('PRAGMA journal_mode').get();
      if (journal?.journal_mode !== 'delete') throw unsafe('The project claim database journal mode is unsupported.');
      const metadata = database.prepare("SELECT type, name, sql FROM sqlite_master").all();
      if (metadata.length !== (version === 1 ? 2 : 3) ||
          !metadata.some((entry) => entry.type === 'table' && entry.name === 'claim' && entry.sql === CREATE_TABLE) ||
          !metadata.some((entry) => entry.type === 'table' && entry.name === 'protocol' && entry.sql === CREATE_PROTOCOL) ||
          (version === DATABASE_VERSION && !metadata.some(
            (entry) => entry.type === 'table' && entry.name === 'lifecycle' && entry.sql === CREATE_LIFECYCLE,
          ))) {
        throw unsafe('The project claim database schema is invalid.');
      }
      const check = database.prepare('PRAGMA quick_check').get();
      if (check?.quick_check !== 'ok') throw unsafe('The project claim database is corrupt.');
      if (version === 1) {
        database.exec(`${CREATE_LIFECYCLE}; PRAGMA user_version = ${DATABASE_VERSION}`);
      }
      const db = database;
      const read = (): ProjectClaim | null => {
        if (!active) throw unsafe('The project claim transaction is no longer active.');
        const rows = db.prepare('SELECT id, document FROM claim').all();
        if (rows.length === 0) return null;
        if (rows.length !== 1 || rows[0]?.id !== 1) throw unsafe('The project claim database contains invalid rows.');
        return parseClaim(rows[0].document, identity);
      };
      const protocol = (): z.infer<typeof ProtocolSchema> | null => {
        if (!active) throw unsafe('The project claim transaction is no longer active.');
        const rows = db.prepare('SELECT id, document FROM protocol').all();
        if (rows.length === 0) return null;
        if (rows.length !== 1 || rows[0]?.id !== 1 || typeof rows[0].document !== 'string' ||
            Buffer.byteLength(rows[0].document, 'utf8') > 4096) {
          throw unsafe('The project protocol record is invalid.');
        }
        let value: unknown;
        try {
          value = JSON.parse(rows[0].document) as unknown;
        } catch (error) {
          throw unsafe('The project protocol record is invalid.', error);
        }
        const result = ProtocolSchema.safeParse(value);
        if (!result.success || result.data.projectPath !== identity.projectPath ||
            result.data.projectDevice !== identity.projectDevice || result.data.projectInode !== identity.projectInode) {
          throw unsafe('The project protocol record is invalid or belongs to another project.');
        }
        return result.data;
      };
      const retired = (): boolean => {
        if (!active) throw unsafe('The project claim transaction is no longer active.');
        const rows = db.prepare('SELECT id, document FROM lifecycle').all();
        if (rows.length === 0) return false;
        if (rows.length !== 1 || rows[0]?.id !== 1 || typeof rows[0].document !== 'string' ||
            Buffer.byteLength(rows[0].document, 'utf8') > 4096) {
          throw unsafe('The project retirement record is invalid.');
        }
        let value: unknown;
        try {
          value = JSON.parse(rows[0].document) as unknown;
        } catch (error) {
          throw unsafe('The project retirement record is invalid.', error);
        }
        const result = ProjectRetirementSchema.safeParse(value);
        if (!result.success || result.data.projectPath !== identity.projectPath ||
            result.data.projectDevice !== identity.projectDevice || result.data.projectInode !== identity.projectInode) {
          throw unsafe('The project retirement record is invalid or belongs to another project.');
        }
        return true;
      };
      const assertNotRetired = (): void => {
        if (retired()) {
          throw new ProjectClaimError('PROJECT_CLAIM_RETIRED', 'This workspace is being removed and cannot start or change runs.');
        }
      };
      const transaction: ProjectClaimTransaction = {
        identity,
        protocol,
        enableProtocol(now) {
          assertNotRetired();
          if (protocol() !== null) return;
          const value = ProtocolSchema.safeParse({ version: 1, ...identity, enabledAt: now });
          if (!value.success) throw unsafe('The project protocol record is invalid.');
          db.prepare('INSERT INTO protocol (id, document) VALUES (1, ?)').run(JSON.stringify(value.data));
        },
        read,
        acquire(value) {
          assertNotRetired();
          const claim = ProjectClaimSchema.safeParse(value);
          if (!claim.success || claim.data.projectPath !== identity.projectPath ||
              claim.data.projectDevice !== identity.projectDevice || claim.data.projectInode !== identity.projectInode) {
            throw unsafe('The new project claim is invalid.');
          }
          if (read() !== null) {
            throw new ProjectClaimError('PROJECT_CLAIM_CONFLICT', 'Another operation already claims this project.');
          }
          db.prepare('INSERT INTO claim (id, document) VALUES (1, ?)').run(JSON.stringify(claim.data));
        },
        release(expected) {
          assertNotRetired();
          const claim = read();
          if (claim === null || claim.kind !== expected.kind || claim.runId !== expected.runId) {
            throw new ProjectClaimError('PROJECT_CLAIM_MISMATCH', 'The project claim does not match this run.');
          }
          db.prepare('DELETE FROM claim WHERE id = 1').run();
        },
        retired,
        retire(now) {
          if (retired()) return;
          if (read() !== null) {
            throw new ProjectClaimError('PROJECT_CLAIM_CONFLICT', 'A claimed project cannot be retired.');
          }
          const value = ProjectRetirementSchema.safeParse({ version: 1, ...identity, retiredAt: now });
          if (!value.success) throw unsafe('The project retirement record is invalid.');
          db.prepare('INSERT INTO lifecycle (id, document) VALUES (1, ?)').run(JSON.stringify(value.data));
        },
      };
      read();
      protocol();
      if (!allowRetired) assertNotRetired();
      let result: T;
      try {
        result = await task(transaction);
      } catch (error) {
        taskFailed = true;
        throw error;
      }
      active = false;
      database.exec('COMMIT');
      begun = false;
      return result;
    } catch (error) {
      active = false;
      if (begun) {
        try {
          database?.exec('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'The project claim transaction and rollback failed.');
        }
      }
      if (taskFailed) throw error;
      if (error instanceof ProjectClaimError) throw error;
      if (isDatabaseBusy(error)) {
        throw new ProjectClaimError('PROJECT_CLAIM_BUSY', 'Another process is updating the project claim.', { cause: error });
      }
      throw unsafe('The project claim transaction failed.', error);
    } finally {
      database?.close();
    }
  });
  const settled = operation.then(() => undefined, () => undefined);
  queues.set(canonical, settled);
  void settled.then(() => {
    if (queues.get(canonical) === settled) queues.delete(canonical);
  });
  return operation;
}
