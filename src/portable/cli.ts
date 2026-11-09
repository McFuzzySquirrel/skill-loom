#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BundleError } from './bundle.js';
import { executePortableRequest, PortableRunError, type PortableRequest } from './runtime.js';
import { ProjectClaimError } from '../shared/project-claim.js';
import { ProjectCoordinationError } from '../shared/project-coordination.js';
import { ProjectRunRecordsError } from '../shared/project-run-records.js';

const COMMANDS = ['inspect', 'prepare', 'status', 'step', 'record', 'resume'] as const;
type Command = (typeof COMMANDS)[number];

export function parsePortableArgs(argv: readonly string[]): PortableRequest {
  const command = argv[0];
  if (!COMMANDS.includes(command as Command)) {
    throw new PortableRunError('USAGE', `Usage: loom-bundle <${COMMANDS.join('|')}> [--bundle PATH] [--project PATH] [--run-id ID]`);
  }
  const request: PortableRequest = { command: command as Command };
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (option !== '--bundle' && option !== '--project' && option !== '--run-id') {
      throw new PortableRunError('USAGE', `Unknown option "${option}".`);
    }
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new PortableRunError('USAGE', `Option "${option}" needs a value.`);
    }
    index += 1;
    if (option === '--bundle') request.bundlePath = value;
    if (option === '--project') request.projectPath = value;
    if (option === '--run-id') request.runId = value;
  }
  if (request.command !== 'inspect' && request.projectPath === undefined) {
    throw new PortableRunError('USAGE', 'This command needs --project PATH.');
  }
  if (['status', 'step', 'record', 'resume'].includes(request.command) && request.runId === undefined) {
    throw new PortableRunError('USAGE', 'This command needs --run-id ID.');
  }
  return request;
}

export async function runPortableCli(
  argv: readonly string[] = process.argv.slice(2),
  streams: {
    stdin?: NodeJS.ReadableStream;
    stdout?: Pick<NodeJS.WriteStream, 'write'>;
    stderr?: Pick<NodeJS.WriteStream, 'write'>;
  } = {},
): Promise<number> {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  try {
    const request = parsePortableArgs(argv);
    const inputText = request.command === 'inspect'
      ? ''
      : await readStdin(streams.stdin ?? process.stdin);
    if (inputText.trim() !== '') request.input = JSON.parse(inputText) as unknown;
    const result = await executePortableRequest(request);
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const known = error instanceof PortableRunError || error instanceof BundleError ||
      error instanceof ProjectClaimError || error instanceof ProjectCoordinationError ||
      error instanceof ProjectRunRecordsError;
    const code = known
      ? error.code
      : error instanceof SyntaxError ? 'JSON_INVALID' : 'REQUEST_FAILED';
    const message = known
      ? error.message
      : error instanceof SyntaxError
        ? 'Structured helper input is not valid JSON.'
        : 'The portable helper could not complete the request. Check file permissions and retry.';
    stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    return 1;
  }
}

async function readStdin(input: NodeJS.ReadableStream | undefined): Promise<string> {
  if (input === undefined) return '';
  if ('isTTY' in input && input.isTTY === true) return '';
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > 8 * 1024 * 1024) throw new PortableRunError('REQUEST_TOO_LARGE', 'Structured helper input is limited to 8 MiB.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || !['loom-bundle.mjs', 'cli.js'].includes(basename(entry))) {
    return false;
  }
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void runPortableCli().then((code) => {
    if (code !== 0) process.exitCode = code;
  });
}
