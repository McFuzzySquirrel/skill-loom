import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  license?: string;
  type?: string;
  engines?: Record<string, string>;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const pkg = JSON.parse(read('package.json')) as PackageJson;

const allDependencies: Record<string, string> = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
};

/**
 * Verified against the npm registry on 2026-11-04 and recorded in PRD 6.1.
 * ARCH-02 forbids silently substituting a different version or a floating range.
 */
const verifiedVersions: Record<string, string> = {
  typescript: '7.0.2',
  react: '19.3.1',
  'react-dom': '19.3.1',
  vite: '8.3.5',
  '@vitejs/plugin-react': '6.2.1',
  fastify: '5.12.8',
  '@fastify/static': '10.1.9',
  'node-pty': '1.1.0',
  zod: '4.6.7',
  yaml: '2.9.1',
  vitest: '5.1.0',
  tsx: '4.23.15',
};

const requiredScripts = [
  'dev',
  'build',
  'prepack',
  'start',
  'typecheck',
  'typecheck:server',
  'typecheck:web',
  'test',
  'test:unit',
  'test:integration',
  'test:package',
  'test:live:discovery',
  'test:live:execution',
  'check',
];

describe('package contract', () => {
  it('is an ESM package on Node 24 or newer', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.engines?.node).toBe('>=24');
  });

  it('declares every required npm script with a non-empty command', () => {
    for (const script of requiredScripts) {
      const command = pkg.scripts?.[script];
      expect(command, `missing npm script "${script}"`).toBeTypeOf('string');
      expect(command?.trim(), `empty npm script "${script}"`).not.toBe('');
    }
  });

  it('wires the required scripts to the documented tools', () => {
    expect(pkg.scripts?.dev).toBe('node scripts/dev-supervisor.mjs');
    expect(pkg.scripts?.postinstall).toBe('node install/ensure-pty-helper.mjs');
    expect(pkg.scripts?.build).toContain('build:web');
    expect(pkg.scripts?.build).toContain('build:server');
    expect(pkg.scripts?.['build:web']).toBe('vite build');
    expect(pkg.scripts?.['build:server']).toContain('tsc -p tsconfig.server.json');
    expect(pkg.scripts?.start).toContain('dist/src/server/index.js');
    expect(pkg.scripts?.['test:unit']).toContain('tests/unit');
    expect(pkg.scripts?.['test:integration']).toContain('tests/integration');
    expect(pkg.scripts?.['test:package']).toContain('scripts/package-smoke.mjs');
    expect(pkg.scripts?.['podman:cli']).toContain('.github/skills/loom-chain-workflow/scripts/skill-loom-podman.mjs');
    expect(pkg.scripts?.prepack).toBe('npm run build');
    expect(pkg.scripts?.['test:live:discovery']).toContain('scripts/live-discovery.ts');
    expect(pkg.scripts?.['test:live:execution']).toContain('scripts/live-execution.ts');
    expect(pkg.scripts?.check).toContain('scripts/check-docs.mjs');
  });

  it('declares the publishable CLI name, bin, and package file list', () => {
    expect(pkg.name).toBe('skill-loom-cli');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.license).toBe('MIT');
    expect(pkg.private).toBe(true);
    expect(pkg.bin).toEqual({
      'skill-loom': 'dist/src/server/cli.js',
      'skill-loom-podman': 'dist/skills/loom-chain-workflow/scripts/skill-loom-podman.mjs',
    });
    expect(pkg.files).toEqual([
      'dist/src',
      'dist/web',
      'dist/skills',
      'dist/package.json',
      'install/ensure-pty-helper.mjs',
      'docs/OPERATIONS.md',
    ]);
  });

  it('pins every verified dependency from PRD 6.1 exactly', () => {
    for (const [name, expected] of Object.entries(verifiedVersions)) {
      const actual = allDependencies[name];
      expect(actual, `missing dependency "${name}"`).toBeTypeOf('string');
      expect(actual, `"${name}" must match the verified version`).toBe(expected);
      expect(actual, `"${name}" must be an exact pin, not a range`).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
    }
  });

  it('does not introduce telemetry, alternate server frameworks, or a database', () => {
    const forbidden = [
      '@sentry/node',
      '@sentry/browser',
      'analytics',
      'datadog',
      'electron',
      'express',
      'koa',
      'mixpanel',
      'newrelic',
      'posthog-node',
      'prisma',
      'better-sqlite3',
    ];

    for (const name of forbidden) {
      expect(allDependencies[name], `unexpected dependency "${name}"`).toBeUndefined();
    }
  });
});

describe('TypeScript project configuration', () => {
  const rootConfig = JSON.parse(read('tsconfig.json')) as {
    compilerOptions?: Record<string, unknown>;
  };
  const serverConfig = JSON.parse(read('tsconfig.server.json')) as {
    extends?: string;
    compilerOptions?: Record<string, unknown>;
  };
  const webConfig = JSON.parse(read('tsconfig.web.json')) as {
    extends?: string;
    compilerOptions?: Record<string, unknown>;
  };

  it('enables strict compilation for both projects', () => {
    expect(rootConfig.compilerOptions?.strict).toBe(true);
    expect(serverConfig.extends).toBe('./tsconfig.json');
    expect(webConfig.extends).toBe('./tsconfig.json');
  });

  it('uses NodeNext ESM for the server project', () => {
    expect(serverConfig.compilerOptions?.module).toBe('NodeNext');
    expect(serverConfig.compilerOptions?.moduleResolution).toBe('NodeNext');
  });

  it('uses the React JSX transform for the web project', () => {
    expect(webConfig.compilerOptions?.jsx).toBe('react-jsx');
    expect(webConfig.compilerOptions?.noEmit).toBe(true);
    expect(webConfig.compilerOptions?.moduleResolution).toBe('Bundler');
  });

  it('exposes separate typecheck commands for server and web', () => {
    expect(pkg.scripts?.['typecheck:server']).toContain('tsconfig.server.json');
    expect(pkg.scripts?.['typecheck:web']).toContain('tsconfig.web.json');
  });
});

describe('build tooling contract', () => {
  it('builds the web UI into dist/web from the React plugin', () => {
    const viteConfig = read('vite.config.ts');

    expect(viteConfig).toContain("from '@vitejs/plugin-react'");
    expect(viteConfig).toContain('plugins: [react()]');
    expect(viteConfig).toMatch(/outDir:\s*'dist\/web'/);
  });

  it('runs unit, integration, and web-logic suites with Vitest in Node', () => {
    const vitestConfig = read('vitest.config.ts');

    expect(vitestConfig).toContain("environment: 'node'");
    expect(vitestConfig).toContain('tests/unit/**/*.test.ts');
    expect(vitestConfig).toContain('tests/integration/**/*.test.ts');
    expect(vitestConfig).toContain('tests/web/**/*.test.ts');
  });
});
