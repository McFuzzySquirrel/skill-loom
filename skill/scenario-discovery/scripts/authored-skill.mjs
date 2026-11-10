#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FILES = 1_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_PATH_LENGTH = 512;
const MAX_SEGMENTS = 32;
const excludedSegments = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSkillName(name) {
  assert(typeof name === 'string' && name.length > 0 && name.length <= 128,
    'The skill name must be between 1 and 128 characters.');
  assert(name === name.trim(), 'The skill name must not have surrounding whitespace.');
  assert(name !== '.' && name !== '..' && !/[\\/:*?"<>|\x00-\x1f]/.test(name),
    'The skill name must be a single safe directory segment.');
  assert(!/[. ]$/.test(name), 'The skill name must not end with a dot or space.');
  assert(!excludedSegments.test(name), `The skill name uses an excluded segment: ${name}`);
  assert(!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name),
    `The skill name is a reserved device name: ${name}`);
}

function validateRelativePath(path) {
  const parts = path.split('/');
  assert(path.length > 0 && path.length <= MAX_PATH_LENGTH && parts.length <= MAX_SEGMENTS,
    `A package file path exceeds Skill Loom limits: ${path}`);
  assert(parts.every((part) =>
    part !== '' && part !== '.' && part !== '..' &&
    /^[^\\/:*?"<>|\x00-\x1f]+$/.test(part) &&
    !/[. ]$/.test(part) && !excludedSegments.test(part) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)),
  `The package contains an unsafe or excluded path: ${path}`);
}

function skillNameFromFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert(match, 'The package SKILL.md has no valid frontmatter.');
  const nameLine = match[1].split(/\r?\n/).find((line) => /^name\s*:/.test(line));
  assert(nameLine, 'The package SKILL.md has no name field.');
  const raw = nameLine.slice(nameLine.indexOf(':') + 1).trim();
  let name = raw;
  if (raw.startsWith('"')) {
    const quoted = raw.match(/^("(?:\\.|[^"\\])*")(?:\s+#.*)?$/);
    assert(quoted, 'The package SKILL.md has an invalid quoted name.');
    try {
      name = JSON.parse(quoted[1]);
    } catch {
      fail('The package SKILL.md has an invalid quoted name.');
    }
  } else if (raw.startsWith("'")) {
    const quoted = raw.match(/^'((?:[^']|'')*)'(?:\s+#.*)?$/);
    assert(quoted, 'The package SKILL.md has an invalid quoted name.');
    name = quoted[1].replaceAll("''", "'");
  } else {
    name = raw.replace(/\s+#.*$/, '').trim();
  }
  assert(name.length > 0 && !/[\r\n]/.test(name), 'The package SKILL.md has an invalid name.');
  return name;
}

function fingerprintFiles(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path).update('\0')
      .update(file.executable ? 'x' : '-').update('\0')
      .update(file.content);
  }
  return hash.digest('hex');
}

async function readBoundedFile(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    assert(info.isFile(), 'The package contains a non-regular file.');
    assert(info.size <= MAX_BYTES, 'The package exceeds the authored-skill byte limit.');
    const content = Buffer.alloc(info.size + 1);
    let bytesRead = 0;
    while (bytesRead < content.length) {
      const read = await handle.read(content, bytesRead, content.length - bytesRead, bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    assert(bytesRead === info.size, 'The package changed while it was read.');
    return { content: content.subarray(0, bytesRead), executable: (info.mode & 0o111) !== 0 };
  } finally {
    await handle.close();
  }
}

function assertInsideProject(projectRoot, candidate, label) {
  const path = relative(projectRoot, candidate);
  assert(path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path),
    `${label} must be inside the declared project root.`);
}

export async function inspectAuthoredSkill(input = {}) {
  const { packagePath, expectedName, projectPath, includeContent = false } = input;
  assert(typeof packagePath === 'string' && isAbsolute(packagePath),
    'The package path must be an absolute path.');
  const rootInfo = await lstat(packagePath);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(),
    'The package path must be a real directory, not a symlink.');
  const packageRoot = await realpath(packagePath);

  let projectRoot;
  if (projectPath !== undefined) {
    assert(typeof projectPath === 'string' && isAbsolute(projectPath),
      'The project path must be an absolute path.');
    const projectInfo = await lstat(projectPath);
    assert(projectInfo.isDirectory() && !projectInfo.isSymbolicLink(),
      'The project path must be a real directory, not a symlink.');
    projectRoot = await realpath(projectPath);
    assertInsideProject(projectRoot, packageRoot, 'The package');
  }

  const directoryName = basename(packageRoot);
  validateSkillName(directoryName);
  if (expectedName !== undefined) {
    validateSkillName(expectedName);
    assert(expectedName === directoryName,
      `The expected skill name "${expectedName}" does not match the package directory "${directoryName}".`);
  }

  const files = [];
  let bytes = 0;
  async function visit(directory, prefix, depth) {
    assert(depth <= MAX_DEPTH, 'The package directory tree is too deep.');
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      validateRelativePath(path);
      const absolute = join(directory, entry.name);
      const info = await lstat(absolute);
      assert(!info.isSymbolicLink(), `The package contains a symlink: ${path}`);
      if (info.isDirectory()) {
        await visit(absolute, path, depth + 1);
        continue;
      }
      assert(info.isFile(), `The package contains a non-regular file: ${path}`);
      assert(files.length < MAX_FILES, 'The package exceeds the authored-skill file limit.');
      const { content, executable } = await readBoundedFile(absolute);
      bytes += content.length;
      assert(bytes <= MAX_BYTES, 'The package exceeds the authored-skill byte limit.');
      files.push({ path, content, executable });
    }
  }
  await visit(packageRoot, '', 0);

  const skillFile = files.find((file) => file.path === 'SKILL.md');
  assert(skillFile, 'The package must include SKILL.md at its root.');
  const frontmatterName = skillNameFromFrontmatter(skillFile.content.toString('utf8'));
  assert(frontmatterName === directoryName,
    `The SKILL.md name "${frontmatterName}" does not match the package directory "${directoryName}".`);
  assert(expectedName === undefined || frontmatterName === expectedName,
    `The package name does not match the expected name "${expectedName}".`);

  return {
    name: frontmatterName,
    packagePath: packageRoot,
    ...(projectRoot === undefined ? {} : { projectPath: projectRoot }),
    fingerprint: fingerprintFiles(files),
    files: files.map((file) => ({
      path: file.path,
      sha256: createHash('sha256').update(file.content).digest('hex'),
      executable: file.executable,
      size: file.content.length,
      ...(includeContent ? { content: file.content.toString('base64') } : {}),
    })),
    fileCount: files.length,
    byteCount: bytes,
  };
}

