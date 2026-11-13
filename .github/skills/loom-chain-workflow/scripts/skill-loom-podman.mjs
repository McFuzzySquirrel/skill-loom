#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { constants, realpathSync } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_CONTAINER = 'skill-loom-app';
const CONTAINER_CLI = '/app/dist/src/server/cli.js';
const MAX_TRANSFER_BYTES = 20 * 1024 * 1024;
const MAX_TRANSFER_FILES = 2_000;
const MAX_TRANSFER_SKILLS = 100;
const MAX_REMOTE_OUTPUT_BYTES = 32 * 1024 * 1024;
const FORBIDDEN_SEGMENT = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i;
const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

export class PodmanBridgeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PodmanBridgeError';
    this.code = code;
  }
}

export function createPodmanCliArgs(args, allocateTty, connection) {
  if (args.length === 0) {
    throw new TypeError('Pass a Skill Loom CLI command to forward into the Podman service.');
  }
  if (args[0] === 'service' && args[1] !== 'status') {
    throw new TypeError('The Podman service lifecycle is managed with podman:up and podman:down.');
  }
  return [
    ...(connection === undefined ? [] : ['--connection', connection]),
    'exec',
    '--interactive',
    ...(allocateTty ? ['--tty'] : []),
    APP_CONTAINER,
    'node',
    CONTAINER_CLI,
    ...args,
  ];
}

export function validateSkillTransfer(manifest) {
  if (!isRecord(manifest) || !hasOnlyKeys(manifest, ['format', 'version', 'skills']) ||
      manifest.format !== 'skill-loom-project-skills' || manifest.version !== 1 ||
      !Array.isArray(manifest.skills) || manifest.skills.length > MAX_TRANSFER_SKILLS) {
    throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned an unsupported skill transfer manifest.');
  }

  const names = new Set();
  const directories = new Set();
  let totalBytes = 0;
  let totalFiles = 0;
  const skills = manifest.skills.map((skill) => {
    if (!isRecord(skill) || !hasOnlyKeys(skill, ['name', 'directory', 'files']) ||
        typeof skill.name !== 'string' || skill.name.trim() === '' || skill.name.length > 128 ||
        typeof skill.directory !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(skill.directory) ||
        !Array.isArray(skill.files) || skill.files.length === 0) {
      throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned an invalid skill package entry.');
    }
    const directoryKey = skill.directory.toLowerCase();
    if (names.has(skill.name) || directories.has(directoryKey)) {
      throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned duplicate skill package names.');
    }
    names.add(skill.name);
    directories.add(directoryKey);

    const paths = new Set();
    const files = skill.files.map((file) => {
      if (!isRecord(file) || !hasOnlyKeys(file, ['path', 'content', 'executable']) ||
          typeof file.path !== 'string' || file.path.length > 512 ||
          typeof file.content !== 'string' || typeof file.executable !== 'boolean') {
        throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned an invalid package file.');
      }
      validatePackagePath(file.path);
      const pathKey = file.path.toLowerCase();
      if (paths.has(pathKey)) {
        throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned duplicate package file paths.');
      }
      paths.add(pathKey);
      const content = decodeCanonicalBase64(file.content);
      totalBytes += content.length;
      totalFiles += 1;
      if (totalBytes > MAX_TRANSFER_BYTES || totalFiles > MAX_TRANSFER_FILES) {
        throw new PodmanBridgeError('TRANSFER_TOO_LARGE', 'Client transfers are limited to 20 MiB and 2,000 files.');
      }
      return { path: file.path, content, executable: file.executable };
    });

    for (const path of paths) {
      const segments = path.split('/');
      while (segments.length > 1) {
        segments.pop();
        if (paths.has(segments.join('/').toLowerCase())) {
          throw new PodmanBridgeError('TRANSFER_INVALID', 'A package file conflicts with a directory.');
        }
      }
    }
    if (!files.some((file) => file.path === 'SKILL.md')) {
      throw new PodmanBridgeError('TRANSFER_INVALID', 'Each transferred skill package must include SKILL.md.');
    }
    return { name: skill.name, directory: skill.directory, files };
  });

  return skills;
}

