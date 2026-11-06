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
const fixedTime = new Date('2000-01-01T00:00:00.000Z');

await rm(output, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(join(output, 'scripts'), { recursive: true });
await build({ configFile: join(root, 'vite.portable.config.ts'), root });
await rename(join(output, 'scripts', 'loom-bundle.js'), join(output, 'scripts', 'loom-bundle.mjs'));
await mkdir(join(source, 'scripts'), { recursive: true });
await mkdir(join(mirroredSource, 'scripts'), { recursive: true });
await cp(
  join(output, 'scripts', 'loom-bundle.mjs'),
  join(source, 'scripts', 'loom-bundle.mjs'),
);
await cp(
  join(output, 'scripts', 'loom-bundle.mjs'),
  join(mirroredSource, 'scripts', 'loom-bundle.mjs'),
);
await cp(join(source, 'SKILL.md'), join(output, 'SKILL.md'));
await cp(join(source, 'THIRD_PARTY_NOTICES.md'), join(output, 'THIRD_PARTY_NOTICES.md'));
await cp(join(source, 'references'), join(output, 'references'), { recursive: true });

const licenses = join(output, 'licenses');
await mkdir(licenses, { recursive: true });
for (const dependency of ['zod', 'yaml']) {
  const license = join(root, 'node_modules', dependency, 'LICENSE');
  await cp(license, join(licenses, `${dependency}-LICENSE`));
}

async function listFiles(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`The skill package contains a non-regular file: ${relative(output, path)}`);
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
