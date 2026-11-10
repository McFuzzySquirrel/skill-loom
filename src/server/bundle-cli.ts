import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { MAX_BUNDLE_REQUEST_BYTES, parseBundle } from '../portable/bundle.js';
import { CliInputError } from './cli-input.js';
import { resolveConfigDir } from './config/store.js';
import { callControl, ControlError } from './control.js';

export async function createBundleCli(
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv;
    stdout: Pick<NodeJS.WriteStream, 'write'>;
    stderr: Pick<NodeJS.WriteStream, 'write'>;
  },
): Promise<number> {
  let temporary: string | undefined;
  let published = false;
  try {
    if (args.length === 1 && args[0] === '--help') {
      options.stdout.write('Usage: skill-loom bundle create (--draft <id> | --project <id> --chain <id>) --output <absolute-path> [--config-dir <path>]\n');
      return 0;
    }
    const flags = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index];
      const value = args[index + 1];
      if (key === undefined || !['--draft', '--project', '--chain', '--output', '--config-dir'].includes(key) ||
          value === undefined || value.startsWith('--') || value.trim() === '' || flags.has(key)) {
        throw new CliInputError('Invalid or repeated bundle option.');
      }
      flags.set(key, value);
    }
    const draftId = flags.get('--draft');
    const projectId = flags.get('--project');
    const chainId = flags.get('--chain');
    const output = flags.get('--output');
    if (output === undefined || !isAbsolute(output) ||
        !(draftId !== undefined && projectId === undefined && chainId === undefined ||
          draftId === undefined && projectId !== undefined && chainId !== undefined)) {
      throw new CliInputError('Choose --draft or both --project and --chain, and provide an absolute --output path.');
    }
    const target = resolve(output);
    const parent = dirname(target);
    if (!(await lstat(parent)).isDirectory() || await realpath(parent) !== parent) {
      throw new ControlError('BUNDLE_PATH_INVALID', 'The output directory must be an existing canonical directory.');
    }
    const configDir = flags.get('--config-dir');
    const env = { ...options.env, ...(configDir === undefined ? {} : { LOOM_CONFIG_DIR: resolve(configDir) }) };
    const response = draftId !== undefined
      ? await callControl(resolveConfigDir({ env }), 'draft.bundle', { draftId })
      : await callControl(resolveConfigDir({ env }), 'chain.project.bundle', { projectId, chainId });
    if (!response.ok) {
      options.stderr.write(`${JSON.stringify(response)}\n`);
      return 1;
    }
    const bundle = parseBundle(z.strictObject({ bundle: z.unknown() }).parse(response.result).bundle);
    const json = JSON.stringify(bundle);
    if (Buffer.byteLength(json) > MAX_BUNDLE_REQUEST_BYTES) {
      throw new ControlError('BUNDLE_TOO_LARGE', 'The generated bundle exceeds its JSON size limit.');
    }
    const fingerprint = createHash('sha256').update(json).digest('hex');
    temporary = join(parent, `.${basename(target)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${json}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, target);
    published = true;
    await unlink(temporary);
    temporary = undefined;
    const directory = await open(parent, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    options.stdout.write(`${JSON.stringify({ protocolVersion: 1, ok: true, result: {
      path: target, fingerprint, bytes: Buffer.byteLength(json) + 1,
    } })}\n`);
    return 0;
  } catch (error) {
    if (temporary !== undefined) await unlink(temporary).catch(() => undefined);
    const code = published ? 'BUNDLE_WRITE_UNCERTAIN'
      : error instanceof CliInputError ? 'CLI_USAGE'
      : error instanceof ControlError ? error.code
        : error instanceof Error && 'code' in error && error.code === 'EEXIST' ? 'BUNDLE_CONFLICT'
          : 'BUNDLE_WRITE_FAILED';
    const message = published
      ? 'The bundle was created, but its durability or cleanup could not be confirmed. Inspect the output before retrying.'
      : error instanceof CliInputError || error instanceof ControlError
      ? error.message
      : code === 'BUNDLE_CONFLICT' ? 'The output file already exists and was not replaced.'
        : 'The bundle could not be created.';
    options.stderr.write(`${JSON.stringify({ protocolVersion: 1, ok: false, error: { code, message } })}\n`);
    return error instanceof CliInputError ? 2 : 1;
  }
}