export async function installTransferredSkills(projectPath, manifest) {
  if (!isAbsolute(projectPath)) {
    throw new PodmanBridgeError('PROJECT_PATH_INVALID', 'Provide an absolute client project path.');
  }
  let project;
  try {
    project = await realpath(resolve(projectPath));
  } catch (error) {
    throw new PodmanBridgeError('PROJECT_UNAVAILABLE', 'The client project directory could not be resolved.', { cause: error });
  }
  const projectInfo = await lstat(project);
  if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink()) {
    throw new PodmanBridgeError('PROJECT_UNAVAILABLE', 'The client project path is not a directory.');
  }

  const skills = validateSkillTransfer(manifest);
  if (skills.length === 0) return { installed: [] };
  const root = join(project, '.agents', 'skills');
  await ensureDirectory(join(project, '.agents'), []);
  await ensureDirectory(root, []);

  for (const skill of skills) {
    try {
      await lstat(join(root, skill.directory));
      throw new PodmanBridgeError('DESTINATION_CONFLICT', `The project already contains the "${skill.name}" skill.`);
    } catch (error) {
      if (error instanceof PodmanBridgeError) throw error;
      if (!isErrno(error, 'ENOENT')) {
        throw new PodmanBridgeError('DESTINATION_UNAVAILABLE', 'A client skill destination could not be inspected.', { cause: error });
      }
    }
  }

  const installed = [];
  for (const skill of skills) {
    const destination = join(root, skill.directory);
    const createdDirectories = [];
    const createdFiles = [];
    try {
      await mkdir(destination, { mode: 0o755 });
      createdDirectories.push(destination);
      const files = [...skill.files].sort((left, right) => {
        if (left.path === 'SKILL.md') return 1;
        if (right.path === 'SKILL.md') return -1;
        return left.path.localeCompare(right.path);
      });
      for (const file of files) {
        const segments = file.path.split('/');
        const target = resolve(destination, ...segments);
        const pathFromPackage = relative(destination, target);
        if (pathFromPackage === '..' || pathFromPackage.startsWith(`..${sep}`) || isAbsolute(pathFromPackage)) {
          throw new PodmanBridgeError('TRANSFER_INVALID', 'A package file escapes its destination directory.');
        }
        let parent = destination;
        for (const segment of segments.slice(0, -1)) {
          parent = join(parent, segment);
          await ensureDirectory(parent, createdDirectories);
        }
        const handle = await open(
          target,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          file.executable ? 0o755 : 0o644,
        );
        createdFiles.push(target);
        try {
          await handle.writeFile(file.content);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      installed.push({ name: skill.name, destinationPath: destination });
    } catch (error) {
      const cleanupErrors = await cleanupCreatedPackage(createdFiles, createdDirectories, destination);
      const message = error instanceof PodmanBridgeError
        ? error.message
        : 'A transferred skill package could not be written to the client project.';
      throw new PodmanBridgeError(
        'LOCAL_INSTALL_FAILED',
        `${message}${cleanupErrors.length === 0 ? '' : ` Partial files may remain at ${destination}.`}`,
        { cause: error },
      );
    }
  }
  return { installed };
}

export async function runPodmanCli(
  args = process.argv.slice(2),
  dependencies = {},
) {
  const env = dependencies.env ?? process.env;
  const stdin = dependencies.stdin ?? process.stdin;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const spawn = dependencies.spawnSync ?? spawnSync;
  const command = env.PODMAN ?? 'podman';

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    stdout.write(
      'Usage: skill-loom-podman <skill-loom command...>\n' +
      '       skill-loom-podman chain project apply-local --project <path> --project-id <id> --chain-id <id>\n' +
      'Forwards CLI commands to the running skill-loom Podman container without a shell.\n' +
      'Set LOOM_PODMAN_CONNECTION to a configured Podman SSH connection for a remote host.\n' +
      'Use npm run podman:up and npm run podman:down on the Podman host to manage the service.\n',
    );
    return 0;
  }

  try {
    const connection = validateConnection(env.LOOM_PODMAN_CONNECTION);
    if (isApplyLocal(args)) {
      const request = parseApplyLocalArgs(args.slice(3));
      const result = spawn(
        command,
        createPodmanCliArgs(['chain', 'project', 'export'], false, connection),
        {
          input: JSON.stringify({ projectId: request.projectId, chainId: request.chainId }),
          encoding: 'utf8',
          maxBuffer: MAX_REMOTE_OUTPUT_BYTES,
          windowsHide: true,
        },
      );
      if (result.stderr !== undefined && result.stderr !== null && String(result.stderr) !== '') {
        stderr.write(String(result.stderr));
      }
      if (result.error !== undefined) {
        throw new PodmanBridgeError('PODMAN_EXEC_FAILED', `Could not run Podman CLI bridge: ${result.error.message}`, { cause: result.error });
      }
      if (result.status !== 0) return result.status ?? 1;
      const response = parseRemoteResponse(String(result.stdout ?? ''));
      const installed = await installTransferredSkills(request.projectPath, response.result);
      stdout.write(`${JSON.stringify({ ok: true, ...installed })}\n`);
      return 0;
    }

    const podmanArgs = createPodmanCliArgs(
      args,
      stdin.isTTY === true && stdout.isTTY === true,
      connection,
    );
    const result = spawn(command, podmanArgs, { stdio: 'inherit', windowsHide: true });
    if (result.error !== undefined) {
      throw new PodmanBridgeError('PODMAN_EXEC_FAILED', `Could not run Podman CLI bridge: ${result.error.message}`, { cause: result.error });
    }
    return result.status ?? 1;
  } catch (error) {
    const code = error instanceof PodmanBridgeError ? error.code : 'PODMAN_BRIDGE_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    return error instanceof PodmanBridgeError && code === 'USAGE' ? 2 : 1;
  }
}

