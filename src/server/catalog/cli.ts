import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import {
  REMOTE_CATALOG_DEFAULT_LIMITS,
  REMOTE_CATALOG_HARD_LIMITS,
} from '../config/schema.js';
import { ConfigError, readConfigSnapshot, resolveConfigDir } from '../config/store.js';
import {
  listRemoteSkillSnapshots,
  listRemoteSnapshotPage,
  inspectRemoteSnapshotCandidate,
  RemoteSourceError,
} from './remote.js';
import { callControl, ControlError } from '../control.js';
import { WindowsControlSecurityError } from '../windows-control.js';
import { CliInputError, readJsonStdin } from '../cli-input.js';

class CatalogCliUsageError extends Error {}

const USAGE = `Usage:
  skill-loom catalog source list [--config-dir <path>]
  skill-loom catalog source add [--config-dir <path>]                 # JSON on stdin
  skill-loom catalog source remove --source <id> [--config-dir <path>]
  skill-loom catalog source refresh --source <id> [--revision <saved-commit>] [--config-dir <path>]
  skill-loom catalog limits show [--source <id>] [--config-dir <path>]
  skill-loom catalog limits set [--config-dir <path>]                  # JSON on stdin
  skill-loom catalog limits source --source <id> [--config-dir <path>]  # JSON on stdin
  skill-loom catalog snapshot list --source <id> [--config-dir <path>]
  skill-loom catalog project page [--config-dir <path>]                 # JSON on stdin
  skill-loom catalog snapshot page --source <id> --revision <commit> --kind <skill|agent>
    [--search <text>] [--offset <number>] [--limit <number>] [--config-dir <path>]
  skill-loom catalog snapshot inspect --source <id> --revision <commit> --kind <skill|agent>
    --path <repository-path> [--config-dir <path>]
  skill-loom catalog skill review [--config-dir <path>]                # JSON on stdin
  skill-loom catalog skill install [--config-dir <path>]               # JSON on stdin
  skill-loom catalog skill export [--config-dir <path>]                # JSON on stdin

Source and snapshot read-only commands work offline. Project catalog discovery
and mutations require the running local service. Project page reads
{"projectId":"...","harness":"opencode","query":"","offset":0,"limit":50};
optional sources, enabled, tags, tools, inputs, outputs, hasTags, hasTools,
hasInputs, and hasOutputs filter the indexed path. Warnings use a separate
warningsOffset cursor. Pass the returned snapshotId with the same project,
harness, query, and filters for subsequent pages.
Source add reads {"repository":"https://...","ref":"main"}; limits set/source
read {"limits":{...}} (use null to clear a source override).
Skill review reads {"projectId":"...","harness":"opencode","candidate":
{"id":"...","source":"remote","sourceId":"...","revision":"...",
"repositoryPath":"...","fingerprint":"..."}} and returns a reviewDigest.
Skill install repeats that request with the digest and "confirmed":true.
Installation targets the project's shared .agents/skills directory, never
overwrites, and never suffixes a conflicting name. Skill export reads a
registered "projectId", "harness", and selected {"id":"...","fingerprint":"..."}
entries; it returns only those unchanged host-global packages as a bounded
versioned manifest. It never accepts a client project path.`;

