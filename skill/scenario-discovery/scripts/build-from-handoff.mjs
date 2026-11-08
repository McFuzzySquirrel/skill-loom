#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readHandoffFile } from './handoff-validator.mjs';

const MAX_SKILLS = 100;

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

function validateManifest(raw, handoff) {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw) &&
    Object.keys(raw).sort().join(',') === 'candidates,chain',
  'The approved manifest must contain only chain and candidates.');
  assert(raw.chain && typeof raw.chain === 'object' && !Array.isArray(raw.chain),
    'The approved chain must be an object.');
  assert(Array.isArray(raw.candidates) && raw.candidates.length <= MAX_SKILLS,
    `Select no more than ${MAX_SKILLS} exact candidate identities.`);
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
  assert(names.size === referenced.size,
    'Every referenced skill must match exactly one selected candidate package.');
  return selected;
}

async function main() {
  assert(Number(process.versions.node.split('.')[0]) >= 24, 'Node.js 24 or newer is required.');
  const { handoffPath, manifestPath, outputPath } = parseArgs(process.argv.slice(2));
  const handoff = await readHandoffFile(handoffPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const selected = validateManifest(manifest, handoff);
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
    const buildManifest = join(stage, 'manifest.json');
    await writeFile(buildManifest, `${JSON.stringify({
      projectPath: stage,
      chain: manifest.chain,
      skills,
    })}\n`, { flag: 'wx', mode: 0o600 });
    const helper = fileURLToPath(new URL('./build-bundle.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [
      helper,
      '--manifest',
      buildManifest,
      '--out',
      outputPath,
    ], { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    assert(result.status === 0, 'The existing Skill Loom bundle validator rejected the approved chain.');
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'The bundle could not be built.');
  process.exitCode = 1;
});
