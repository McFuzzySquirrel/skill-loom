#!/usr/bin/env node
import { lstat, open, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
const MAX_BUNDLE_FILES = 2_000;
const MAX_BUNDLE_SKILLS = 100;
const forbiddenSegments = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i;
const inputNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  assert(isRecord(value), `${label} must be an object.`);
  for (const key of Object.keys(value)) {
    assert(allowed.includes(key), `${label} contains an unsupported field: ${key}`);
  }
}

function nonEmpty(value, label) {
  assert(typeof value === 'string' && value.trim().length > 0 && value === value.trim(),
    `${label} must be a non-empty, trimmed string.`);
}

function validateRelativePath(path) {
  const parts = path.split('/');
  assert(path.length <= 512 && parts.length <= 32, 'A package file path exceeds Skill Loom limits.');
  assert(parts.every((part) =>
    part !== '.' && part !== '..' && /^[^\\/:*?"<>|\x00-\x1f]+$/.test(part) &&
    !/[. ]$/.test(part) && !forbiddenSegments.test(part) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)),
  `A package contains an unsafe or excluded path: ${path}`);
}

function validateChain(chain) {
  exactKeys(chain, ['name', 'harness', 'sessionMode', 'steps', 'inputs'], 'chain');
  nonEmpty(chain.name, 'chain.name');
  assert(chain.harness === 'opencode' || chain.harness === 'copilot',
    'chain.harness must be "opencode" or "copilot".');
  assert(['shared', 'fresh', 'fork'].includes(chain.sessionMode),
    'chain.sessionMode must be "shared", "fresh", or "fork".');
  assert(Array.isArray(chain.steps) && chain.steps.length > 0, 'chain.steps must contain at least one step.');
  assert(Array.isArray(chain.inputs), 'chain.inputs must be an array.');

  const stepIds = new Set();
  const referencedSkills = new Set();
  for (const [index, step] of chain.steps.entries()) {
    exactKeys(step, ['id', 'instruction', 'label', 'kind', 'skillName'], `chain.steps[${index}]`);
    nonEmpty(step.id, `chain.steps[${index}].id`);
    nonEmpty(step.instruction, `chain.steps[${index}].instruction`);
    assert(!stepIds.has(step.id), `Duplicate step id: ${step.id}`);
    stepIds.add(step.id);
    if (step.label !== undefined) nonEmpty(step.label, `chain.steps[${index}].label`);
    if (step.skillName !== undefined) {
      nonEmpty(step.skillName, `chain.steps[${index}].skillName`);
      assert(step.kind === undefined || step.kind === 'skill', `Invalid skill step kind at index ${index}.`);
      referencedSkills.add(step.skillName);
    } else {
      assert(step.kind === 'instruction', `Instruction step ${index} must have kind "instruction".`);
    }
  }

  const inputNames = new Set();
  for (const [index, input] of chain.inputs.entries()) {
    exactKeys(input, ['name', 'label', 'required'], `chain.inputs[${index}]`);
    assert(typeof input.name === 'string' && inputNamePattern.test(input.name),
      `chain.inputs[${index}].name must be an identifier.`);
    assert(!inputNames.has(input.name), `Duplicate input name: ${input.name}`);
    inputNames.add(input.name);
    if (input.label !== undefined) nonEmpty(input.label, `chain.inputs[${index}].label`);
    assert(typeof input.required === 'boolean', `chain.inputs[${index}].required must be a boolean.`);
  }

  for (const [index, step] of chain.steps.entries()) {
    for (const match of step.instruction.matchAll(/\{\{([^{}]*)\}\}/g)) {
      const name = (match[1] ?? '').trim();
      assert(inputNamePattern.test(name), `Invalid input placeholder in chain.steps[${index}].instruction.`);
      assert(inputNames.has(name), `Undeclared input placeholder: ${name}`);
    }
  }
  return referencedSkills;
}

function skillNameFromFrontmatter(content, fallback) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert(match, `The ${fallback} package has no valid SKILL.md frontmatter.`);
  const nameLine = match[1].split(/\r?\n/).find((line) => /^name\s*:/.test(line));
  assert(nameLine, `The ${fallback} package SKILL.md has no name field.`);
  const rawName = nameLine.slice(nameLine.indexOf(':') + 1).trim();
  let name = rawName;
  if (rawName.startsWith('"')) {
    const quoted = rawName.match(/^("(?:\\.|[^"\\])*")(?:\s+#.*)?$/);
    assert(quoted, `The ${fallback} package has an invalid skill name.`);
    try {
      name = JSON.parse(quoted[1]);
    } catch {
      fail(`The ${fallback} package has an invalid skill name.`);
    }
  } else if (rawName.startsWith("'")) {
    const quoted = rawName.match(/^'((?:[^']|'')*)'(?:\s+#.*)?$/);
    assert(quoted, `The ${fallback} package has an invalid skill name.`);
    name = quoted[1].replaceAll("''", "'");
  } else {
    name = rawName.replace(/\s+#.*$/, '').trim();
  }
  assert(name.length > 0 && name.length <= 128 && !/[\r\n]/.test(name),
    `The ${fallback} package has an invalid skill name.`);
  return name;
}

