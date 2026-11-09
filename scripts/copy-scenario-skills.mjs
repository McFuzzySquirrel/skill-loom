#!/usr/bin/env node
import { cp, lstat, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'src', 'server', 'chains', 'scenario-skills');
const destination = join(repoRoot, 'dist', 'src', 'server', 'chains', 'scenario-skills');
const sourceInfo = await lstat(source);

if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) {
  throw new Error('Scenario skill assets must be a real directory.');
}

await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, preserveTimestamps: true });
await cp(join(dirname(source), 'scenario-skill-modes.json'), join(dirname(destination), 'scenario-skill-modes.json'));
