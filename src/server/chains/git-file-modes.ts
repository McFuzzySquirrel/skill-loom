import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BundleError, MAX_BUNDLE_FILES } from '../../portable/bundle.js';

const execFileAsync = promisify(execFile);
const MAX_INDEX_OUTPUT = 2 * 1024 * 1024;

/**
 * Windows filesystem modes do not represent Git's executable bit. Only use
 * stage-zero regular-file entries from the enclosing repository's index.
 */
export async function readGitExecutablePaths(
  packagePath: string,
  filePaths: readonly string[],
): Promise<Set<string>> {
  let stdout: Buffer;
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  }
  try {
    ({ stdout } = await execFileAsync('git', [
      '-c', 'core.fsmonitor=false',
      '--no-optional-locks',
      '-C', packagePath,
      'ls-files', '--stage', '-z', '--', '.',
    ], {
      encoding: 'buffer', timeout: 15_000, maxBuffer: MAX_INDEX_OUTPUT, windowsHide: true, env,
    }));
  } catch {
    throw new BundleError(
      'BUNDLE_SOURCE_UNAVAILABLE',
      'Windows cannot determine Git executable modes for this package. Track its files in Git and retry.',
    );
  }
  const index = new Map<string, boolean>();
  const output = stdout.toString('utf8');
  if (!Buffer.from(output, 'utf8').equals(stdout)) {
    throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The package Git index contains unsupported file names.');
  }
  const records = output.split('\0');
  if (records.pop() !== '' || records.length > MAX_BUNDLE_FILES) {
    throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The package Git index is invalid or too large to inspect.');
  }
  for (const record of records) {
    const match = /^(100644|100755) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([^\0]+)$/.exec(record);
    if (match === null || index.has(match[3]!)) {
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The package Git index contains unsupported or conflicting entries.');
    }
    index.set(match[3]!, match[1] === '100755');
  }
  const executablePaths = new Set<string>();
  for (const path of filePaths) {
    const executable = index.get(path);
    if (executable === undefined) {
      throw new BundleError(
        'BUNDLE_SOURCE_UNAVAILABLE',
        'Windows cannot determine executable modes for untracked package files. Track every package file in Git and retry.',
      );
    }
    if (executable) executablePaths.add(path);
  }
  return executablePaths;
}