async function collectPackage(projectRoot, packagePath, skillName, state) {
  assert(isAbsolute(packagePath), `The package path for ${skillName} must be absolute.`);
  const rootInfo = await lstat(packagePath);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(),
    `The package path for ${skillName} must be a real directory.`);
  const packageRoot = await realpath(packagePath);
  const packageRelative = relative(projectRoot, packageRoot);
  assert(packageRelative !== '' && packageRelative !== '..' &&
    !packageRelative.startsWith(`..${sep}`) && !isAbsolute(packageRelative),
  `The ${skillName} package must be inside the declared project root.`);

  const files = [];
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      validateRelativePath(relativePath);
      const path = resolve(directory, entry.name);
      const info = await lstat(path);
      assert(!info.isSymbolicLink(), `The ${skillName} package contains a symlink: ${relativePath}`);
      if (info.isDirectory()) {
        await visit(path, relativePath);
        continue;
      }
      assert(info.isFile(), `The ${skillName} package contains a non-regular file: ${relativePath}`);
      assert(files.length < MAX_BUNDLE_FILES && state.files < MAX_BUNDLE_FILES,
        `Bundles are limited to ${MAX_BUNDLE_FILES} files.`);
      const content = await readFile(path);
      state.bytes += content.length;
      assert(state.bytes <= MAX_BUNDLE_BYTES, `Bundles are limited to ${MAX_BUNDLE_BYTES} bytes.`);
      files.push({
        path: relativePath,
        content: content.toString('base64'),
        executable: (info.mode & 0o111) !== 0,
      });
      state.files += 1;
    }
  }

  await visit(packageRoot);
  const paths = new Set(files.map((file) => file.path.toLowerCase()));
  assert(paths.size === files.length, `The ${skillName} package contains duplicate file paths.`);
  for (const file of files) {
    const segments = file.path.split('/');
    while (segments.length > 1) {
      segments.pop();
      assert(!paths.has(segments.join('/').toLowerCase()),
        `The ${skillName} package has a file/directory path conflict: ${file.path}`);
    }
  }
  const skillFile = files.find((file) => file.path === 'SKILL.md');
  assert(skillFile, `The ${skillName} package must include SKILL.md.`);
  const decodedSkill = Buffer.from(skillFile.content, 'base64').toString('utf8');
  assert(skillNameFromFrontmatter(decodedSkill, skillName) === skillName,
    `The ${skillName} package name does not match its SKILL.md frontmatter.`);
  return {
    name: skillName,
    directory: skillName,
    files,
  };
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node build-bundle.mjs --manifest <absolute-json-path> --out <absolute-new-file-path>');
    process.exit(0);
  }
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    assert((flag === '--manifest' || flag === '--out') && value,
      'Expected --manifest <absolute-path> and --out <absolute-path>.');
    assert(!values.has(flag), `Duplicate argument: ${flag}`);
    values.set(flag, value);
  }
  assert(values.size === 2, 'Expected --manifest <absolute-path> and --out <absolute-path>.');
  for (const [flag, path] of values) {
    assert(isAbsolute(path), `${flag} must be an absolute path.`);
  }
  return { manifestPath: values.get('--manifest'), outputPath: values.get('--out') };
}

async function main() {
  const { manifestPath, outputPath } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  exactKeys(manifest, ['projectPath', 'chain', 'skills'], 'manifest');
  assert(typeof manifest.projectPath === 'string' && isAbsolute(manifest.projectPath),
    'manifest.projectPath must be an absolute path.');
  const projectRoot = await realpath(manifest.projectPath);
  assert((await lstat(projectRoot)).isDirectory(), 'manifest.projectPath must resolve to a directory.');
  const referencedSkills = validateChain(manifest.chain);
  assert(Array.isArray(manifest.skills) && manifest.skills.length <= MAX_BUNDLE_SKILLS,
    `manifest.skills must be an array of at most ${MAX_BUNDLE_SKILLS} packages.`);

  const names = new Set();
  const directories = new Set();
  const state = { bytes: 0, files: 0 };
  const skills = [];
  for (const [index, skill] of manifest.skills.entries()) {
    exactKeys(skill, ['name', 'packagePath'], `manifest.skills[${index}]`);
    nonEmpty(skill.name, `manifest.skills[${index}].name`);
    assert(skill.name.length <= 128, `Skill names must be at most 128 characters: ${skill.name}`);
    assert(!/[\\/]/.test(skill.name), `Skill names must be a single safe directory segment: ${skill.name}`);
    validateRelativePath(skill.name);
    assert(!names.has(skill.name), `Duplicate package name: ${skill.name}`);
    assert(referencedSkills.has(skill.name), `Unreferenced package: ${skill.name}`);
    names.add(skill.name);
    const directory = skill.name.toLowerCase();
    assert(!directories.has(directory), `Package names must be unique without regard to case: ${skill.name}`);
    directories.add(directory);
    skills.push(await collectPackage(projectRoot, skill.packagePath, skill.name, state));
  }
  assert(names.size === referencedSkills.size, 'The manifest is missing a package for a referenced skill.');

  const bundle = {
    format: 'skill-loom-chain',
    version: 1,
    chain: manifest.chain,
    skills,
  };
  assert(basename(outputPath).endsWith('.loom.json'), 'The output file name must end in .loom.json.');
  const output = `${JSON.stringify(bundle, null, 2)}\n`;
  const file = await open(outputPath, 'wx', 0o600);
  try {
    await file.writeFile(output, 'utf8');
  } catch (error) {
    await file.close();
    await unlink(outputPath);
    throw error;
  }
  await file.close();
  console.log(`Created ${basename(outputPath)} with ${skills.length} skill package(s) and ${state.files} file(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Bundle creation failed.');
  process.exitCode = 1;
});
