#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Operator documentation gate for README.md and docs/OPERATIONS.md.
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
  '# Skill Loom',
  '## Requirements',
  '## Install',
  '## Development',
  '## Build and run',
  '## Run from a package',
  '## Commands',
  '## First run',
  '## Security and privacy',
  '## Operations guide',
]);

export const REQUIRED_OPERATIONS_HEADINGS = Object.freeze([
  '# Skill Loom Operations Guide',
  '## Configuration',
  '## Package and CLI',
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
  Object.freeze({ command: 'npm run test:package', script: 'test:package' }),
  Object.freeze({
    command: 'npx --yes --package=./skill-loom-cli-0.1.0.tgz skill-loom',
    script: null,
  }),
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
  'skill-loom-cli',
  'skill-loom',
]);

export const REQUIRED_OPERATIONS_STATEMENTS = Object.freeze([
  'LOOM_CONFIG_DIR',
  'skill-loom-cli',
  'npx skill-loom-cli',
  '.loom/chains',
  '.loom/runs',
  '~/.config/loom',
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
 * Repository-relative Markdown files covered by the integrity checks. Archived
 * material is excluded because it intentionally describes retired behavior.
 */
function collectMarkdownFiles(root) {
  const files = [];
  const addIfPresent = (path) => {
    if (existsSync(path)) {
      files.push(path);
    }
  };

  addIfPresent(join(root, 'README.md'));
  addIfPresent(join(root, 'CHANGELOG.md'));

  const walk = (directory) => {
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'archive') {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(path);
      }
    }
  };
  walk(join(root, 'docs'));

  return files;
}

function markdownSlugs(text) {
  const slugs = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match === null) {
      continue;
    }
    const heading = match[1]
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '');
    const slug = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    slugs.add(slug);
  }
  return slugs;
}

function checkRelativeLinks(root, files, failures) {
  const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const slugCache = new Map();

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '');
    for (const match of text.matchAll(linkPattern)) {
      const link = match[1];
      if (/^(?:https?:|mailto:|#)/i.test(link)) {
        continue;
      }

      const hashIndex = link.indexOf('#');
      const target = hashIndex === -1 ? link : link.slice(0, hashIndex);
      const anchor = hashIndex === -1 ? '' : link.slice(hashIndex + 1);
      if (target === '') {
        continue;
      }

      let targetPath;
      try {
        targetPath = resolve(dirname(file), decodeURIComponent(target));
      } catch {
        failures.push(`${relative(root, file)}: link is not valid URI encoding: ${link}`);
        continue;
      }

      if (!existsSync(targetPath)) {
        failures.push(`${relative(root, file)}: link target does not exist: ${link}`);
        continue;
      }

      if (anchor === '' || !targetPath.endsWith('.md')) {
        continue;
      }

      if (!slugCache.has(targetPath)) {
        slugCache.set(targetPath, markdownSlugs(readFileSync(targetPath, 'utf8')));
      }
      if (!slugCache.get(targetPath).has(anchor)) {
        failures.push(
          `${relative(root, file)}: link anchor does not exist: ${link}`,
        );
      }
    }
  }
}

function checkDocumentedScripts(root, files, failures) {
  const packagePath = join(root, 'package.json');
  if (!existsSync(packagePath)) {
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    return;
  }
  const scripts =
    typeof manifest?.scripts === 'object' && manifest.scripts !== null
      ? manifest.scripts
      : {};
  const commandPattern = /npm run ([A-Za-z0-9:_-]+)/g;

  for (const file of files) {
    if (file.endsWith('CHANGELOG.md')) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(commandPattern)) {
      const script = match[1];
      if (!Object.hasOwn(scripts, script)) {
        failures.push(
          `${relative(root, file)}: documented npm script does not exist: npm run ${script}`,
        );
      }
    }
  }
}

const RETIRED_TERMS = Object.freeze([
  /xterm\.js/i,
  /@fastify\/websocket/i,
  /trust panel/i,
  /Save copy to library/i,
  /test:e2e/i,
  /playwright\.config\.ts/i,
  /full-filesystem folder browser/i,
]);

function checkRetiredVocabulary(root, failures) {
  const guides = [
    'README.md',
    'docs/OPERATIONS.md',
    'docs/admin-guide.md',
    'docs/user-guide.md',
    'docs/standalone-skill-guide.md',
    'docs/visual-tour.md',
    'docs/scenario-chains.md',
    'docs/current-gaps.md',
    'docs/SUPPORT.md',
    'docs/README.md',
  ];
  for (const relativePath of guides) {
    const path = join(root, relativePath);
    if (!existsSync(path)) {
      continue;
    }
    const text = readFileSync(path, 'utf8');
    for (const pattern of RETIRED_TERMS) {
      if (pattern.test(text)) {
        failures.push(
          `${relativePath}: contains retired wording ${pattern}`,
        );
      }
    }
  }
}

