import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePortableRunDocument, RUN_ID_PATTERN as PORTABLE_RUN_ID_PATTERN } from '../portable/run-schema.js';
import { parseRunDocument } from '../server/runs/model.js';

const MAX_RECORDS = 1_000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_RECORD_BYTES = 30 * 1024 * 1024;
const MANAGED_RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface ProjectRunRecord {
  kind: 'managed' | 'portable';
  runId: string;
  status: string;
  fingerprint: string;
  /** Whether previous work or a host attempt may still need reconciliation. */
  unresolved: boolean;
}

export class ProjectRunRecordsError extends Error {
  readonly code = 'PROJECT_RUN_RECORDS_UNSAFE';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProjectRunRecordsError';
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readRecord(path: string, remaining: number): Promise<{
  document: unknown; bytes: number; fingerprint: string;
}> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    const maximum = Math.min(MAX_RECORD_BYTES, remaining);
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum)) {
      throw new ProjectRunRecordsError('A project run record is unsafe or exceeds the scan budget.');
    }
    const content = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await file.read(content, offset, content.length - offset, offset);
      if (bytesRead === 0) throw new ProjectRunRecordsError('A project run record changed during inspection.');
      offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new ProjectRunRecordsError('A project run record changed during inspection.');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    return {
      document: JSON.parse(text) as unknown,
      bytes: content.length,
      fingerprint: createHash('sha256').update(content).digest('hex'),
    };
  } finally {
    await file.close();
  }
}

/**
 * Validate bounded legacy records while holding the project claim transaction.
 * The scan reports uncertainty; it does not decide that prior work has stopped.
 */
export async function scanProjectRunRecords(project: string): Promise<ProjectRunRecord[]> {
  const records: ProjectRunRecord[] = [];
  let bytes = 0;
  for (const kind of ['managed', 'portable'] as const) {
    const directory = join(project, '.loom', kind === 'managed' ? 'runs' : 'portable-runs');
    let info;
    try {
      info = await lstat(directory);
    } catch (error) {
      if (isMissing(error)) continue;
      throw new ProjectRunRecordsError('The project run directory could not be inspected.', { cause: error });
    }
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new ProjectRunRecordsError('The project run directory is unsafe.');
    }
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -'.json'.length);
      if (!(kind === 'managed' ? MANAGED_RUN_ID_PATTERN : PORTABLE_RUN_ID_PATTERN).test(id)) {
        throw new ProjectRunRecordsError('A project run record has an invalid name.');
      }
      if (records.length >= MAX_RECORDS) throw new ProjectRunRecordsError('The project run record count exceeds the scan budget.');
      try {
        const result = await readRecord(join(directory, entry.name), MAX_TOTAL_BYTES - bytes);
        bytes += result.bytes;
        if (kind === 'managed') {
          const run = parseRunDocument(result.document);
          if (run.id !== id) throw new ProjectRunRecordsError('A project run record id does not match its filename.');
          records.push({
            kind, runId: id, status: run.status, fingerprint: result.fingerprint,
            unresolved: (run.status !== 'completed' && run.status !== 'aborted') ||
              run.steps.some((step) => step.status === 'running'),
          });
        } else {
          const run = parsePortableRunDocument(result.document, project, id);
          if (run === null) throw new ProjectRunRecordsError('A portable run record is invalid.');
          const unresolvedAttempt = run.resumeRequired ||
            run.steps.some((step) => step.attempts.some((attempt) => attempt.status === 'running'));
          records.push({
            kind, runId: id, status: run.status, fingerprint: result.fingerprint,
            unresolved: unresolvedAttempt || (run.status !== 'completed' && run.status !== 'aborted'),
          });
        }
      } catch (error) {
        if (error instanceof ProjectRunRecordsError) throw error;
        throw new ProjectRunRecordsError('A project run record could not be validated.', { cause: error });
      }
    }
  }
  return records.sort((left, right) => left.kind.localeCompare(right.kind) || left.runId.localeCompare(right.runId));
}
import { createHash } from 'node:crypto';
