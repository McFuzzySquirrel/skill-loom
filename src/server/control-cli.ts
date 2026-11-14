import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { CliInputError, readJsonStdin } from './cli-input.js';
import { resolveConfigDir } from './config/store.js';
import { attachControlTerminal, callControl, ControlError, streamControlEvents } from './control.js';
import { WindowsControlSecurityError } from './windows-control.js';

const HELP = `Usage:
  skill-loom project list [--config-dir <path>]
  skill-loom project open [--config-dir <path>]                 # JSON on stdin
  skill-loom project coordination-review [--config-dir <path>]  # JSON on stdin
  skill-loom project coordination-action [--config-dir <path>]  # JSON on stdin
  skill-loom chain draft list [--config-dir <path>]
  skill-loom chain draft show --draft <id> [--config-dir <path>]
  skill-loom chain draft create|validate [--config-dir <path>]   # JSON on stdin
  skill-loom chain draft update|remove [--config-dir <path>]     # JSON on stdin
  skill-loom chain project list|show|create|update|remove|apply|export|publish [--config-dir <path>] # JSON on stdin
  skill-loom bundle review|import [--config-dir <path>]         # JSON on stdin
  skill-loom discovery handoff [--config-dir <path>]            # JSON on stdin
  skill-loom run preflight [--config-dir <path>]               # JSON on stdin
  skill-loom run review-start|start [--config-dir <path>]     # JSON on stdin; restricted instruction-only
  skill-loom run list [--config-dir <path>]                   # JSON on stdin: {"projectId":"..."}
  skill-loom run active [--config-dir <path>]
  skill-loom run show [--config-dir <path>]                   # JSON on stdin
  skill-loom run events [--config-dir <path>]                 # JSON on stdin; JSON Lines on stdout
  skill-loom run attach --run <id> [--config-dir <path>]      # interactive TTY; Ctrl-] detaches
  skill-loom run review-action|action [--config-dir <path>]   # JSON on stdin
  skill-loom run abort [--config-dir <path>]                  # JSON on stdin
  skill-loom workspace list [--config-dir <path>]
  skill-loom workspace create|inspect|evaluate|remove [--config-dir <path>]  # JSON on stdin

Project open reads {"path":"/absolute/project"}. Coordination review reads
{"projectId":"..."}, initializes project coordination files if needed, and does
not coordinate execution.
Coordination actions read {"projectId":"...","request":{...}} and require
the current review digest and explicit confirmations for the selected action.
Chain project list reads
{"projectId":"..."}, and show also requires "chainId". Apply reads
{"projectId":"...","chainId":"..."} and copies the chain's current global
skills into the project's .agents/skills directory without overwriting existing
packages. Export reads the same request and returns only the current global
skill packages referenced by the chain as a bounded versioned transfer
manifest. Updates require a
reviewed "expectedRevision" and "draft"; removes require "expectedRevision"
and "confirmed":true. Draft create and validate
read a chain draft object. Validate checks the chain model only; it does not
verify source availability, conflicts, harness readiness, or permissions.
Publish reads {"projectId":"...","repoChainId":"...","chain":{...}} on first
publication, or also "publication":{"repoChainId":"...","hostedChainId":"...",
"hostedRevision":"<sha256>"} for an update. The client repository path is not
accepted. Publish requires each skill to resolve uniquely in the hosted catalog.
Discovery handoff reads {"goal":"...","harness":"opencode","candidates":[
{"sourceId":"...","revision":"<commit>","repositoryPath":"...","fingerprint":"..."}]}.
Handoff content is untrusted and preparation does not approve redistribution
or execution.

Run list reads {"projectId":"..."}; show and events read {"runId":"..."}.
Review-start reads {"projectId":"...","chainId":"...","mode":"supervised","inputs":{}}.
Start requires that same request, its "reviewDigest", and "confirmed":true.
Review-action reads {"runId":"...","action":"..."}; action requires the same
fields, its "reviewDigest", and "confirmed":true. Execution, live testing,
automatic progression, broad permissions, and replay require separate approvals.
Skill-bearing managed CLI starts remain blocked. See docs/admin-guide.md for
request details, restrictions, and confirmation fields.

Workspace create reads {"sourceDraftId":"..."} or
{"sourceProjectId":"...","sourceChainId":"..."}. Inspect reads
{"workspaceId":"...","path":"relative/path"}; evaluate reads
{"workspaceId":"...","checks":[{"path":"relative/path"}]}.
Remove reads {"workspaceId":"...","confirmed":true}. A workspace is not an OS
sandbox; creation does not approve execution or deletion.`;

