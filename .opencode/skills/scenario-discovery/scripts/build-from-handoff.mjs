#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, open, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readHandoffFile } from './handoff-validator.mjs';
import { inspectAuthoredSkill } from './authored-skill.mjs';

const MAX_SKILLS = 100;
const MAX_AUTHORED_SKILLS = 3;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node build-from-handoff.mjs --handoff <absolute-file-path> --manifest <absolute-json-path> --out <absolute-new-file-path>');
    process.exit(0);
  }
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    assert(['--handoff', '--manifest', '--out'].includes(flag) && value,
      'Expected --handoff <path> --manifest <path> --out <path>.');
    assert(!values.has(flag), `Duplicate argument: ${flag}`);
    assert(isAbsolute(value), `${flag} must be an absolute path.`);
    values.set(flag, value);
  }
  assert(values.size === 3, 'Expected --handoff <path> --manifest <path> --out <path>.');
  const output = values.get('--out');
  assert(basename(output).endsWith('.loom.json'), 'The output file name must end in .loom.json.');
  return { handoffPath: values.get('--handoff'), manifestPath: values.get('--manifest'), outputPath: output };
}

function validateLocalSkill(entry, index) {
  assert(entry && typeof entry === 'object' && !Array.isArray(entry) &&
    Object.keys(entry).sort().join(',') === 'fingerprint,name,packagePath',
  `Each localSkills[${index}] entry must contain only name, packagePath, and fingerprint.`);
  assert(typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= 128 &&
    entry.name === entry.name.trim() && !/[\\/:*?"<>|\x00-\x1f]/.test(entry.name) &&
    !/[. ]$/.test(entry.name) && entry.name !== '.' && entry.name !== '..',
  `localSkills[${index}].name must be a single safe directory segment.`);
  assert(typeof entry.packagePath === 'string' && isAbsolute(entry.packagePath),
    `localSkills[${index}].packagePath must be an absolute path.`);
  assert(typeof entry.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(entry.fingerprint),
    `localSkills[${index}].fingerprint must be a SHA-256 hex digest.`);
  return entry;
}

function validateManifest(raw, handoff) {
  const keys = Object.keys(raw ?? {}).sort().join(',');
  assert(raw && typeof raw === 'object' && !Array.isArray(raw) &&
    ['candidates,chain', 'candidates,chain,localSkills', 'candidates,chain,localSkills,projectPath',
      'candidates,chain,projectPath'].includes(keys),
  'The approved manifest must contain chain and candidates, with optional localSkills and projectPath.');
  assert(raw.chain && typeof raw.chain === 'object' && !Array.isArray(raw.chain),
    'The approved chain must be an object.');
  assert(Array.isArray(raw.candidates) && raw.candidates.length <= MAX_SKILLS,
    `Select no more than ${MAX_SKILLS} exact candidate identities.`);

  const localSkills = raw.localSkills === undefined
    ? []
    : (() => {
        assert(Array.isArray(raw.localSkills) && raw.localSkills.length <= MAX_AUTHORED_SKILLS,
          `Author no more than ${MAX_AUTHORED_SKILLS} new skills for one chain.`);
        return raw.localSkills.map(validateLocalSkill);
      })();
  if (localSkills.length > 0) {
    assert(typeof raw.projectPath === 'string' && isAbsolute(raw.projectPath),
      'projectPath is required when the manifest includes localSkills.');
  } else if (raw.projectPath !== undefined) {
    assert(typeof raw.projectPath === 'string' && isAbsolute(raw.projectPath),
      'projectPath must be an absolute path.');
  }
  const available = new Map(handoff.candidates.map((candidate) => [
    JSON.stringify([candidate.sourceId, candidate.revision, candidate.repositoryPath, candidate.fingerprint]),
    candidate,
  ]));
  const selected = [];
  const seen = new Set();
  for (const identity of raw.candidates) {
    assert(identity && typeof identity === 'object' && !Array.isArray(identity) &&
      Object.keys(identity).sort().join(',') === 'fingerprint,repositoryPath,revision,sourceId',
    'Each selected candidate must use its exact pinned identity.');
    const key = JSON.stringify([
      identity.sourceId,
      identity.revision,
      identity.repositoryPath,
      identity.fingerprint,
    ]);
    assert(!seen.has(key), 'The approved manifest repeats a candidate identity.');
    seen.add(key);
    const candidate = available.get(key);
    assert(candidate, 'A selected candidate is not present in the validated handoff.');
    selected.push(candidate);
  }
  const referenced = new Set((raw.chain.steps ?? [])
    .filter((step) => typeof step?.skillName === 'string')
    .map((step) => step.skillName));
  const names = new Set();
  for (const candidate of selected) {
    assert(referenced.has(candidate.name), `Selected candidate ${candidate.name} is not referenced by the approved chain.`);
    assert(!names.has(candidate.name), `The approved chain has an ambiguous same-name package: ${candidate.name}.`);
    names.add(candidate.name);
  }
  for (const local of localSkills) {
    assert(referenced.has(local.name), `Local skill ${local.name} is not referenced by the approved chain.`);
    assert(!names.has(local.name), `The approved chain has an ambiguous same-name package: ${local.name}.`);
    names.add(local.name);
  }
  assert(names.size === referenced.size,
    'Every referenced skill must match exactly one selected candidate or local package.');
  return { selected, localSkills, projectPath: raw.projectPath };
}

async function main() {
  assert(Number(process.versions.node.split('.')[0]) >= 24, 'Node.js 24 or newer is required.');
  const { handoffPath, manifestPath, outputPath } = parseArgs(process.argv.slice(2));
  const handoff = await readHandoffFile(handoffPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { selected, localSkills, projectPath } = validateManifest(manifest, handoff);
  const stage = await mkdtemp(join(tmpdir(), 'skill-loom-handoff-'));
  try {
    const skills = [];
    for (const candidate of selected) {
      const packageDirectory = join(stage, 'packages', candidate.name);
      await mkdir(packageDirectory, { recursive: true, mode: 0o700 });
      for (const file of candidate.files) {
        const path = join(packageDirectory, ...file.path.split('/'));
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const handle = await open(path, 'wx', file.executable ? 0o700 : 0o600);
        try {
          await handle.writeFile(Buffer.from(file.content, 'base64'));
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (file.executable) await chmod(path, 0o700);
      }
      skills.push({ name: candidate.name, packagePath: packageDirectory });
    }
    const localReviewed = [];
    for (const local of localSkills) {
      const inspected = await inspectAuthoredSkill({
        packagePath: local.packagePath,
        expectedName: local.name,
        projectPath,
        includeContent: true,
      });
      assert(inspected.fingerprint === local.fingerprint,
        `The local skill ${local.name} changed after review; inspect it again before building.`);
      const packageDirectory = join(stage, 'packages', local.name);
      await mkdir(packageDirectory, { recursive: true, mode: 0o700 });
      for (const file of inspected.files) {
        const path = join(packageDirectory, ...file.path.split('/'));
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const handle = await open(path, 'wx', file.executable ? 0o700 : 0o600);
        try {
          await handle.writeFile(Buffer.from(file.content, 'base64'));
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (file.executable) await chmod(path, 0o700);
      }
      localReviewed.push({ name: local.name, files: inspected.files });
      skills.push({ name: local.name, packagePath: packageDirectory });
    }
    const buildManifest = join(stage, 'manifest.json');
    await writeFile(buildManifest, `${JSON.stringify({
      projectPath: stage,
      chain: manifest.chain,
      skills,
    })}\n`, { flag: 'wx', mode: 0o600 });
    const helper = fileURLToPath(new URL('./build-bundle.mjs', import.meta.url));
    const stagedOutput = join(stage, 'verified.loom.json');
    const result = spawnSync(process.execPath, [
      helper,
      '--manifest',
      buildManifest,
      '--out',
      stagedOutput,
    ], { encoding: 'utf8', shell: false });
    if (result.error) throw result.error;
    assert(result.status === 0,
      `The existing Skill Loom bundle validator rejected the approved chain: ${result.stderr.trim()}`);
    const bundle = JSON.parse(await readFile(stagedOutput, 'utf8'));
    for (const candidate of selected) {
      const skill = bundle.skills.find((item) => item.name === candidate.name);
      assert(skill && skill.files.length === candidate.files.length,
        `The staged package for ${candidate.name} differs from the reviewed handoff.`);
      const reviewed = new Map(candidate.files.map((file) => [file.path, file]));
      for (const file of skill.files) {
        const source = reviewed.get(file.path);
        assert(source && source.content === file.content,
          `The staged package for ${candidate.name} differs from the reviewed handoff.`);
        file.executable = source.executable;
        reviewed.delete(file.path);
      }
      assert(reviewed.size === 0, `The staged package for ${candidate.name} differs from the reviewed handoff.`);
    }
    for (const local of localReviewed) {
      const skill = bundle.skills.find((item) => item.name === local.name);
      assert(skill && skill.files.length === local.files.length,
        `The staged package for ${local.name} differs from the reviewed local skill.`);
      const reviewed = new Map(local.files.map((file) => [file.path, file]));
      for (const file of skill.files) {
        const source = reviewed.get(file.path);
        assert(source && source.content === file.content && source.executable === file.executable,
          `The staged package for ${local.name} differs from the reviewed local skill.`);
        reviewed.delete(file.path);
      }
      assert(reviewed.size === 0,
        `The staged package for ${local.name} differs from the reviewed local skill.`);
    }
    const output = await open(outputPath, 'wx', 0o600);
    try {
      await output.writeFile(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      await output.sync();
    } catch (error) {
      await output.close();
      await unlink(outputPath);
      throw error;
    }
    await output.close();
    console.log(`Created ${basename(outputPath)} with ${selected.length + localReviewed.length} skill package(s).`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'The bundle could not be built.');
  process.exitCode = 1;
});
