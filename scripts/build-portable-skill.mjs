#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.github', 'skills', 'loom-run-bundle');
const mirroredSource = join(root, 'skill', 'loom-run-bundle');
const output = join(root, 'dist', 'skills', 'loom-run-bundle');
const archive = join(root, 'dist', 'skills', 'loom-run-bundle.zip');
const discoverySource = join(root, '.github', 'skills', 'scenario-discovery');
const discoveryMirror = join(root, 'skill', 'scenario-discovery');
const discoveryOutput = join(root, 'dist', 'skills', 'scenario-discovery');
const discoveryArchive = join(root, 'dist', 'skills', 'scenario-discovery-v1.zip');
const workflowSource = join(root, '.github', 'skills', 'loom-chain-workflow');
const workflowMirror = join(root, 'skill', 'loom-chain-workflow');
const workflowOutput = join(root, 'dist', 'skills', 'loom-chain-workflow');
const workflowArchive = join(root, 'dist', 'skills', 'loom-chain-workflow.zip');
const fixedTime = new Date('2000-01-01T00:00:00.000Z');

await rm(output, { recursive: true, force: true });
await rm(archive, { force: true });
await rm(discoveryOutput, { recursive: true, force: true });
await rm(discoveryArchive, { force: true });
await rm(workflowOutput, { recursive: true, force: true });
await rm(workflowArchive, { force: true });
await mkdir(join(output, 'scripts'), { recursive: true });
await build({ configFile: join(root, 'vite.portable.config.ts'), root });
await rename(join(output, 'scripts', 'loom-bundle.js'), join(output, 'scripts', 'loom-bundle.mjs'));
await mkdir(join(source, 'scripts'), { recursive: true });
await cp(
  join(output, 'scripts', 'loom-bundle.mjs'),
  join(source, 'scripts', 'loom-bundle.mjs'),
);
// The checked-in mirror must match the canonical skill package, not only the
// generated helper; otherwise references and notices drift silently.
await rm(mirroredSource, { recursive: true, force: true });
await cp(source, mirroredSource, { recursive: true });
await cp(join(source, 'SKILL.md'), join(output, 'SKILL.md'));
await cp(join(source, 'THIRD_PARTY_NOTICES.md'), join(output, 'THIRD_PARTY_NOTICES.md'));
await cp(join(source, 'references'), join(output, 'references'), { recursive: true });

const licenses = join(output, 'licenses');
await mkdir(licenses, { recursive: true });
for (const dependency of ['zod', 'yaml']) {
  const license = join(root, 'node_modules', dependency, 'LICENSE');
  await cp(license, join(licenses, `${dependency}-LICENSE`));
}

async function listFiles(directory, packageRoot = directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path, packageRoot));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`The skill package contains a non-regular file: ${relative(packageRoot, path)}`);
  }
  return files;
}

const zipped = {};
for (const path of await listFiles(output)) {
  const relativePath = relative(output, path).split('\\').join('/');
  zipped[`loom-run-bundle/${relativePath}`] = [
    new Uint8Array(await readFile(path)),
    { mtime: fixedTime, os: 3, attrs: 0o100644 << 16 },
  ];
}
await mkdir(dirname(archive), { recursive: true });
await writeFile(archive, zipSync(zipped, { level: 9 }));
console.log(`Built ${relative(root, output)} and ${relative(root, archive)}.`);

await rm(discoveryMirror, { recursive: true, force: true });
await cp(discoverySource, discoveryMirror, { recursive: true });
await cp(discoverySource, discoveryOutput, { recursive: true });
await cp(join(root, 'LICENSE'), join(discoveryOutput, 'LICENSE'));
const discoveryFiles = {};
for (const path of await listFiles(discoveryOutput)) {
  const relativePath = relative(discoveryOutput, path).split('\\').join('/');
  discoveryFiles[`scenario-discovery/${relativePath}`] = [
    new Uint8Array(await readFile(path)),
    { mtime: fixedTime, os: 3, attrs: 0o100644 << 16 },
  ];
}
await writeFile(discoveryArchive, zipSync(discoveryFiles, { level: 9 }));
console.log(`Built ${relative(root, discoveryOutput)} and ${relative(root, discoveryArchive)}.`);

await rm(workflowMirror, { recursive: true, force: true });
await cp(workflowSource, workflowMirror, { recursive: true });
await cp(workflowSource, workflowOutput, { recursive: true });
await cp(join(root, 'LICENSE'), join(workflowOutput, 'LICENSE'));
const workflowFiles = {};
for (const path of await listFiles(workflowOutput)) {
  const relativePath = relative(workflowOutput, path).split('\\').join('/');
  workflowFiles[`loom-chain-workflow/${relativePath}`] = [
    new Uint8Array(await readFile(path)),
    { mtime: fixedTime, os: 3, attrs: 0o100644 << 16 },
  ];
}
await writeFile(workflowArchive, zipSync(workflowFiles, { level: 9 }));
console.log(`Built ${relative(root, workflowOutput)} and ${relative(root, workflowArchive)}.`);
