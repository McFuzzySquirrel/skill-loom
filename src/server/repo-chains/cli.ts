import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { CliInputError, readJsonStdin } from '../cli-input.js';
import { ChainError } from '../chains/model.js';
import { DraftPayloadSchema } from '../chains/drafts.js';
import { chainRevision, ChainServiceError } from '../chains/service.js';
import { ChainStoreError } from '../chains/store.js';
import { createRepoChainRepository, RepoPublicationError } from './store.js';

const HELP = `Usage:
  skill-loom chain repo list [--repo <path>]
  skill-loom chain repo show|validate --id <id> [--repo <path>]
  skill-loom chain repo create [--repo <path>]                 # JSON on stdin: {"draft":{...}}
  skill-loom chain repo update --id <id> --revision <sha256> [--repo <path>] # JSON on stdin
  skill-loom chain repo copy --id <id> [--name <name>] [--repo <path>]

Repository chains are stored in ./chains/<id>.json with a separate
./chains/<id>.publish.json sidecar. Publishing uses
skill-loom-podman chain repo publish so repository paths stay on the client.`;

type CliOptions = {
  stdin: Readable;
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  cwd?: string;
};

function parseFlags(args: readonly string[], allowed: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === undefined || !allowed.includes(option) || value === undefined ||
        value.startsWith('--') || value.trim() === '' || flags.has(option)) {
      throw new CliInputError('Invalid or repeated repository chain option.');
    }
    flags.set(option, value);
  }
  return flags;
}

function writeSuccess(stdout: CliOptions['stdout'], result: unknown): void {
  stdout.write(`${JSON.stringify({ protocolVersion: 1, ok: true, result })}\n`);
}

function writeFailure(stderr: CliOptions['stderr'], error: unknown): number {
  const known = error instanceof CliInputError || error instanceof ChainError ||
    error instanceof ChainStoreError || error instanceof ChainServiceError ||
    error instanceof RepoPublicationError;
  stderr.write(`${JSON.stringify({
    protocolVersion: 1,
    ok: false,
    error: {
      code: error instanceof CliInputError ? 'CLI_USAGE'
        : known && 'code' in error ? error.code : 'REPO_CHAIN_FAILED',
      message: known ? error.message : 'The repository chain operation failed.',
      ...(known && 'details' in error ? { details: error.details } : {}),
    },
  })}\n`);
  return error instanceof CliInputError ? 2 : 1;
}

export async function runRepoChainCli(
  args: readonly string[],
  options: CliOptions,
): Promise<number> {
  try {
    const command = args[2];
    if (command === undefined || command === '--help' || command === '-h' ||
        args.at(-1) === '--help' || args.at(-1) === '-h') {
      options.stdout.write(`${HELP}\n`);
      return 0;
    }
    if (command === 'publish' || command === 'link' || command === 'republish') {
      throw new CliInputError(`Use skill-loom-podman chain repo ${command}; publication requires the hosted Podman connection.`);
    }

    const flagNames = command === 'update' ? ['--repo', '--id', '--revision']
      : command === 'copy' ? ['--repo', '--id', '--name']
        : command === 'show' || command === 'validate' ? ['--repo', '--id']
          : command === 'list' || command === 'create' ? ['--repo'] : [];
    if (flagNames.length === 0) throw new CliInputError('Unknown repository chain command.');
    const flags = parseFlags(args.slice(3), flagNames);
    const requiresId = ['show', 'validate', 'update', 'copy'].includes(command);
    const chainId = flags.get('--id');
    if (requiresId !== (chainId !== undefined)) {
      throw new CliInputError(requiresId ? '--id is required.' : '--id is not supported by this command.');
    }
    if ((command === 'update') !== flags.has('--revision')) {
      throw new CliInputError(command === 'update' ? '--revision is required.' : '--revision is not supported by this command.');
    }
    if (command !== 'copy' && flags.has('--name')) {
      throw new CliInputError('--name is supported only by copy.');
    }

    const repositoryPath = resolve(flags.get('--repo') ?? options.cwd ?? process.cwd());
    const repository = await createRepoChainRepository(repositoryPath);
    switch (command) {
      case 'list':
        writeSuccess(options.stdout, await repository.list());
        return 0;
      case 'show': {
        const chain = await repository.service.get(repository.root, chainId!);
        writeSuccess(options.stdout, {
          chain,
          revision: chainRevision(chain),
          publication: await repository.readPublication(chain.id),
        });
        return 0;
      }
      case 'validate': {
        const chain = await repository.service.get(repository.root, chainId!);
        writeSuccess(options.stdout, { valid: true, chain, revision: chainRevision(chain) });
        return 0;
      }
      case 'create': {
        const input = z.strictObject({ draft: DraftPayloadSchema }).safeParse(await readJsonStdin(options.stdin));
        if (!input.success) throw new CliInputError('Create requires {"draft":{...}} on stdin.');
        const chain = await repository.service.create(repository.root, input.data.draft, { uniqueName: true });
        writeSuccess(options.stdout, { chain, revision: chainRevision(chain) });
        return 0;
      }
      case 'update': {
        const input = z.strictObject({ draft: DraftPayloadSchema }).safeParse(await readJsonStdin(options.stdin));
        if (!input.success) throw new CliInputError('Update requires {"draft":{...}} on stdin.');
        const expectedRevision = flags.get('--revision');
        if (expectedRevision === undefined || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
          throw new CliInputError('--revision must be the 64-character revision returned by show or the previous update.');
        }
        const chain = await repository.service.update(
          repository.root,
          chainId!,
          input.data.draft,
          { expectedRevision, uniqueName: true },
        );
        writeSuccess(options.stdout, { chain, revision: chainRevision(chain) });
        return 0;
      }
      case 'copy': {
        const name = flags.get('--name');
        const chain = await repository.service.duplicate(repository.root, chainId!, {
          ...(name === undefined ? {} : { name }),
          uniqueName: true,
        });
        writeSuccess(options.stdout, { chain, revision: chainRevision(chain), publication: null });
        return 0;
      }
      default:
        throw new CliInputError('Unknown repository chain command.');
    }
  } catch (error) {
    return writeFailure(options.stderr, error);
  }
}