export async function runCatalogCli(
  argv: readonly string[],
  options: {
    stdout: Pick<NodeJS.WriteStream, 'write'>;
    stderr: Pick<NodeJS.WriteStream, 'write'>;
    env: NodeJS.ProcessEnv;
    stdin: Readable;
  },
): Promise<number> {
  try {
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
      options.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h') &&
        ['source', 'limits', 'snapshot', 'project', 'skill'].includes(argv[0] ?? '')) {
      options.stdout.write(`${USAGE}\n`);
      return 0;
    }
    const operation = `${argv[0] ?? ''} ${argv[1] ?? ''}`;
    const allowed = operation === 'source list'
      ? ['config-dir']
      : operation === 'limits show'
        ? ['config-dir', 'source']
        : operation === 'source add' || operation === 'limits set'
          ? ['config-dir']
          : operation === 'source refresh'
            ? ['config-dir', 'source', 'revision']
          : operation === 'source remove' || operation === 'limits source'
            ? ['config-dir', 'source']
        : operation === 'project page'
          ? ['config-dir']
        : operation === 'snapshot list'
          ? ['config-dir', 'source']
          : operation === 'snapshot page'
            ? ['config-dir', 'source', 'revision', 'kind', 'search', 'offset', 'limit']
          : operation === 'snapshot inspect'
            ? ['config-dir', 'source', 'revision', 'kind', 'path']
            : operation === 'skill review' || operation === 'skill install' || operation === 'skill export'
              ? ['config-dir']
              : null;
    if (allowed === null) throw new CatalogCliUsageError('Unknown catalog command.');
    if (argv.length === 3 && (argv[2] === '--help' || argv[2] === '-h')) {
      options.stdout.write(`${USAGE}\n`);
      return 0;
    }
    const flags = new Map<string, string>();
    for (let index = 2; index < argv.length; index += 2) {
      const key = argv[index];
      const value = argv[index + 1];
      if (key === undefined || !key.startsWith('--') || !allowed.includes(key.slice(2)) ||
          value === undefined || value.startsWith('--') || flags.has(key.slice(2))) {
        throw new CatalogCliUsageError('Invalid or repeated catalog option.');
      }
      flags.set(key.slice(2), value);
    }
    const required = (name: string): string => {
      const value = flags.get(name);
      if (value === undefined || value.trim() === '') {
        throw new CatalogCliUsageError(`--${name} is required.`);
      }
      return value;
    };
    const integer = (name: string): number | undefined => {
      const value = flags.get(name);
      if (value === undefined) return undefined;
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new CatalogCliUsageError(`--${name} must be a non-negative integer.`);
      }
      return Number(value);
    };
    const env = {
      ...options.env,
      ...(flags.has('config-dir') ? { LOOM_CONFIG_DIR: resolve(required('config-dir')) } : {}),
    };
    const configDirectory = resolveConfigDir({ env });
    let result: unknown;
    if (['source add', 'source remove', 'source refresh', 'limits set', 'limits source', 'project page',
      'skill review', 'skill install', 'skill export'].includes(operation)) {
      let input: unknown;
      if (operation === 'source add' || operation === 'limits set' || operation === 'project page' ||
          operation === 'skill review' || operation === 'skill install' || operation === 'skill export') {
        input = await readJsonStdin(options.stdin);
      } else if (operation === 'limits source') {
        const parsed = z.strictObject({ limits: z.unknown() }).safeParse(await readJsonStdin(options.stdin));
        if (!parsed.success) throw new CatalogCliUsageError('Stdin must contain a limits field.');
        input = { sourceId: required('source'), limits: parsed.data.limits };
      } else {
        input = {
          sourceId: required('source'),
          ...(operation === 'source refresh' && flags.has('revision') ? { revision: required('revision') } : {}),
        };
      }
      const controlOperation = operation === 'skill export'
        ? 'catalog.skills.export' : `catalog.${operation.replace(' ', '.')}`;
      const response = await callControl(configDirectory, controlOperation, input);
      if (!response.ok) {
        options.stderr.write(`${JSON.stringify(response)}\n`);
        return 1;
      }
      result = response.result;
    } else if (operation === 'source list') {
      result = { sources: (await readConfigSnapshot({ env })).remoteSkillSources };
    } else if (operation === 'limits show') {
      const config = await readConfigSnapshot({ env });
      const sourceId = flags.get('source');
      const source = sourceId === undefined ? undefined : config.remoteSkillSources.find((item) => item.id === sourceId);
      if (sourceId !== undefined && source === undefined) {
        throw new RemoteSourceError('REMOTE_SOURCE_NOT_FOUND', 'The configured remote skill source was not found.', { sourceId });
      }
      result = {
        global: config.remoteCatalogLimits,
        defaults: REMOTE_CATALOG_DEFAULT_LIMITS,
        maximums: REMOTE_CATALOG_HARD_LIMITS,
        ...(source === undefined ? {} : {
          sourceId: source.id,
          overrides: source.limits ?? {},
          effective: { ...config.remoteCatalogLimits, ...source.limits },
        }),
      };
    } else if (operation === 'snapshot list') {
      const sourceId = required('source');
      const snapshots = await listRemoteSkillSnapshots(configDirectory, sourceId);
      result = { snapshots: snapshots.map((snapshot) => ({
        sourceId: snapshot.sourceId,
        repository: snapshot.repository,
        revision: snapshot.revision,
        skills: snapshot.packages.length,
        agents: snapshot.agents.length,
      })) };
    } else if (operation === 'snapshot inspect') {
      result = await inspectRemoteSnapshotCandidate(configDirectory, required('source'), required('revision'), {
        kind: required('kind'), repositoryPath: required('path'),
      });
    } else {
      result = await listRemoteSnapshotPage(configDirectory, required('source'), required('revision'), {
        kind: required('kind'),
        ...(flags.has('search') ? { search: flags.get('search') } : {}),
        ...(flags.has('offset') ? { offset: integer('offset') } : {}),
        ...(flags.has('limit') ? { limit: integer('limit') } : {}),
      });
    }
    options.stdout.write(`${JSON.stringify({ protocolVersion: 1, ok: true, result })}\n`);
    return 0;
  } catch (error) {
    if (error instanceof CatalogCliUsageError || error instanceof CliInputError) {
      options.stderr.write(`${JSON.stringify({ protocolVersion: 1, ok: false, error: {
        code: 'CLI_USAGE', message: error.message,
      } })}\n`);
      return 2;
    }
    if (error instanceof ConfigError || error instanceof RemoteSourceError || error instanceof ControlError || error instanceof WindowsControlSecurityError) {
      options.stderr.write(`${JSON.stringify({ protocolVersion: 1, ok: false, error: {
        code: error.code, message: error.message, details: error.details,
      } })}\n`);
      return 1;
    }
    options.stderr.write(`${JSON.stringify({ protocolVersion: 1, ok: false, error: {
      code: 'CATALOG_READ_FAILED', message: 'The catalog could not be read.',
    } })}\n`);
    return 1;
  }
}
