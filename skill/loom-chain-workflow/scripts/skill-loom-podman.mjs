#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const APP_CONTAINER = 'skill-loom-app';
const CONTAINER_CLI = '/app/dist/src/server/cli.js';
const MAX_TRANSFER_BYTES = 20 * 1024 * 1024;
const MAX_TRANSFER_FILES = 2_000;
const MAX_TRANSFER_SKILLS = 100;
const MAX_REMOTE_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_REPO_CHAIN_BYTES = 60 * 1024;
const FORBIDDEN_SEGMENT = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i;
const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

export class PodmanBridgeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PodmanBridgeError';
    this.code = code;
    this.details = options.details ?? {};
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

export function validateSkillTransfer(manifest, expectedSelections = undefined) {
  const version = isRecord(manifest) ? manifest.version : undefined;
  if (!isRecord(manifest) || !hasOnlyKeys(manifest, ['format', 'version', 'skills']) ||
      manifest.format !== 'skill-loom-project-skills' || ![1, 2].includes(version) ||
      !Array.isArray(manifest.skills) || manifest.skills.length > MAX_TRANSFER_SKILLS) {
    throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned an unsupported skill transfer manifest.');
  }
  if ((version === 2) !== (expectedSelections !== undefined)) {
    throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned a manifest for a different copy operation.');
  }
  const expected = new Map((expectedSelections ?? []).map((selection) => [selection.id, selection.fingerprint]));
  if (version === 2 && (expected.size !== expectedSelections.length || expected.size !== manifest.skills.length)) {
    throw new PodmanBridgeError('TRANSFER_INVALID', 'The hosted service returned a different selected-skill set.');
  }

  const names = new Set();
  const directories = new Set();
  const skillIds = new Set();
  let totalBytes = 0;
  let totalFiles = 0;
  const skills = manifest.skills.map((skill) => {
    const skillKeys = version === 1
      ? ['name', 'directory', 'files'] : ['id', 'fingerprint', 'name', 'directory', 'files'];
    if (!isRecord(skill) || !hasOnlyKeys(skill, skillKeys) ||
        (version === 2 && (typeof skill.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.id) ||
          typeof skill.fingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(skill.fingerprint) || expected.get(skill.id) !== skill.fingerprint ||
          skillIds.has(skill.id))) ||
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
    if (version === 2) skillIds.add(skill.id);

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
    if (version === 2 && packageFingerprint(files) !== skill.fingerprint) {
      throw new PodmanBridgeError('TRANSFER_INVALID', 'A transferred package does not match its reviewed fingerprint.');
    }
    return {
      ...(version === 2 ? { id: skill.id, fingerprint: skill.fingerprint } : {}),
      name: skill.name, directory: skill.directory, files,
    };
  });

  return skills;
}