function checkAdrIndexDates(root, failures) {
  const indexPath = join(root, 'docs', 'adr', 'README.md');
  if (!existsSync(indexPath)) {
    return;
  }
  for (const line of readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('| [ADR-')) {
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4) {
      continue;
    }
    const link = /\(([^)]+)\)/.exec(cells[0]);
    const date = cells[cells.length - 1];
    if (link === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      failures.push(`docs/adr/README.md: malformed ADR row: ${line.trim()}`);
      continue;
    }
    const recordPath = join(root, 'docs', 'adr', link[1]);
    if (!existsSync(recordPath)) {
      failures.push(`docs/adr/README.md: ADR link target does not exist: ${link[1]}`);
      continue;
    }
    const record = readFileSync(recordPath, 'utf8');
    const recordDate = /\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/.exec(record);
    if (recordDate === null) {
      failures.push(`docs/adr/${link[1]}: missing Date line`);
    } else if (recordDate[1] !== date) {
      failures.push(
        `docs/adr/${link[1]}: index date ${date} does not match record date ${recordDate[1]}`,
      );
    }
  }
}

function directoryFiles(directory, root = directory, files = []) {
  if (!existsSync(directory)) {
    return files;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      directoryFiles(path, root, files);
    } else if (entry.isFile()) {
      files.push(relative(root, path));
    }
  }
  return files;
}

function compareDirectories(root, leftRelative, rightRelative, failures) {
  const left = join(root, leftRelative);
  const right = join(root, rightRelative);
  if (!existsSync(left) || !existsSync(right)) {
    return;
  }
  const leftFiles = new Set(directoryFiles(left));
  const rightFiles = new Set(directoryFiles(right));
  for (const file of leftFiles) {
    const target = join(right, file);
    if (!rightFiles.has(file)) {
      failures.push(`${rightRelative}: missing mirrored file ${file}`);
      continue;
    }
    if (!readFileSync(join(left, file)).equals(readFileSync(target))) {
      failures.push(`${rightRelative}: mirrored file differs: ${file}`);
    }
  }
  for (const file of rightFiles) {
    if (!leftFiles.has(file)) {
      failures.push(`${rightRelative}: extra mirrored file ${file}`);
    }
  }
}

function checkSkillMirrors(root, failures) {
  const canonical = join(root, '.github', 'skills');
  const opencode = join(root, '.opencode', 'skills');
  if (existsSync(canonical) && existsSync(opencode)) {
    for (const entry of readdirSync(canonical, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(opencode, entry.name))) {
        compareDirectories(
          root,
          join('.github', 'skills', entry.name),
          join('.opencode', 'skills', entry.name),
          failures,
        );
      }
    }
  }

  for (const name of [
    'scenario-discovery',
    'loom-chain-workflow',
    'loom-run-bundle',
    'loom-skill-catalog',
  ]) {
    compareDirectories(
      root,
      join('.github', 'skills', name),
      join('skill', name),
      failures,
    );
  }
}

/**
 * Skills that intentionally live in exactly one project skill root. A second
 * copy under a mirror root drifts silently and is hard to spot in review.
 */
export const SINGLE_SOURCE_SKILLS = Object.freeze([
  Object.freeze({
    name: 'create-project-documentation',
    source: '.agents/skills',
  }),
]);

function checkSkillSources(root, failures) {
  const roots = ['.agents/skills', '.github/skills', '.opencode/skills'];
  if (!roots.some((relativePath) => existsSync(join(root, relativePath)))) {
    return;
  }
  for (const { name, source } of SINGLE_SOURCE_SKILLS) {
    if (!existsSync(join(root, source, name, 'SKILL.md'))) {
      failures.push(`${source}/${name}: required skill is missing`);
    }
    for (const duplicate of ['.github/skills', '.opencode/skills']) {
      if (duplicate !== source && existsSync(join(root, duplicate, name))) {
        failures.push(`${duplicate}/${name}: duplicate of ${source}/${name}`);
      }
    }
  }
}

/**
 * Run the documentation gate against a repository root.
 *
 * @param {string} [root] Repository root. Defaults to the directory above this script.
 * @param {{integrity?: boolean}} [options] Enable relative-link, script, vocabulary, ADR, and mirror checks.
 * @returns {{ok: boolean, root: string, failures: string[]}}
 */
export function checkDocs(root = DEFAULT_ROOT, options = {}) {
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

  if (options.integrity === true) {
    const files = collectMarkdownFiles(resolvedRoot);
    checkRelativeLinks(resolvedRoot, files, failures);
    checkDocumentedScripts(resolvedRoot, files, failures);
    checkRetiredVocabulary(resolvedRoot, failures);
    checkAdrIndexDates(resolvedRoot, failures);
    checkSkillMirrors(resolvedRoot, failures);
    checkSkillSources(resolvedRoot, failures);
  }

  return { ok: failures.length === 0, root: resolvedRoot, failures };
}

function parseArguments(argv) {
  let root = DEFAULT_ROOT;
  let integrity = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--integrity') {
      integrity = true;
      continue;
    }
    if (argument === '--root') {
      const value = argv[index + 1];
      if (value === undefined || value.trim() === '') {
        throw new Error('--root requires a directory argument');
      }
      root = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { root, integrity };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const { root, integrity } = parseArguments(process.argv.slice(2));
    const result = checkDocs(root, { integrity });
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
