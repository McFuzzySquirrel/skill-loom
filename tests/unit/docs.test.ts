import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * ACC-FR-01 uses one documentation gate for both the CLI and the test suite.
 * Each case in this file invokes scripts/check-docs.mjs as a child process, so
 * the test cannot drift into a second, weaker implementation of the check.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkScript = join(repoRoot, 'scripts', 'check-docs.mjs');
const fixtures: string[] = [];

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'slan-docs-'));
  fixtures.push(root);
  mkdirSync(join(root, 'docs'), { recursive: true });

  copyFileSync(join(repoRoot, 'README.md'), join(root, 'README.md'));
  copyFileSync(
    join(repoRoot, 'docs', 'OPERATIONS.md'),
    join(root, 'docs', 'OPERATIONS.md'),
  );
  copyFileSync(join(repoRoot, 'package.json'), join(root, 'package.json'));

  return root;
}

function runCheck(root: string) {
  const result = spawnSync(
    process.execPath,
    [checkScript, '--root', root],
    { encoding: 'utf8' },
  );

  if (result.error) {
    throw result.error;
  }
  return result;
}

function replaceAllInFile(
  path: string,
  search: string,
  replacement: string,
): void {
  const current = readFileSync(path, 'utf8');
  expect(current).toContain(search);
  writeFileSync(path, current.split(search).join(replacement), 'utf8');
}

function outputOf(result: ReturnType<typeof runCheck>): string {
  return `${result.stdout}${result.stderr}`;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('operator documentation gate', () => {
  it('passes for the repository documentation', () => {
    const result = runCheck(repoRoot);

    expect(outputOf(result)).toContain('Documentation check passed');
    expect(result.status).toBe(0);
  });

  it('fails when a required heading is missing', () => {
    const root = createFixture();
    replaceAllInFile(
      join(root, 'docs', 'OPERATIONS.md'),
      '## Troubleshooting',
      '## Support',
    );

    const result = runCheck(root);

    expect(result.status).not.toBe(0);
    expect(outputOf(result)).toContain('missing required heading');
    expect(outputOf(result)).toContain('## Troubleshooting');
  });

  it('fails when a required command is missing', () => {
    const root = createFixture();
    replaceAllInFile(
      join(root, 'README.md'),
      'npm run test:live:execution',
      'npm run live-execution',
    );

    const result = runCheck(root);

    expect(result.status).not.toBe(0);
    expect(outputOf(result)).toContain('missing required command');
    expect(outputOf(result)).toContain('npm run test:live:execution');
  });

  it('fails when a required safety statement is missing', () => {
    const root = createFixture();
    replaceAllInFile(
      join(root, 'README.md'),
      'no authentication',
      'a login prompt',
    );

    const result = runCheck(root);

    expect(result.status).not.toBe(0);
    expect(outputOf(result)).toContain('missing required statement');
    expect(outputOf(result)).toContain('no authentication');
  });

  it('fails when a documented npm script is absent from package.json', () => {
    const root = createFixture();
    const manifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    delete manifest.scripts['test:live:discovery'];
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    const result = runCheck(root);

    expect(result.status).not.toBe(0);
    expect(outputOf(result)).toContain('package.json: missing script');
    expect(outputOf(result)).toContain('test:live:discovery');
  });
});