export async function installTransferredSkills(projectPath, manifest, expectedSelections = undefined) {
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

  const skills = validateSkillTransfer(manifest, expectedSelections);
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
        `${message}${cleanupErrors.length === 0 ? '' : ` Partial files may remain at ${destination}.`}${installed.length === 0 ? '' : ' Earlier successfully installed packages remain.'}`,
        {
          cause: error,
          details: {
            failedSkill: skill.name,
            installed,
            partialSuccess: installed.length > 0,
            cleanupIncomplete: cleanupErrors.length > 0,
          },
        },
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
      '       skill-loom-podman chain repo publish --project <path> --project-id <id> --chain-id <id>\n' +
      '       skill-loom-podman chain repo link --project <path> --project-id <id> --chain-id <id> --hosted-chain-id <id>\n' +
      '       skill-loom-podman chain repo republish --project <path> --project-id <id> --chain-id <id> --confirm-hosted-revision <sha256>\n' +
      '       skill-loom-podman catalog skills copy-local --project <path> --project-id <id> --harness <id> --selection <entry-id> <fingerprint> [...]\n' +
      'Forwards CLI commands to the running skill-loom Podman container without a shell.\n' +
      'Set LOOM_PODMAN_CONNECTION to a configured Podman SSH connection for a remote host.\n' +
      'Use npm run podman:up and npm run podman:down on the Podman host to manage the service.\n',
    );
    return 0;
  }

  try {
    const connection = validateConnection(env.LOOM_PODMAN_CONNECTION);
    if (isRepoPublish(args) || isRepoLink(args) || isRepoRepublish(args)) {
      const request = parseRepoPublishArgs(args.slice(3), args[2]);
      const repo = await readRepoChain(request.projectPath, request.chainId);
      if (request.mode === 'link') {
        const existing = await readRepoPublication(request.projectPath, request.chainId);
        if (existing !== null && existing.hostedChainId !== request.hostedChainId) {
          throw new PodmanBridgeError(
            'REPO_PUBLICATION_EXISTS',
            'This repository chain is mapped to a different hosted id; inspect both records before attempting to change its mapping.',
          );
        }
        const linked = await requestHostedChain(
          spawn,
          command,
          connection,
          ['chain', 'project', 'show'],
          { projectId: request.projectId, chainId: request.hostedChainId },
          stderr,
        );
        const hosted = parseHostedChain(linked.result);
        if (hosted.chain.id !== request.hostedChainId) {
          throw new PodmanBridgeError('REMOTE_RESPONSE_INVALID', 'The hosted service returned a different chain than the requested recovery id.');
        }
        const contentMatches = sameChainContent(repo.chain, hosted.chain);
        if (!contentMatches && !request.confirmDivergence) {
          throw new PodmanBridgeError(
            'REPO_PUBLICATION_CONTENT_MISMATCH',
            'The hosted and repository chains differ. Compare both chain documents, then repeat link with --confirm-divergence only if this is the intended hosted record.',
            {
              repositoryChainId: request.chainId,
              hostedChainId: hosted.chain.id,
              repositoryName: repo.chain.name,
              hostedName: hosted.chain.name,
            },
          );
        }
        const publication = {
          version: 1,
          repoChainId: request.chainId,
          hostedChainId: hosted.chain.id,
          hostedRevision: hosted.revision,
        };
        await writeRepoPublication(request.projectPath, request.chainId, publication);
        stdout.write(`${JSON.stringify({ ok: true, publication, recovered: true, diverged: !contentMatches })}\n`);
        return 0;
      }

      let publication = await readRepoPublication(request.projectPath, request.chainId);
      if (request.mode === 'republish') {
        if (publication === null) {
          throw new PodmanBridgeError('REPO_PUBLICATION_NOT_FOUND', 'Republish requires an existing publication sidecar.');
        }
        const current = await requestHostedChain(
          spawn,
          command,
          connection,
          ['chain', 'project', 'show'],
          { projectId: request.projectId, chainId: publication.hostedChainId },
          stderr,
        );
        const hosted = parseHostedChain(current.result);
        if (hosted.chain.id !== publication.hostedChainId || hosted.revision !== request.confirmHostedRevision) {
          throw new PodmanBridgeError(
            'REPO_PUBLICATION_STALE',
            'The hosted revision changed after it was compared. Reload both chains before confirming a republish.',
            { details: { confirmedRevision: request.confirmHostedRevision, actualRevision: hosted.revision } },
          );
        }
        publication = { ...publication, hostedRevision: hosted.revision };
      }
      const input = {
        projectId: request.projectId,
        repoChainId: request.chainId,
        chain: repo.chain,
        ...(publication === null ? {} : { publication }),
      };
      const published = await requestHostedChain(
        spawn,
        command,
        connection,
        ['chain', 'project', 'publish'],
        input,
        stderr,
      );
      let hosted;
      try {
        hosted = parseHostedChain(published.result);
      } catch (error) {
        throw new PodmanBridgeError(
          'PUBLISH_OUTCOME_UNKNOWN',
          'The hosted request returned an invalid publication result; the write may have completed. Inspect the hosted library, then recover by exact hosted id.',
          { cause: error },
        );
      }
      if (publication !== null && hosted.chain.id !== publication.hostedChainId) {
        throw new PodmanBridgeError('REMOTE_RESPONSE_INVALID', 'The hosted service returned a different chain than the publication mapping.');
      }
      const nextPublication = {
        version: 1,
        repoChainId: request.chainId,
        hostedChainId: hosted.chain.id,
        hostedRevision: hosted.revision,
      };
      try {
        await writeRepoPublication(request.projectPath, request.chainId, nextPublication);
      } catch (error) {
        throw new PodmanBridgeError(
          'LOCAL_PUBLICATION_WRITE_FAILED',
          `The hosted chain was published as "${hosted.chain.id}" at revision ${hosted.revision}, but the local mapping could not be saved. Run chain repo link after confirming the hosted content matches.`,
          { cause: error, details: { hostedChainId: hosted.chain.id, hostedRevision: hosted.revision } },
        );
      }
      stdout.write(`${JSON.stringify({ ok: true, chain: hosted.chain, revision: hosted.revision, publication: nextPublication })}\n`);
      return 0;
    }
    if (isSelectedCopyLocal(args)) {
      const request = parseSelectedCopyLocalArgs(args.slice(3));
      const result = spawn(
        command,
        createPodmanCliArgs(['catalog', 'skill', 'export'], false, connection),
        {
          input: JSON.stringify({
            projectId: request.projectId,
            harness: request.harness,
            selections: request.selections,
          }),
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
      const installed = await installTransferredSkills(request.projectPath, response.result, request.selections);
      stdout.write(`${JSON.stringify({ ok: true, ...installed })}\n`);
      return 0;
    }
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
    const details = error instanceof PodmanBridgeError && Object.keys(error.details).length > 0
      ? { details: error.details } : {};
    stderr.write(`${JSON.stringify({ ok: false, error: { code, message, ...details } })}\n`);
    return error instanceof PodmanBridgeError && code === 'USAGE' ? 2 : 1;
  }
}

function isApplyLocal(args) {
  return args[0] === 'chain' && args[1] === 'project' && args[2] === 'apply-local';
}

function isRepoPublish(args) {
  return args[0] === 'chain' && args[1] === 'repo' && args[2] === 'publish';
}

function isRepoLink(args) {
  return args[0] === 'chain' && args[1] === 'repo' && args[2] === 'link';
}

function isRepoRepublish(args) {
  return args[0] === 'chain' && args[1] === 'repo' && args[2] === 'republish';
}

function isSelectedCopyLocal(args) {
  return args[0] === 'catalog' && args[1] === 'skills' && args[2] === 'copy-local';
}

function parseRepoPublishArgs(args, mode) {
  const values = new Map();
  const allowed = new Set([
    '--project',
    '--project-id',
    '--chain-id',
    '--hosted-chain-id',
    '--confirm-hosted-revision',
    '--confirm-divergence',
  ]);
  let confirmDivergence = false;
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === '--confirm-divergence') {
      if (mode !== 'link' || confirmDivergence) {
        throw new PodmanBridgeError('USAGE', 'The --confirm-divergence option is supported once for link.');
      }
      confirmDivergence = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (key === undefined || !allowed.has(key) || value === undefined || value.startsWith('--') ||
        value.trim() === '' || values.has(key)) {
      throw new PodmanBridgeError('USAGE', `Repository chain ${mode} requires valid, non-repeated options.`);
    }
    values.set(key, value);
    index += 2;
  }
  const projectPath = values.get('--project');
  const projectId = values.get('--project-id');
  const chainId = values.get('--chain-id');
  const hostedChainId = values.get('--hosted-chain-id');
  const confirmHostedRevision = values.get('--confirm-hosted-revision');
  if (projectPath === undefined || !isAbsolute(projectPath) ||
      projectId === undefined || projectId.length > 255 ||
      chainId === undefined || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(chainId) ||
      (mode === 'link') !== (hostedChainId !== undefined) ||
      (hostedChainId !== undefined && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(hostedChainId)) ||
      (mode === 'republish') !== (confirmHostedRevision !== undefined) ||
      (confirmHostedRevision !== undefined && !/^[a-f0-9]{64}$/.test(confirmHostedRevision)) ||
      (mode !== 'link' && confirmDivergence)) {
    throw new PodmanBridgeError(
      'USAGE',
      mode === 'link'
        ? 'Repository chain link requires an absolute --project path, host --project-id, --chain-id, and --hosted-chain-id.'
        : mode === 'republish'
          ? 'Repository chain republish requires an absolute --project path, host --project-id, --chain-id, and --confirm-hosted-revision.'
          : 'Repository chain publish requires an absolute --project path, host --project-id, and --chain-id.',
    );
  }
  return { mode, projectPath, projectId, chainId, hostedChainId, confirmHostedRevision, confirmDivergence };
}

