#!/usr/bin/env node
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.github', 'skills', 'scenario-discovery');
const output = join(root, 'dist', 'skills', 'scenario-discovery');
const outputScripts = join(output, 'scripts');

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
await build({
  configFile: false,
  root,
  build: {
    outDir: relative(root, outputScripts),
    emptyOutDir: false,
    sourcemap: false,
    target: 'node24',
    lib: {
      entry: join(source, 'scripts', 'build-bundle.mjs'),
      formats: ['es'],
      fileName: 'build-bundle',
    },
    rollupOptions: { external: /^node:/ },
  },
});
await rm(join(outputScripts, 'build-bundle.mjs'));
await rename(
  join(outputScripts, 'build-bundle.js'),
  join(outputScripts, 'build-bundle.mjs'),
);
console.log(`Built ${relative(root, output)}.`);
