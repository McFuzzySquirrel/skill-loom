import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { ChainAgentSelection } from '../../shared/chain.js';
import type { NativeAgentEntry } from './types.js';

const MAX_AGENT_BYTES = 20 * 1024 * 1024;
const AGENT_ROOTS = {
  opencode: ['.opencode', 'agents'],
  copilot: ['.github', 'agents'],
} as const;

export class NativeAgentCopyError extends Error {
  constructor(
    readonly code:
      | 'NATIVE_AGENT_UNAVAILABLE'
      | 'NATIVE_AGENT_UNSUPPORTED'
      | 'NATIVE_AGENT_CONFLICT'
      | 'NATIVE_AGENT_PATH_INVALID'
      | 'NATIVE_AGENT_COPY_FAILED',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface CopyNativeAgentInput {
  projectPath: string;
  entry: NativeAgentCopySource;
}

export type NativeAgentCopySource = Pick<
  NativeAgentEntry,
  'id' | 'name' | 'harness' | 'path' | 'agentPath' | 'fingerprint' | 'status'
>;

export interface CopyNativeAgentResult {
  name: string;
  harness: NativeAgentEntry['harness'];
  destinationPath: string;
  fingerprint: string;
}

export interface InstallNativeAgentContentInput {
  projectPath: string;
  name: string;
  harness: NativeAgentEntry['harness'];
  agentPath: string;
  fingerprint: string;
  content: Buffer;
}

export type InstalledNativeAgentStatus = 'available' | 'missing' | 'modified' | 'unsafe';

export function installedNativeAgentPath(
  projectPath: string,
  selection: ChainAgentSelection,
): string | null {
  if (!isSafeAgentPath(selection.agentPath, selection.harness)) return null;
  return join(
    projectPath,
    ...AGENT_ROOTS[selection.harness],
    ...selection.agentPath.split('/'),
  );
}

export async function inspectInstalledNativeAgent(input: {
  projectPath: string;
  selection: ChainAgentSelection;
}): Promise<InstalledNativeAgentStatus> {
  const { projectPath, selection } = input;
  if (!isSafeAgentPath(selection.agentPath, selection.harness)) return 'unsafe';

  try {
    const projectRoot = await realpath(projectPath);
    const agentPath = installedNativeAgentPath(projectRoot, selection);
    if (agentPath === null) return 'unsafe';
    const info = await lstat(agentPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_AGENT_BYTES) return 'unsafe';
    const canonical = await realpath(agentPath);
    if (canonical !== agentPath) return 'unsafe';
    const fingerprint = createHash('sha256').update(await readFile(agentPath)).digest('hex');
    return fingerprint === selection.fingerprint ? 'available' : 'modified';
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return 'missing';
    return 'unsafe';
  }
}

export async function copyNativeAgentIntoProject(
  input: CopyNativeAgentInput,
): Promise<CopyNativeAgentResult> {
  const { entry, projectPath } = input;
  if (entry.status !== 'available') {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_UNSUPPORTED',
      'This native agent definition is not supported for chain selection.',
      { agentId: entry.id, status: entry.status },
    );
  }

  if (!isSafeAgentPath(entry.agentPath, entry.harness)) {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_PATH_INVALID',
      'The native agent path is invalid and was not copied.',
      { agentId: entry.id },
    );
  }