async function readRepoChain(projectPath, chainId) {
  const repositoryPath = await realpath(projectPath).catch((error) => {
    throw new PodmanBridgeError('REPO_CHAIN_UNAVAILABLE', 'The repository directory could not be opened.', { cause: error });
  });
  const chainsDirectory = join(repositoryPath, 'chains');
  const directoryInfo = await lstat(chainsDirectory).catch((error) => {
    throw new PodmanBridgeError('REPO_CHAIN_UNAVAILABLE', 'The repository chains directory could not be opened.', { cause: error });
  });
  let canonicalChainsDirectory;
  try {
    canonicalChainsDirectory = await realpath(chainsDirectory);
  } catch (error) {
    throw new PodmanBridgeError('REPO_CHAIN_UNAVAILABLE', 'The repository chains directory could not be resolved.', { cause: error });
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() ||
      canonicalChainsDirectory !== chainsDirectory) {
    throw new PodmanBridgeError('REPO_CHAIN_PATH_UNSAFE', 'The repository chains directory must be a real directory.');
  }
  const target = join(chainsDirectory, `${chainId}.json`);
  const info = await lstat(target).catch((error) => {
    throw new PodmanBridgeError('REPO_CHAIN_UNAVAILABLE', 'The repository chain file could not be opened.', { cause: error });
  });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_REPO_CHAIN_BYTES) {
    throw new PodmanBridgeError('REPO_CHAIN_PATH_UNSAFE', 'The repository chain must be a bounded regular file.');
  }
  let text;
  try {
    text = await readFile(target, 'utf8');
  } catch (error) {
    throw new PodmanBridgeError('REPO_CHAIN_UNAVAILABLE', 'The repository chain file could not be read.', { cause: error });
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_REPO_CHAIN_BYTES) {
    throw new PodmanBridgeError('REPO_CHAIN_INVALID', 'The repository chain exceeds the 60 KiB hosted control-request limit.');
  }
  let chain;
  try {
    chain = JSON.parse(text);
  } catch (error) {
    throw new PodmanBridgeError('REPO_CHAIN_INVALID', 'The repository chain is not valid JSON.', { cause: error });
  }
  if (!isRecord(chain) || chain.id !== chainId || ![1, 2, 3].includes(chain.version)) {
    throw new PodmanBridgeError('REPO_CHAIN_INVALID', 'The repository chain id or version is invalid or unsupported.');
  }
  return { chain, repositoryPath, chainsDirectory };
}

