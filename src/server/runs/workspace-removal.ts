import { lstat, realpath, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ConfigStore } from '../config/store.js';
import type { WorkspaceRetirementEvidence } from '../config/schema.js';
import {
  PROJECT_CLAIM_APPLICATION_ID, PROJECT_CLAIM_DATABASE_VERSION, ProjectRetirementSchema,
  withProjectRetirementTransaction,
} from '../../shared/project-claim.js';
import { scanProjectRunRecords } from '../../shared/project-run-records.js';

export class WorkspaceRemovalError extends Error {
  constructor(readonly code: 'ACTIVE' | 'UNSAFE', message: string) {
    super(message);
    this.name = 'WorkspaceRemovalError';
  }
}

async function present(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Retire a workspace before moving it out of its registered location.
 * The retained database blocks new participating runs between retirement and
 * the atomic rename; moving the directory prevents later recreation at that
 * project path. A deterministic retired name makes interrupted removal retryable.
 */
export async function removeRetiredWorkspace(
  root: string,
  id: string,
  options: {
    configStore: ConfigStore;
    kind: 'test' | 'discovery';
    projectId: string;
    evidence?: WorkspaceRetirementEvidence;
  },
): Promise<void> {
  const path = join(root, id);
  const retiredPath = join(root, `.retired-${id}`);
  const current = await present(path);
  const existingRetired = await present(retiredPath);
  if (current !== undefined && existingRetired !== undefined) {
    throw new WorkspaceRemovalError('UNSAFE', 'Both the workspace and its retired copy exist.');
  }
  if (current !== undefined && options.evidence !== undefined) {
    throw new WorkspaceRemovalError('UNSAFE', 'A workspace exists after its removal was verified.');
  }
  if (current === undefined && existingRetired === undefined) {
    if (options.evidence === undefined) {
      throw new WorkspaceRemovalError('UNSAFE', 'The missing workspace has no verified retirement evidence.');
    }
    return;
  }
  if (current !== undefined) {
    if (!current.isDirectory() || current.isSymbolicLink() || await realpath(path) !== path) {
      throw new WorkspaceRemovalError('UNSAFE', 'The workspace path is unsafe.');
    }
    const identity = await withProjectRetirementTransaction(path, async (tx) => {
      const claim = tx.read();
      const unresolved = (await scanProjectRunRecords(path)).filter((record) => record.unresolved);
      if (claim !== null || unresolved.length !== 0) {
        throw new WorkspaceRemovalError('ACTIVE', 'The workspace has a retained claim or unresolved run. Reconcile it before removal.');
      }
      tx.retire(new Date().toISOString());
      return tx.identity;
    });
    const info = await stat(path, { bigint: true });
    if (String(info.dev) !== identity.projectDevice || String(info.ino) !== identity.projectInode ||
        await realpath(path) !== path || await present(retiredPath) !== undefined) {
      throw new WorkspaceRemovalError('UNSAFE', 'The workspace changed before retirement could finish.');
    }
    await rename(path, retiredPath);
  }
  if (current !== undefined || existingRetired !== undefined) {
    const evidence = await verifyRetiredWorkspace(retiredPath, path);
    if (options.evidence !== undefined && !sameEvidence(options.evidence, evidence)) {
      throw new WorkspaceRemovalError('UNSAFE', 'The retired workspace does not match its saved evidence.');
    }
    if (options.evidence === undefined) {
      await saveRetirementEvidence(options.configStore, options.kind, id, options.projectId, evidence);
    }
    await rm(retiredPath, { recursive: true });
  }
}

function sameEvidence(a: WorkspaceRetirementEvidence, b: WorkspaceRetirementEvidence): boolean {
  return a.version === b.version &&
    a.projectDevice === b.projectDevice && a.projectInode === b.projectInode;
}

async function saveRetirementEvidence(
  configStore: ConfigStore,
  kind: 'test' | 'discovery',
  id: string,
  projectId: string,
  evidence: WorkspaceRetirementEvidence,
): Promise<void> {
  await configStore.update((current) => {
    const records = kind === 'test' ? current.testWorkspaces : current.discoveryWorkspaces;
    const record = records.find((item) => item.id === id);
    if (record === undefined || record.projectId !== projectId ||
        (record.retirement !== undefined && !sameEvidence(record.retirement, evidence))) {
      throw new WorkspaceRemovalError('UNSAFE', 'The workspace ownership record changed during retirement.');
    }
    return kind === 'test'
      ? { testWorkspaces: current.testWorkspaces.map((item) => item.id === id ? { ...item, retirement: evidence } : item) }
      : { discoveryWorkspaces: current.discoveryWorkspaces.map((item) => item.id === id ? { ...item, retirement: evidence } : item) };
  });
}

async function verifyRetiredWorkspace(
  retiredPath: string,
  originalPath: string,
): Promise<WorkspaceRetirementEvidence> {
  const directory = await lstat(retiredPath, { bigint: true });
  const databasePath = join(retiredPath, '.loom', 'project-claim.sqlite');
  const databaseFile = await lstat(databasePath);
  if (!directory.isDirectory() || directory.isSymbolicLink() || await realpath(retiredPath) !== retiredPath ||
      !databaseFile.isFile() || databaseFile.isSymbolicLink() || databaseFile.nlink !== 1 ||
      databaseFile.size > 8 * 1024 * 1024 || await realpath(databasePath) !== databasePath) {
    throw new WorkspaceRemovalError('UNSAFE', 'The retired workspace is unsafe.');
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const version = database.prepare('PRAGMA user_version').get();
    const application = database.prepare('PRAGMA application_id').get();
    const rows = database.prepare('SELECT id, document FROM lifecycle').all();
    if (version?.user_version !== PROJECT_CLAIM_DATABASE_VERSION ||
        application?.application_id !== PROJECT_CLAIM_APPLICATION_ID ||
        rows.length !== 1 || rows[0]?.id !== 1 || typeof rows[0].document !== 'string' ||
        Buffer.byteLength(rows[0].document, 'utf8') > 4096) {
      throw new WorkspaceRemovalError('UNSAFE', 'The workspace retirement record is invalid.');
    }
    const record = ProjectRetirementSchema.safeParse(JSON.parse(rows[0].document) as unknown);
    if (!record.success || record.data.projectPath !== originalPath ||
        record.data.projectDevice !== String(directory.dev) || record.data.projectInode !== String(directory.ino)) {
      throw new WorkspaceRemovalError('UNSAFE', 'The workspace retirement record does not match the retired directory.');
    }
    return {
      version: 1,
      projectDevice: String(directory.dev),
      projectInode: String(directory.ino),
    };
  } finally {
    database.close();
  }
}