export async function runControlCli(
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv;
    stdin: Readable;
    stdout: Pick<NodeJS.WriteStream, 'write' | 'isTTY'> & Partial<Pick<NodeJS.WriteStream, 'columns' | 'rows'>>;
    stderr: Pick<NodeJS.WriteStream, 'write'>;
  },
): Promise<number> {
  try {
    if ((args.at(-1) === '--help' || args.at(-1) === '-h') &&
        ['project', 'chain draft', 'chain project', 'chain', 'run', 'workspace', 'discovery'].includes(args.slice(0, -1).join(' '))) {
      options.stdout.write(`${HELP}\n`);
      return 0;
    }
    const prefix = args[0] === 'chain' ? 3 : 2;
    const key = args.slice(0, prefix).join(' ');
    const operations: Record<string, { operation: string; input: 'none' | 'json' | 'draft' | 'run' }> = {
      'project list': { operation: 'project.list', input: 'none' },
      'project open': { operation: 'project.open', input: 'json' },
      'project coordination-review': { operation: 'project.coordination.review', input: 'json' },
      'project coordination-action': { operation: 'project.coordination.action', input: 'json' },
      'chain draft list': { operation: 'draft.list', input: 'none' },
      'chain draft show': { operation: 'draft.get', input: 'draft' },
      'chain draft create': { operation: 'draft.create', input: 'json' },
      'chain draft validate': { operation: 'draft.validate', input: 'json' },
      'chain draft update': { operation: 'draft.update', input: 'json' },
      'chain draft remove': { operation: 'draft.remove', input: 'json' },
      'chain project list': { operation: 'chain.project.list', input: 'json' },
      'chain project show': { operation: 'chain.project.get', input: 'json' },
      'chain project create': { operation: 'chain.project.create', input: 'json' },
      'chain project update': { operation: 'chain.project.update', input: 'json' },
      'chain project remove': { operation: 'chain.project.remove', input: 'json' },
      'chain project apply': { operation: 'chain.project.apply', input: 'json' },
      'chain project export': { operation: 'chain.project.export', input: 'json' },
      'chain project publish': { operation: 'chain.project.publish', input: 'json' },
      'bundle review': { operation: 'bundle.review', input: 'json' },
      'bundle import': { operation: 'bundle.import', input: 'json' },
      'discovery handoff': { operation: 'discovery.handoff', input: 'json' },
      'run preflight': { operation: 'run.preflight', input: 'json' },
      'run review-start': { operation: 'run.start.review', input: 'json' },
      'run start': { operation: 'run.start', input: 'json' },
      'run list': { operation: 'run.list', input: 'json' },
      'run active': { operation: 'run.active', input: 'none' },
      'run show': { operation: 'run.show', input: 'json' },
      'run events': { operation: 'run.events', input: 'json' },
      'run attach': { operation: 'run.attach', input: 'run' },
      'run review-action': { operation: 'run.action.review', input: 'json' },
      'run action': { operation: 'run.action', input: 'json' },
      'run abort': { operation: 'run.abort', input: 'json' },
      'workspace list': { operation: 'workspace.list', input: 'none' },
      'workspace create': { operation: 'workspace.create', input: 'json' },
      'workspace inspect': { operation: 'workspace.inspect', input: 'json' },
      'workspace evaluate': { operation: 'workspace.evaluate', input: 'json' },
      'workspace remove': { operation: 'workspace.remove', input: 'json' },
    };
    const command = operations[key];
    if (command === undefined) throw new CliInputError('Unknown project, draft, bundle, run, or workspace command.');
    if (args.length === prefix + 1 && (args[prefix] === '--help' || args[prefix] === '-h')) {
      options.stdout.write(`${HELP}\n`);
      return 0;
    }
    const flags = new Map<string, string>();
    for (let index = prefix; index < args.length; index += 2) {
      const option = args[index];
      const value = args[index + 1];
      if (option === undefined || !['--config-dir', '--draft', '--run'].includes(option) ||
          value === undefined || value.startsWith('--') || value.trim() === '' || flags.has(option)) {
        throw new CliInputError('Invalid or repeated command option.');
      }
      flags.set(option, value);
    }
    if ((command.input === 'draft') !== flags.has('--draft')) {
      throw new CliInputError(command.input === 'draft' ? '--draft is required.' : '--draft is not supported by this command.');
    }
    if ((command.input === 'run') !== flags.has('--run')) {
      throw new CliInputError(command.input === 'run' ? '--run is required.' : '--run is not supported by this command.');
    }
    const configDir = flags.get('--config-dir');
    const env = {
      ...options.env,
      ...(configDir === undefined ? {} : { LOOM_CONFIG_DIR: resolve(configDir) }),
    };
    if (command.input === 'run') {
      const runId = flags.get('--run');
      if (runId === undefined) throw new CliInputError('--run is required.');
      if ('isTTY' in options.stdin && options.stdin.isTTY === true && options.stdout.isTTY === true) {
        options.stderr.write('Press Ctrl-] to detach; the run will continue.\n');
      }
      await attachControlTerminal(resolveConfigDir({ env }), runId, options.stdin, options.stdout);
      return 0;
    }
    const input = command.input === 'json' ? await readJsonStdin(options.stdin)
      : command.input === 'draft' ? { draftId: flags.get('--draft') } : {};
    if (command.operation === 'run.events') {
      const request = z.strictObject({ runId: z.string().min(1).max(64) }).safeParse(input);
      if (!request.success) throw new CliInputError('Run events requires {"runId":"..."} on stdin.');
      await streamControlEvents(resolveConfigDir({ env }), request.data.runId,
        (event) => options.stdout.write(`${JSON.stringify(event)}\n`));
      return 0;
    }
    const response = await callControl(resolveConfigDir({ env }), command.operation, input);
    (response.ok ? options.stdout : options.stderr).write(`${JSON.stringify(response)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    const known = error instanceof CliInputError || error instanceof ControlError || error instanceof WindowsControlSecurityError;
    options.stderr.write(`${JSON.stringify({ protocolVersion: 1, ok: false, error: {
      code: error instanceof CliInputError ? 'CLI_USAGE'
        : error instanceof ControlError || error instanceof WindowsControlSecurityError ? error.code : 'CONTROL_FAILED',
      message: known ? error.message : 'The local control request failed.',
    } })}\n`);
    return error instanceof CliInputError ? 2 : 1;
  }
}