async function readRepoPublication(projectPath, chainId) {
  const repo = await readRepoChain(projectPath, chainId);
  const target = join(repo.chainsDirectory, `${chainId}.publish.json`);
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new PodmanBridgeError('REPO_PUBLICATION_READ_FAILED', 'The repository publication sidecar could not be inspected.', { cause: error });
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16_384) {
    throw new PodmanBridgeError('REPO_PUBLICATION_PATH_UNSAFE', 'The repository publication sidecar must be a safe regular file.');
  }
  let text;
  try {
    text = await readFile(target, 'utf8');
  } catch (error) {
    throw new PodmanBridgeError('REPO_PUBLICATION_READ_FAILED', 'The repository publication sidecar could not be read.', { cause: error });
  }
  if (Buffer.byteLength(text, 'utf8') > 16_384) {
    throw new PodmanBridgeError('REPO_PUBLICATION_PATH_UNSAFE', 'The repository publication sidecar exceeds the supported size.');
  }
  let publication;
  try {
    publication = JSON.parse(text);
  } catch (error) {
    throw new PodmanBridgeError('REPO_PUBLICATION_CORRUPT', 'The repository publication sidecar is invalid; its contents were left unchanged.', { cause: error });
  }
  if (!isRecord(publication) ||
      !hasOnlyKeys(publication, ['version', 'repoChainId', 'hostedChainId', 'hostedRevision']) ||
      publication.version !== 1 ||
      publication.repoChainId !== chainId ||
      typeof publication.hostedChainId !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(publication.hostedChainId) ||
      typeof publication.hostedRevision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(publication.hostedRevision)) {
    throw new PodmanBridgeError(
      isRecord(publication) && publication.version !== 1 ? 'REPO_PUBLICATION_UNSUPPORTED_VERSION' : 'REPO_PUBLICATION_CORRUPT',
      'The repository publication sidecar is invalid or uses an unsupported version; its contents were left unchanged.',
    );
  }
  return publication;
}

