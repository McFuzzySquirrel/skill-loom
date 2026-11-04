#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Operator documentation gate for ACC-FR-01.
 *
 * The check is intentionally executable rather than a prose promise: it fails
 * when a required heading, npm command, or safety statement disappears from
 * README.md or docs/OPERATIONS.md. It also verifies that every documented npm
 * command still exists in package.json so the docs cannot drift from the
 * project's script contract.
 */

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIRECTORY, '..');

export const REQUIRED_README_HEADINGS = Object.freeze([
  '# Slan',
  '## Requirements',
  '## Install',
  '## Development',
  '## Build and run',
  '## Commands',
  '## First run',
  '## Security and privacy',
  '## Operations guide',
]);

export const REQUIRED_OPERATIONS_HEADINGS = Object.freeze([
  '# Slan Operations Guide',
  '## Configuration',
  '## Data locations',
  '## Harness prerequisites',
  '## Copilot trust and automatic permissions',
  '## Security model',
  '## Backup and cleanup',
  '## Skill firing limitation',
  '## Fork handoff behavior',
  '## Troubleshooting',
  '### Missing harness CLI',
  '### Authentication failure',
  '### Copilot trust block',
  '### node-pty build failure',
  '### Dirty git tree',
  '### Interrupted run',
]);

/**
 * Commands the README must document. `script` is the package.json script name
 * that must exist for `npm run` commands; `null` means the command is part of
 * npm itself and needs no project script.
 */
export const REQUIRED_README_COMMANDS = Object.freeze([
  Object.freeze({ command: 'npm install', script: null }),
  Object.freeze({ command: 'npm run dev', script: 'dev' }),
  Object.freeze({ command: 'npm run build', script: 'build' }),
  Object.freeze({ command: 'npm start', script: 'start' }),
  Object.freeze({ command: 'npm run typecheck', script: 'typecheck' }),
  Object.freeze({ command: 'npm run test:unit', script: 'test:unit' }),
  Object.freeze({ command: 'npm run test:e2e', script: 'test:e2e' }),
  Object.freeze({
    command: 'npm run test:live:discovery',
    script: 'test:live:discovery',
  }),
  Object.freeze({
    command: 'npm run test:live:execution',
    script: 'test:live:execution',
  }),
]);

export const REQUIRED_README_STATEMENTS = Object.freeze([
  'model-invoked',
  'prompt order',
  'not a guarantee',
  'loopback-only',
  'no authentication',
  '127.0.0.1',
]);

export const REQUIRED_OPERATIONS_STATEMENTS = Object.freeze([
  'SLAN_CONFIG_DIR',
  '.slan/chains',
  '.slan/runs',
  '~/.config/slan',
  'loopback-only',
  'no authentication',
  'model-invoked',
  'prompt order',
  'not a guarantee',
  '200-line or 32 KiB',
  'git-ignored',
  '--allow-all-tools',
  '--allow-all-paths',
  'not a native session fork',
]);

function checkFile(root, relativePath, failures) {
  const target = join(root, relativePath);
  if (!existsSync(target)) {
    failures.push(`${relativePath}: file is missing`);
    return null;
  }

  try {
    return readFileSync(target, 'utf8');
  } catch (error) {
    failures.push(
      `${relativePath}: could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
    return null;
  }
}

function checkHeadings(relativePath, text, headings, failures) {
  if (text === null) {
    return;
  }

  const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  for (const heading of headings) {
    if (!lines.has(heading)) {
      failures.push(`${relativePath}: missing required heading "${heading}"`);
    }
  }
}

function checkCommands(text, failures) {
  if (text === null) {
    return;
  }

  for (const entry of REQUIRED_README_COMMANDS) {
    if (!text.includes(entry.command)) {
      failures.push(`README.md: missing required command "${entry.command}"`);
    }
  }
}

function checkStatements(relativePath, text, statements, failures) {
  if (text === null) {
    return;
  }

  const lowered = text.toLowerCase();
  for (const statement of statements) {
    if (!lowered.includes(statement.toLowerCase())) {
      failures.push(
        `${relativePath}: missing required statement "${statement}"`,
      );
    }
  }
}

function checkPackageScripts(root, failures) {
  const packagePath = join(root, 'package.json');
  if (!existsSync(packagePath)) {
    failures.push('package.json: file is missing; the npm command contract cannot be verified');
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    failures.push(
      `package.json: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
    return;
  }

  const scripts =
    typeof manifest === 'object' &&
    manifest !== null &&
    typeof manifest.scripts === 'object' &&
    manifest.scripts !== null
      ? manifest.scripts
      : {};

  for (const entry of REQUIRED_README_COMMANDS) {
    if (entry.script === null) {
      continue;
    }
    const command = scripts[entry.script];
    if (typeof command !== 'string' || command.trim() === '') {
      failures.push(
        `package.json: missing script "${entry.script}" documented by "${entry.command}"`,
      );
    }
  }
}

/**
 * Run the documentation gate against a repository root.
 *
 * @param {string} [root] Repository root. Defaults to the directory above this script.
 * @returns {{ok: boolean, root: string, failures: string[]}}
 */
export function checkDocs(root = DEFAULT_ROOT) {
  const resolvedRoot = resolve(root);
  const failures = [];

  const readme = checkFile(resolvedRoot, 'README.md', failures);
  const operations = checkFile(resolvedRoot, 'docs/OPERATIONS.md', failures);

  checkHeadings('README.md', readme, REQUIRED_README_HEADINGS, failures);
  checkHeadings(
    'docs/OPERATIONS.md',
    operations,
    REQUIRED_OPERATIONS_HEADINGS,
    failures,
  );
  checkCommands(readme, failures);
  checkStatements(
    'README.md',
    readme,
    REQUIRED_README_STATEMENTS,
    failures,
  );
  checkStatements(
    'docs/OPERATIONS.md',
    operations,
    REQUIRED_OPERATIONS_STATEMENTS,
    failures,
  );
  checkPackageScripts(resolvedRoot, failures);

  return { ok: failures.length === 0, root: resolvedRoot, failures };
}

function parseRootArgument(argv) {
  const index = argv.indexOf('--root');
  if (index === -1) {
    return DEFAULT_ROOT;
  }

  const value = argv[index + 1];
  if (value === undefined || value.trim() === '') {
    throw new Error('--root requires a directory argument');
  }
  return resolve(value);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const result = checkDocs(parseRootArgument(process.argv.slice(2)));
    if (!result.ok) {
      console.error('Documentation check failed:');
      for (const failure of result.failures) {
        console.error(` - ${failure}`);
      }
      process.exitCode = 1;
    } else {
      console.log(`Documentation check passed for ${result.root}.`);
    }
  } catch (error) {
    console.error(
      `Documentation check could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