export async function installAuthoredSkill(input = {}) {
  const { packagePath, root, projectPath, confirmed } = input;
  assert(confirmed === true, 'Installing an authored skill requires explicit confirmation.');
  assert(typeof root === 'string' && isAbsolute(root), 'The install root must be an absolute path.');

  const inspected = await inspectAuthoredSkill({
    packagePath,
    ...(projectPath === undefined ? {} : { projectPath }),
  });

  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(),
    'The install root must be a real directory, not a symlink.');
  const rootReal = await realpath(root);
  if (inspected.projectPath !== undefined) {
    assertInsideProject(inspected.projectPath, rootReal, 'The install root');
    assertInsideProject(inspected.projectPath, inspected.packagePath, 'The package');
  }

  const destination = join(rootReal, inspected.name);
  let existing;
  try {
    existing = await lstat(destination);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  assert(existing === undefined, `A skill package already exists at ${destination}; refusing to overwrite.`);

  try {
    await mkdir(destination, { mode: 0o700 });
    for (const file of inspected.files) {
      const source = await readBoundedFile(join(inspected.packagePath, ...file.path.split('/')));
      const path = join(destination, ...file.path.split('/'));
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        await handle.writeFile(source.content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (source.executable) await chmod(path, 0o700);
    }
    const installed = await inspectAuthoredSkill({
      packagePath: destination,
      expectedName: inspected.name,
      ...(inspected.projectPath === undefined ? {} : { projectPath: inspected.projectPath }),
    });
    assert(installed.fingerprint === inspected.fingerprint,
      'The installed package differs from the reviewed package.');
    return {
      name: installed.name,
      path: destination,
      fingerprint: installed.fingerprint,
      fileCount: installed.fileCount,
      byteCount: installed.byteCount,
    };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs(args) {
  const command = args[0];
  if (command === '--help' || command === '-h' || command === undefined) {
    console.log(`Usage:
  node authored-skill.mjs check --package <absolute-dir> [--name <skill-name>] [--project <absolute-dir>]
  node authored-skill.mjs install --package <absolute-dir> --root <absolute-dir> --confirmed [--project <absolute-dir>]`);
    process.exit(command === undefined ? 1 : 0);
  }
  assert(command === 'check' || command === 'install', 'Expected the check or install command.');
  const values = new Map();
  let index = 1;
  while (index < args.length) {
    const flag = args[index];
    if (flag === '--confirmed') {
      assert(!values.has(flag), 'Duplicate argument: --confirmed');
      values.set(flag, true);
      index += 1;
      continue;
    }
    const value = args[index + 1];
    assert(['--package', '--name', '--project', '--root'].includes(flag) &&
      typeof value === 'string' && value.length > 0,
    'Expected a supported flag and value.');
    assert(!values.has(flag), `Duplicate argument: ${flag}`);
    values.set(flag, value);
    index += 2;
  }
  const packagePath = values.get('--package');
  assert(typeof packagePath === 'string', '--package is required.');
  if (command === 'check') {
    assert([...values.keys()].every((flag) => ['--package', '--name', '--project'].includes(flag)),
      'The check command accepts only --package, --name, and --project.');
    return { command, packagePath, expectedName: values.get('--name'), projectPath: values.get('--project') };
  }
  assert([...values.keys()].every((flag) => ['--package', '--project', '--root', '--confirmed'].includes(flag)),
    'The install command accepts only --package, --root, --project, and --confirmed.');
  const root = values.get('--root');
  assert(typeof root === 'string', '--root is required for install.');
  return {
    command,
    packagePath,
    root,
    projectPath: values.get('--project'),
    confirmed: values.get('--confirmed') === true,
  };
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (parsed.command === 'check') {
    const result = await inspectAuthoredSkill({
      packagePath: parsed.packagePath,
      ...(parsed.expectedName === undefined ? {} : { expectedName: parsed.expectedName }),
      ...(parsed.projectPath === undefined ? {} : { projectPath: parsed.projectPath }),
    });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const result = await installAuthoredSkill({
    packagePath: parsed.packagePath,
    root: parsed.root,
    ...(parsed.projectPath === undefined ? {} : { projectPath: parsed.projectPath }),
    confirmed: parsed.confirmed,
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'The authored skill could not be validated.');
    process.exitCode = 1;
  });
}