async function writeRepoPublication(projectPath, chainId, publication) {
  const repo = await readRepoChain(projectPath, chainId);
  if (!isRecord(publication) ||
      !hasOnlyKeys(publication, ['version', 'repoChainId', 'hostedChainId', 'hostedRevision']) ||
      publication.version !== 1 ||
      publication.repoChainId !== chainId ||
      typeof publication.hostedChainId !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(publication.hostedChainId) ||
      typeof publication.hostedRevision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(publication.hostedRevision)) {
    throw new PodmanBridgeError('REPO_PUBLICATION_INVALID', 'The hosted publication identity is invalid.');
  }
  await readRepoPublication(projectPath, chainId);
  const target = join(repo.chainsDirectory, `${chainId}.publish.json`);
  const temporary = join(repo.chainsDirectory, `.${chainId}.publish.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(publication, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, target);
        break;
      } catch (error) {
        const wait = [10, 25, 50, 100, 200][attempt];
        if (process.platform !== 'win32' || error?.code !== 'EPERM' || wait === undefined) throw error;
        await delay(wait);
      }
    }
    try {
      const directory = await open(repo.chainsDirectory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      if (!['EINVAL', 'EISDIR', 'EPERM'].includes(error?.code)) throw error;
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw new PodmanBridgeError('REPO_PUBLICATION_WRITE_FAILED', 'The repository publication sidecar could not be written.', { cause: error });
  }
}

async function requestHostedChain(spawn, command, connection, args, input, stderr) {
  const result = spawn(
    command,
    createPodmanCliArgs(args, false, connection),
    {
      input: JSON.stringify(input),
      encoding: 'utf8',
      maxBuffer: MAX_REMOTE_OUTPUT_BYTES,
      windowsHide: true,
    },
  );
  const remoteError = String(result.stderr ?? '');
  if (remoteError !== '') stderr.write(remoteError);
  if (result.error !== undefined) {
    throw new PodmanBridgeError(
      args[2] === 'publish' ? 'PUBLISH_OUTCOME_UNKNOWN' : 'PODMAN_EXEC_FAILED',
      args[2] === 'publish'
        ? 'The publication connection failed; the hosted write may have completed. Inspect the hosted library, then use chain repo link if the content matches.'
        : `Could not run Podman CLI bridge: ${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    let remoteFailure = false;
    try {
      const parsed = JSON.parse(remoteError.trim().split('\n').at(-1));
      remoteFailure = isRecord(parsed) && parsed.protocolVersion === 1 && parsed.ok === false;
    } catch {}
    if (!remoteFailure && args[2] === 'publish') {
      throw new PodmanBridgeError(
        'PUBLISH_OUTCOME_UNKNOWN',
        'The publication connection ended without a confirmed result; the hosted write may have completed. Inspect the hosted library, then use chain repo link if the content matches.',
        { details: { exitCode: result.status } },
      );
    }
    throw new PodmanBridgeError('REMOTE_REQUEST_FAILED', 'The hosted Skill Loom request failed.', { details: { exitCode: result.status } });
  }
  try {
    return parseRemoteResponse(String(result.stdout ?? ''));
  } catch (error) {
    if (args[2] === 'publish') {
      throw new PodmanBridgeError(
        'PUBLISH_OUTCOME_UNKNOWN',
        'The hosted request returned no valid publication result; the write may have completed. Inspect the hosted library, then recover by exact hosted id.',
        { cause: error },
      );
    }
    throw error;
  }
}

function parseHostedChain(result) {
  if (!isRecord(result) || !isRecord(result.chain) ||
      typeof result.chain.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(result.chain.id) ||
      typeof result.revision !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision)) {
    throw new PodmanBridgeError('REMOTE_RESPONSE_INVALID', 'The hosted service returned an invalid chain publication result.');
  }
  return { chain: result.chain, revision: result.revision };
}