  let projectRoot: string;
  let source: Buffer;
  try {
    projectRoot = await realpath(projectPath);
    const sourceInfo = await lstat(entry.path);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size > MAX_AGENT_BYTES) {
      throw new Error('unsupported source file');
    }
    source = await readFile(entry.path);
  } catch (error) {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_UNAVAILABLE',
      'The selected native agent snapshot could not be read.',
      { agentId: entry.id },
    );
  }
  const fingerprint = createHash('sha256').update(source).digest('hex');
  if (fingerprint !== entry.fingerprint) {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_UNAVAILABLE',
      'The selected native agent snapshot changed and must be refreshed.',
      { agentId: entry.id },
    );
  }

  let parent = projectRoot;
  for (const segment of AGENT_ROOTS[entry.harness]) {
    parent = join(parent, segment);
    await ensureSafeDirectory(projectRoot, parent);
  }
  for (const segment of entry.agentPath.split('/').slice(0, -1)) {
    parent = join(parent, segment);
    await ensureSafeDirectory(projectRoot, parent);
  }

  const pathSegments = entry.agentPath.split('/');
  const fileName = pathSegments.pop();
  if (fileName === undefined) {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_PATH_INVALID',
      'The native agent path is invalid and was not copied.',
      { agentId: entry.id },
    );
  }
  const destinationPath = join(parent, fileName);
  const temporaryPath = join(dirname(destinationPath), `.loom-agent-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, source, { flag: 'wx', mode: 0o600 });
    await link(temporaryPath, destinationPath);
    return {
      name: entry.name,
      harness: entry.harness,
      destinationPath,
      fingerprint,
    };
  } catch (error) {
    if (isErrno(error, 'EEXIST')) {
      throw new NativeAgentCopyError(
        'NATIVE_AGENT_CONFLICT',
        'A file already exists at the native agent destination; it was not overwritten.',
        { agentId: entry.id, destinationPath },
      );
    }
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_COPY_FAILED',
      'The native agent could not be installed in the project.',
      { agentId: entry.id, destinationPath },
    );
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isErrno(error, 'ENOENT')) throw error;
    });
  }
}

export async function installNativeAgentContentIntoProject(
  input: InstallNativeAgentContentInput,
): Promise<CopyNativeAgentResult> {
  const { projectPath, name, harness, agentPath, fingerprint, content } = input;
  if (!isSafeAgentPath(agentPath, harness)) {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_PATH_INVALID',
      'The native agent path is invalid and was not installed.',
    );
  }
  if (
    content.byteLength > MAX_AGENT_BYTES ||
    createHash('sha256').update(content).digest('hex') !== fingerprint
  ) {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_UNAVAILABLE',
      'The bundled native agent content does not match its fingerprint.',
    );
  }

  const projectRoot = await realpath(projectPath);
  let parent = projectRoot;
  for (const segment of AGENT_ROOTS[harness]) {
    parent = join(parent, segment);
    await ensureSafeDirectory(projectRoot, parent);
  }
  const pathSegments = agentPath.split('/');
  const fileName = pathSegments.pop();
  for (const segment of pathSegments) {
    parent = join(parent, segment);
    await ensureSafeDirectory(projectRoot, parent);
  }
  if (fileName === undefined) {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_PATH_INVALID',
      'The native agent path is invalid and was not installed.',
    );
  }

  const destinationPath = join(parent, fileName);
  const temporaryPath = join(dirname(destinationPath), `.loom-agent-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { flag: 'wx', mode: 0o600 });
    await link(temporaryPath, destinationPath);
    return { name, harness, destinationPath, fingerprint };
  } catch (error) {
    if (isErrno(error, 'EEXIST')) {
      throw new NativeAgentCopyError(
        'NATIVE_AGENT_CONFLICT',
        'A file already exists at the native agent destination; it was not overwritten.',
        { destinationPath },
      );
    }
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_COPY_FAILED',
      'The native agent could not be installed in the project.',
      { destinationPath },
    );
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isErrno(error, 'ENOENT')) throw error;
    });
  }
}

export async function removeNativeAgentIfUnchanged(
  path: string,
  fingerprint: string,
): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      createHash('sha256').update(await readFile(path)).digest('hex') !== fingerprint
    ) {
      return false;
    }
    await unlink(path);
    return true;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false;
    throw error;
  }
}

async function ensureSafeDirectory(projectRoot: string, directory: string): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error;
  }
  const info = await lstat(directory);
  const canonical = await realpath(directory);
  const relativePath = relative(projectRoot, canonical);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    canonical !== directory ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new NativeAgentCopyError(
      'NATIVE_AGENT_COPY_FAILED',
      'A native agent destination directory is unsafe.',
      { directory },
    );
  }
}

function isSafeAgentPath(path: string, harness: NativeAgentEntry['harness']): boolean {
  if (
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) =>
      part === '' ||
      part === '.' ||
      part === '..' ||
      !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(part) ||
      /[. ]$/.test(part) ||
      /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i.test(part) ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
    )
  ) {
    return false;
  }
  return harness === 'opencode' ? path.endsWith('.md') : path.endsWith('.agent.md');
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