function isApplyLocal(args) {
  return args[0] === 'chain' && args[1] === 'project' && args[2] === 'apply-local';
}

function parseApplyLocalArgs(args) {
  const values = new Map();
  const allowed = new Set(['--project', '--project-id', '--chain-id']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || !allowed.has(key) || value === undefined || value.startsWith('--') ||
        value.trim() === '' || values.has(key)) {
      throw new PodmanBridgeError('USAGE', 'Apply-local requires --project, --project-id, and --chain-id exactly once.');
    }
    values.set(key, value);
  }
  const projectPath = values.get('--project');
  const projectId = values.get('--project-id');
  const chainId = values.get('--chain-id');
  if (projectPath === undefined || !isAbsolute(projectPath) ||
      projectId === undefined || projectId.trim() === '' || projectId.length > 255 ||
      chainId === undefined || chainId.trim() === '' || chainId.length > 64) {
    throw new PodmanBridgeError('USAGE', 'Apply-local requires an absolute --project path and valid project and chain ids.');
  }
  return { projectPath, projectId, chainId };
}

function validateConnection(connection) {
  if (connection === undefined) return undefined;
  if (typeof connection !== 'string' || connection.trim() === '' || connection.length > 255 ||
      connection.startsWith('-') || /[\u0000-\u001f\u007f]/.test(connection)) {
    throw new PodmanBridgeError('CONNECTION_INVALID', 'LOOM_PODMAN_CONNECTION must be a valid configured Podman connection name.');
  }
  return connection;
}

function parseRemoteResponse(text) {
  let response;
  try {
    response = JSON.parse(text);
  } catch (error) {
    throw new PodmanBridgeError('REMOTE_RESPONSE_INVALID', 'The hosted Skill Loom CLI returned invalid JSON.', { cause: error });
  }
  if (!isRecord(response) || response.protocolVersion !== 1 || response.ok !== true) {
    throw new PodmanBridgeError('REMOTE_EXPORT_FAILED', 'The hosted Skill Loom CLI could not export the selected chain skills.');
  }
  return response;
}

function validatePackagePath(path) {
  const segments = path.split('/');
  if (segments.length > 32 || path.startsWith('/') || path.includes('\\') ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..' ||
        !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(segment) || /[. ]$/.test(segment) ||
        FORBIDDEN_SEGMENT.test(segment) || RESERVED_WINDOWS_NAME.test(segment))) {
    throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned an unsafe package path.');
  }
}

function decodeCanonicalBase64(content) {
  if (content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(content)) {
    throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned invalid package file data.');
  }
  const decoded = Buffer.from(content, 'base64');
  if (decoded.toString('base64') !== content) {
    throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned non-canonical package file data.');
  }
  return decoded;
}

async function ensureDirectory(path, createdDirectories) {
  try {
    await mkdir(path, { mode: 0o755 });
    createdDirectories.push(path);
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error;
  }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new PodmanBridgeError('DESTINATION_UNSAFE', 'A client skill destination contains a symbolic link or changed directory.');
  }
}

async function cleanupCreatedPackage(files, directories, packageRoot) {
  const errors = [];
  for (const path of [...files].reverse()) {
    try {
      await unlink(path);
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) errors.push(error);
    }
  }
  for (const path of [...directories].reverse()) {
    if (path !== packageRoot && !path.startsWith(`${packageRoot}${sep}`)) continue;
    try {
      await rmdir(path);
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) errors.push(error);
    }
  }
  return errors;
}

function hasOnlyKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrno(error, code) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isMainModule() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runPodmanCli();
}