function chainContent(chain) {
  return JSON.stringify(canonicalize({
    name: chain.name,
    harness: chain.harness,
    sessionMode: chain.sessionMode,
    steps: chain.steps,
    inputs: chain.inputs ?? [],
    automaticPermissionOptIn: chain.automaticPermissionOptIn ?? false,
    ...(chain.agent === undefined ? {} : { agent: chain.agent }),
  }));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function sameChainContent(local, hosted) {
  return isRecord(hosted) && chainContent(local) === chainContent(hosted);
}

function parseSelectedCopyLocalArgs(args) {
  const values = new Map();
  const selections = [];
  const allowed = new Set(['--project', '--project-id', '--harness']);
  for (let index = 0; index < args.length;) {
    const key = args[index];
    if (key === '--selection') {
      const id = args[index + 1];
      const fingerprint = args[index + 2];
      if (id === undefined || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || fingerprint === undefined ||
          !/^[a-f0-9]{64}$/.test(fingerprint) || selections.some((selection) => selection.id === id)) {
        throw new PodmanBridgeError('USAGE', 'Each --selection requires one unique entry id and its 64-character package fingerprint.');
      }
      selections.push({ id, fingerprint });
      if (selections.length > MAX_TRANSFER_SKILLS) {
        throw new PodmanBridgeError('USAGE', `Select no more than ${MAX_TRANSFER_SKILLS} skill packages.`);
      }
      index += 3;
      continue;
    }
    const value = args[index + 1];
    if (key === undefined || !allowed.has(key) || value === undefined || value.startsWith('--') ||
        value.trim() === '' || values.has(key)) {
      throw new PodmanBridgeError('USAGE', 'Selected-skill copy requires --project, --project-id, --harness, and one or more --selection pairs exactly once.');
    }
    values.set(key, value);
    index += 2;
  }
  const projectPath = values.get('--project');
  const projectId = values.get('--project-id');
  const harness = values.get('--harness');
  if (projectPath === undefined || !isAbsolute(projectPath) ||
      projectId === undefined || projectId.length > 255 ||
      (harness !== 'opencode' && harness !== 'copilot') || selections.length === 0) {
    throw new PodmanBridgeError('USAGE', 'Selected-skill copy requires an absolute --project path, host project id, harness id, and exact selections.');
  }
  return { projectPath, projectId, harness, selections };
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
    throw new PodmanBridgeError('REMOTE_EXPORT_FAILED', 'The hosted Skill Loom CLI could not export the requested skill packages.');
  }
  return response;
}

function packageFingerprint(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    hash.update(file.path).update('\0').update(file.executable ? 'x' : '-')
      .update('\0').update(file.content);
  }
  return hash.digest('hex');
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
