import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { access, chmod, link, mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executePortableRequest, openCheckedFile, packageFingerprint, treeFingerprint, type PackageTreeEntry } from '../../src/portable/runtime.js';
import { RunSchema } from '../../src/portable/run-schema.js';
import { writeInstalledModeIndex } from '../../src/portable/installed-modes.js';
import { runPortableCli } from '../../src/portable/cli.js';
import type { ChainBundle } from '../../src/shared/bundles.js';
import { scanProjectRunRecords } from '../../src/shared/project-run-records.js';
import {
  acquireProjectRunClaim, adoptReviewedLegacyRun, clearReviewedProjectClaim, enableReviewedProjectProtocol,
  requireProjectRunClaim, reviewProjectCoordination,
} from '../../src/shared/project-coordination.js';

let root: string;
let project: string;
let bundlePath: string;

const skillText = '---\nname: review\ndescription: Check work\n---\nReview the current changes.\n';
const bundle: ChainBundle = {
  format: 'skill-loom-chain',
  version: 1,
  chain: {
    name: 'Portable review',
    harness: 'opencode',
    sessionMode: 'shared',
    steps: [
      { id: 'skill-step', skillName: 'review', instruction: 'Review {{task}}.' },
      { id: 'instruction-step', kind: 'instruction', instruction: 'Summarize {{task}}.' },
    ],
    inputs: [{ name: 'task', required: true }],
  },
  skills: [{
    name: 'review',
    directory: 'review',
    files: [{
      path: 'SKILL.md',
      content: Buffer.from(skillText).toString('base64'),
      executable: false,
    }, {
      path: 'check.bin',
      content: Buffer.from([0, 1, 128, 255]).toString('base64'),
      executable: process.platform !== 'win32',
    }],
  }],
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-portable-')));
  project = join(root, 'project');
  bundlePath = join(root, 'review.loom.json');
  await mkdir(project);
  await writeFile(bundlePath, JSON.stringify(bundle));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function prepare(extra: Record<string, unknown> = {}) {
  const review = await executePortableRequest({
    command: 'inspect', projectPath: project, bundlePath,
    input: { globalSkillPaths: extra.globalSkillPaths },
  }) as {
    reviewDigest: string;
  };
  return await executePortableRequest({
    command: 'prepare',
    projectPath: project,
    bundlePath,
    input: {
      installConfirmed: true,
      reviewDigest: review.reviewDigest,
      actualHost: 'opencode',
      hostSwitchConfirmed: false,
      progression: 'supervised',
      sessionDecision: {
        requested: 'shared',
        mechanism: 'current-conversation',
        description: 'Continue in the current OpenCode conversation.',
        confirmed: true,
      },
      inputs: { task: 'the change' },
      ...extra,
    },
  }) as Promise<{ runId: string; revision: number }>;
}

function command(
  cmd: 'status' | 'step' | 'record' | 'resume',
  runId: string,
  revision: number,
  input: Record<string, unknown> = {},
) {
  return executePortableRequest({
    command: cmd,
    projectPath: project,
    runId,
    input: { revision, ...input },
  });
}

describe('portable bundle execution', () => {
  it('detects a file replaced after opening even when the new path is a regular file', async () => {
    const checked = await openCheckedFile(bundlePath, 'UNSAFE', 'CHANGED');
    try {
      await rename(bundlePath, join(root, 'original-bundle.json'));
      await writeFile(bundlePath, '{}');
      await expect(checked.verifyPath()).rejects.toMatchObject({ code: 'CHANGED' });
    } finally {
      await checked.handle.close();
    }
  });

  it.each([
    ['EACCES', 'EACCES'],
    ['SECRET_VALUE', undefined],
  ])('reports only recognized system error codes without exposing messages', async (rawCode, systemCode) => {
    async function* failedInput() {
      throw Object.assign(new Error('sensitive input and path'), { code: rawCode });
      yield '';
    }
    let stderr = '';
    const code = await runPortableCli(['prepare', '--project', project, '--bundle', bundlePath], {
      stdin: Readable.from(failedInput()),
      stderr: { write: (chunk) => { stderr += String(chunk); return true; } },
    });
    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toEqual({
      ok: false,
      error: {
        code: 'REQUEST_FAILED',
        message: 'The portable helper could not complete the request. Check file permissions and retry.',
        ...(systemCode === undefined ? {} : { systemCode }),
      },
    });
    expect(stderr).not.toContain('sensitive input and path');
    expect(stderr).not.toContain('SECRET_VALUE');
  });

  it('prepares executable bundle installation with reviewed executable intent', async () => {
    const executableBundle = structuredClone(bundle);
    executableBundle.skills[0]!.files[1]!.executable = true;
    await writeFile(bundlePath, JSON.stringify(executableBundle));
    const prepared = await prepare();
    const inventory: PackageTreeEntry[] = [];
    const destination = join(project, '.agents', 'skills', 'review');
    expect(await treeFingerprint(destination, inventory)).toBe(packageFingerprint(executableBundle.skills[0]!.files));
    expect(inventory.find((entry) => entry.path === 'check.bin')).toMatchObject({ executable: true });
    expect((await command('step', prepared.runId, prepared.revision, { confirmed: true }))).toMatchObject({ ok: true });
  });

  it('reuses a reviewed global skill without copying it and blocks later changes', async () => {
    const globalDirectory = join(root, 'global-skills', 'review');
    await mkdir(globalDirectory, { recursive: true });
    await writeFile(join(globalDirectory, 'SKILL.md'), skillText);
    await writeFile(join(globalDirectory, 'check.bin'), Buffer.from([0, 1, 128, 255]));
    if (process.platform !== 'win32') await chmod(join(globalDirectory, 'check.bin'), 0o755);

    let inspectOutput = '';
    let inspectError = '';
    const inspectCode = await runPortableCli(['inspect', '--project', project, '--bundle', bundlePath, '--stdin-json'], {
      stdin: Readable.from([JSON.stringify({ globalSkillPaths: { review: globalDirectory } })]),
      stdout: { write: (chunk) => { inspectOutput += String(chunk); return true; } },
      stderr: { write: (chunk) => { inspectError += String(chunk); return true; } },
    });
    expect(inspectCode, inspectError).toBe(0);
    const inspected = JSON.parse(inspectOutput) as {
      reviewDigest: string;
      skills: Array<{ globalReuse: { path: string; fingerprint: string; files: PackageTreeEntry[] } | null; bundledFingerprint: string }>;
    };
    expect(inspected.skills[0]?.globalReuse).toMatchObject({
      path: globalDirectory,
      fingerprint: inspected.skills[0]?.bundledFingerprint,
      files: expect.arrayContaining([expect.objectContaining({ path: 'SKILL.md', kind: 'file' })]),
    });

    const prepared = await prepare({
      globalSkillPaths: { review: globalDirectory },
      reuseSkills: ['review'],
    });
    await expect(access(join(project, '.agents', 'skills', 'review'))).rejects.toMatchObject({ code: 'ENOENT' });
    const started = await command('step', prepared.runId, prepared.revision, { confirmed: true }) as {
      revision: number;
    };
    expect(started).toMatchObject({
      step: { skillPath: globalDirectory },
    });
    const completed = await command('record', prepared.runId, started.revision, {
      outcome: 'done', confirmed: true,
    }) as { revision: number };

    await writeFile(join(globalDirectory, 'SKILL.md'), `${skillText}\nChanged after review.\n`);
    await expect(command('step', prepared.runId, completed.revision, { confirmed: true }))
      .rejects.toMatchObject({ code: 'PACKAGE_CHANGED' });
  });

  it('inspects a global skill named __proto__ safely', async () => {
    const protoBundle = structuredClone(bundle);
    protoBundle.chain.steps[0]!.skillName = '__proto__';
    protoBundle.skills[0]!.name = '__proto__';
    const protoSkillText = skillText.replace('name: review', 'name: __proto__');
    protoBundle.skills[0]!.files[0]!.content = Buffer.from(protoSkillText).toString('base64');
    await writeFile(bundlePath, JSON.stringify(protoBundle));

    const globalDirectory = join(root, 'global-skills', 'review');
    await mkdir(globalDirectory, { recursive: true });
    await writeFile(join(globalDirectory, 'SKILL.md'), protoSkillText);
    await writeFile(join(globalDirectory, 'check.bin'), Buffer.from([0, 1, 128, 255]));
    if (process.platform !== 'win32') await chmod(join(globalDirectory, 'check.bin'), 0o755);

    const input = JSON.parse(JSON.stringify({
      globalSkillPaths: Object.fromEntries([['__proto__', globalDirectory]]),
    }));
    const inspected = await executePortableRequest({
      command: 'inspect', projectPath: project, bundlePath, input,
    }) as { skills: Array<{ name: string; globalReuse: { path: string } | null }> };
    expect(inspected.skills[0]).toMatchObject({
      name: '__proto__',
      globalReuse: { path: globalDirectory },
    });
  });

  it('requires explicit confirmation to reuse differing global skill contents', async () => {
    const globalDirectory = join(root, 'global-skills', 'review');
    await mkdir(globalDirectory, { recursive: true });
    await writeFile(join(globalDirectory, 'SKILL.md'), `${skillText}\nGlobal edits\n`);
    await writeFile(join(globalDirectory, 'check.bin'), Buffer.from([0, 1, 128, 255]));
    if (process.platform !== 'win32') await chmod(join(globalDirectory, 'check.bin'), 0o755);

    const reuse = {
      globalSkillPaths: { review: globalDirectory },
      reuseSkills: ['review'],
    };
    await expect(prepare(reuse)).rejects.toMatchObject({
      code: 'REUSE_CONTENT_CONFIRMATION_REQUIRED',
    });

    const prepared = await prepare({ ...reuse, differingReuseConfirmed: true }) as { runId: string };
    expect(prepared.runId).toBeTruthy();
    await expect(access(join(project, '.agents', 'skills', 'review'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.runIf(process.platform === 'win32')('preserves executable intent through both standalone helper mirrors', async () => {
    const executableBundle = structuredClone(bundle);
    executableBundle.skills[0]!.files[1]!.executable = true;
    await writeFile(bundlePath, JSON.stringify(executableBundle));
    for (const [index, prefix] of ['.github/skills', 'skill'].entries()) {
      const target = join(root, `helper-project-${index}`);
      await mkdir(target);
      const helper = join(process.cwd(), prefix, 'loom-run-bundle', 'scripts', 'loom-bundle.mjs');
      const args = ['--disable-warning=ExperimentalWarning', helper];
      const review = spawnSync(process.execPath, [...args, 'inspect', '--bundle', bundlePath, '--project', target], {
        encoding: 'utf8', timeout: 30_000,
      });
      expect(review.status, review.stderr).toBe(0);
      const { reviewDigest } = JSON.parse(review.stdout) as { reviewDigest: string };
      const prepared = spawnSync(process.execPath, [...args, 'prepare', '--bundle', bundlePath, '--project', target], {
        input: JSON.stringify({
          installConfirmed: true, reviewDigest, actualHost: 'opencode', progression: 'supervised',
          sessionDecision: { requested: 'shared', mechanism: 'current-conversation', description: 'Current conversation.', confirmed: true },
          inputs: { task: 'the change' },
        }),
        encoding: 'utf8', timeout: 30_000,
      });
      expect(prepared.status, prepared.stderr).toBe(0);
      const inventory: PackageTreeEntry[] = [];
      await treeFingerprint(join(target, '.agents', 'skills', 'review'), inventory);
      expect(inventory.find((entry) => entry.path === 'check.bin')).toMatchObject({ executable: true });
    }
  }, 120_000);

  it('retains a portable claim through mutations and terminal status until separately cleared', async () => {
    const initial = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, initial.reviewDigest, true);
    const prepared = await prepare();
    const claim = await requireProjectRunClaim(project, { kind: 'portable', runId: prepared.runId });
    await expect(prepare({ reuseSkills: ['review'] }))
      .rejects.toMatchObject({ code: 'PROJECT_CLAIM_CONFLICT' });
    const started = await command('step', prepared.runId, prepared.revision, { confirmed: true }) as { revision: number };
    const done = await command('record', prepared.runId, started.revision, { outcome: 'done', confirmed: true }) as { revision: number };
    const aborted = await command('record', prepared.runId, done.revision, { action: 'abort' }) as { status: string };
    expect(aborted.status).toBe('aborted');
    const review = await reviewProjectCoordination(project);
    expect(review.claim).toEqual(claim);
    expect(review.records).toEqual([expect.objectContaining({ runId: prepared.runId, unresolved: false })]);
    await expect(clearReviewedProjectClaim(project, review.reviewDigest, false, true))
      .rejects.toMatchObject({ code: 'PROJECT_CONFIRMATION_REQUIRED' });
    await clearReviewedProjectClaim(project, review.reviewDigest, true, true);
    expect((await reviewProjectCoordination(project)).claim).toBeNull();
  });

  it('keeps a claim when preparation fails after claiming but before creating a run', async () => {
    const existing = join(project, '.agents', 'skills', 'review');
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, 'SKILL.md'), skillText);
    if (process.platform === 'win32') {
      await writeInstalledModeIndex(existing, [{ path: 'SKILL.md', executable: false, content: Buffer.from(skillText) }]);
    }
    const initial = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, initial.reviewDigest, true);
    await expect(prepare()).rejects.toMatchObject({ code: 'PACKAGE_CONFLICT' });
    const review = await reviewProjectCoordination(project);
    expect(review.claim).toMatchObject({ kind: 'portable' });
    expect(review.records).toEqual([]);
    expect(await readFile(join(existing, 'SKILL.md'), 'utf8')).toBe(skillText);
    await clearReviewedProjectClaim(project, review.reviewDigest, true, true);
  });

  it('does not install packages when a managed run claims the project', async () => {
    const initial = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, initial.reviewDigest, true);
    const claim = await acquireProjectRunClaim(project, 'managed', 'managed-owner');
    await expect(prepare()).rejects.toMatchObject({ code: 'PROJECT_CLAIM_CONFLICT' });
    expect((await reviewProjectCoordination(project)).claim).toEqual(claim);
    await expect(access(join(project, '.agents', 'skills', 'review'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks unclaimed legacy mutations after enablement until explicitly adopted', async () => {
    const prepared = await prepare();
    const initial = await reviewProjectCoordination(project);
    await enableReviewedProjectProtocol(project, initial.reviewDigest, true);
    const file = join(project, '.loom', 'portable-runs', `${prepared.runId}.json`);
    const original = await readFile(file, 'utf8');
    for (const [operation, input] of [
      ['step', { confirmed: true }],
      ['record', { action: 'abort' }],
      ['resume', { stoppedConfirmed: true }],
    ] as const) {
      await expect(command(operation, prepared.runId, prepared.revision, input))
        .rejects.toMatchObject({ code: 'PROJECT_CLAIM_MISMATCH' });
      expect(await readFile(file, 'utf8')).toBe(original);
    }
    const review = await reviewProjectCoordination(project);
    await adoptReviewedLegacyRun(project, { kind: 'portable', runId: prepared.runId }, review.reviewDigest, true, true);
    expect(await command('step', prepared.runId, prepared.revision, { confirmed: true }))
      .toMatchObject({ ok: true, attempt: 1 });
  });

  it('reports an unresolved portable run to the shared project record scanner', async () => {
    const result = await prepare();
    expect(await scanProjectRunRecords(project)).toEqual([expect.objectContaining({
      kind: 'portable', runId: result.runId, status: 'ready', unresolved: true,
    })]);
    await writeFile(join(project, '.loom', 'portable-runs', `${result.runId}.json`), '{"version":1', 'utf8');
    await expect(scanProjectRunRecords(project)).rejects.toMatchObject({ code: 'PROJECT_RUN_RECORDS_UNSAFE' });
  });

  it.each([
    ['runs/\n# keep this comment\n', 'runs/\n# keep this comment\nportable-runs/\n'],
    ['runs/', 'runs/\nportable-runs/\n'],
    ['# keep this comment\n', '# keep this comment\nruns/\nportable-runs/\n'],
    ['', 'runs/\nportable-runs/\n'],
    ['runs/\nportable-runs/\n!runs/\n!portable-runs/\n', 'runs/\nportable-runs/\n!runs/\n!portable-runs/\nruns/\nportable-runs/\n'],
    [' runs/\nportable-runs/\n', ' runs/\nportable-runs/\nruns/\nportable-runs/\n'],
    ['"runs/\\nportable-runs/\\n"\n', '"runs/\\nportable-runs/\\n"\nruns/\nportable-runs/\n'],
  ])(
    'preserves existing Git ignore rules and ignores portable run records',
    async (existing, expected) => {
      execFileSync('git', ['init', '--quiet', project]);
      await mkdir(join(project, '.loom'));
      await writeFile(join(project, '.loom', '.gitignore'), existing);
      const before = await stat(join(project, '.loom', '.gitignore'), { bigint: true });
      const result = await prepare();
      const after = await stat(join(project, '.loom', '.gitignore'), { bigint: true });
      expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
      expect(await readFile(join(project, '.loom', '.gitignore'), 'utf8'))
        .toBe(`${expected}project-claim.sqlite*\n`);
      for (const path of ['.loom/runs/example.json', `.loom/portable-runs/${result.runId}.json`,
        '.loom/project-claim.sqlite', '.loom/project-claim.sqlite-journal',
        '.loom/project-claim.sqlite-wal', '.loom/project-claim.sqlite-shm']) {
        execFileSync('git', ['-C', project, 'check-ignore', '--quiet', path]);
      }
    },
  );

  it('ignores both run stores when portable execution creates the Loom directory', async () => {
    execFileSync('git', ['init', '--quiet', project]);
    const result = await prepare();
    expect(await readFile(join(project, '.loom', '.gitignore'), 'utf8'))
      .toBe('runs/\nportable-runs/\nproject-claim.sqlite*\n');
    for (const path of ['.loom/runs/example.json', `.loom/portable-runs/${result.runId}.json`,
      '.loom/project-claim.sqlite', '.loom/project-claim.sqlite-journal',
      '.loom/project-claim.sqlite-wal', '.loom/project-claim.sqlite-shm']) {
      execFileSync('git', ['-C', project, 'check-ignore', '--quiet', path]);
    }
  });

  it('refuses to modify a hard-linked or oversized Loom ignore file', async () => {
    await mkdir(join(project, '.loom'));
    const ignore = join(project, '.loom', '.gitignore');
    const outside = join(root, 'outside-ignore');
    await writeFile(outside, 'original\n');
    await link(outside, ignore);
    await expect(prepare()).rejects.toMatchObject({ code: 'PATH_UNSAFE' });
    expect(await readFile(outside, 'utf8')).toBe('original\n');
    await rm(ignore);
    await writeFile(ignore, 'x'.repeat(1024 * 1024));
    await expect(prepare()).rejects.toMatchObject({ code: 'PATH_UNSAFE' });
    expect((await stat(ignore)).size).toBe(1024 * 1024);
  });

  it('bounds installed-package review by exact file, byte, entry, and inventory thresholds', async () => {
    const directory = join(project, 'package');
    await mkdir(join(directory, 'scripts'), { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), 'abc');
    await writeFile(join(directory, 'scripts', 'check.sh'), 'defg');
    await chmod(join(directory, 'scripts', 'check.sh'), 0o755);
    const inventory: PackageTreeEntry[] = [];
    const fingerprint = await treeFingerprint(directory, inventory);
    expect(fingerprint).toBe(packageFingerprint([
      { path: 'SKILL.md', content: Buffer.from('abc').toString('base64'), executable: false },
      { path: 'scripts/check.sh', content: Buffer.from('defg').toString('base64'), executable: process.platform !== 'win32' },
    ]));
    const inventoryBytes = inventory.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item), 'utf8') + 1, 0);
    const exact = { files: 2, bytes: 7, entries: 3, inventoryBytes };
    await expect(treeFingerprint(directory, [], exact)).resolves.toBe(fingerprint);
    for (const dimension of ['files', 'bytes', 'entries', 'inventoryBytes'] as const) {
      await expect(treeFingerprint(directory, [], { ...exact, [dimension]: exact[dimension] - 1 }))
        .rejects.toMatchObject({ code: 'PACKAGE_TOO_LARGE' });
    }
  });

  it('distinguishes package trees that collide under the old unframed fingerprint', async () => {
    const first = [
      { path: 'a', content: Buffer.from('one'), executable: false },
      { path: 'b', content: Buffer.from('prefix\x00c\x00f\x000\x00suffix'), executable: false },
    ];
    const second = [
      { path: 'a', content: Buffer.from('one\x00b\x00f\x000\x00prefix'), executable: false },
      { path: 'c', content: Buffer.from('suffix'), executable: false },
    ];
    const legacy = (files: typeof first) => {
      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(file.path).update('\0f\0').update('0').update('\0').update(file.content).update('\0');
      }
      return hash.digest('hex');
    };
    const encoded = (files: typeof first) => files.map((file) => ({
      ...file, content: file.content.toString('base64'),
    }));
    expect(legacy(first)).toBe(legacy(second));
    expect(packageFingerprint(encoded(first))).not.toBe(packageFingerprint(encoded(second)));
    const directory = join(project, 'package');
    await mkdir(directory);
    for (const file of first) await writeFile(join(directory, file.path), file.content);
    expect(await treeFingerprint(directory)).toBe(packageFingerprint(encoded(first)));
    await rm(join(directory, 'b'));
    for (const file of second) await writeFile(join(directory, file.path), file.content);
    expect(await treeFingerprint(directory)).toBe(packageFingerprint(encoded(second)));
  });

  it('keeps legacy runs readable and abortable but requires a fresh package review before another step', async () => {
    const prepared = await prepare();
    const path = join(project, '.loom', 'portable-runs', `${prepared.runId}.json`);
    const run = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(run.skillFingerprintVersion).toBe(2);
    expect(RunSchema.omit({ skillFingerprintVersion: true }).safeParse(run).success).toBe(false);
    delete run.skillFingerprintVersion;
    await writeFile(path, JSON.stringify(run));
    await expect(command('status', prepared.runId, prepared.revision)).resolves.toMatchObject({
      run: { status: 'ready' },
    });
    await expect(command('step', prepared.runId, prepared.revision, { confirmed: true }))
      .rejects.toMatchObject({ code: 'PACKAGE_REVIEW_REQUIRED' });
    await expect(command('record', prepared.runId, prepared.revision, { action: 'abort' }))
      .resolves.toMatchObject({ status: 'aborted' });
  });

  it('rejects a stale reuse review when installed content changes across legacy fingerprint boundaries', async () => {
    const directory = join(project, '.agents', 'skills', 'review');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), skillText);
    await writeFile(join(directory, 'x'), Buffer.from('prefix\x00y\x00f\x000\x00suffix'));
    if (process.platform === 'win32') {
      await writeInstalledModeIndex(directory, [
        { path: 'SKILL.md', executable: false, content: Buffer.from(skillText) },
        { path: 'x', executable: false, content: Buffer.from('prefix\x00y\x00f\x000\x00suffix') },
      ]);
    }
    const inspected = await executePortableRequest({ command: 'inspect', projectPath: project, bundlePath }) as {
      reviewDigest: string;
    };
    await writeFile(join(directory, 'SKILL.md'), Buffer.concat([
      Buffer.from(skillText), Buffer.from('\x00x\x00f\x000\x00prefix'),
    ]));
    await rm(join(directory, 'x'));
    await writeFile(join(directory, 'y'), 'suffix');
    await expect(prepare({
      reviewDigest: inspected.reviewDigest, reuseSkills: ['review'], differingReuseConfirmed: true,
    })).rejects.toMatchObject({ code: process.platform === 'win32' ? 'BUNDLE_SOURCE_UNAVAILABLE' : 'REVIEW_STALE' });
  });

  it('refuses a prepared step after a legacy-colliding installed package substitution', async () => {
    const directory = join(project, '.agents', 'skills', 'review');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), skillText);
    await writeFile(join(directory, 'x'), Buffer.from('prefix\x00y\x00f\x000\x00suffix'));
    if (process.platform === 'win32') {
      await writeInstalledModeIndex(directory, [
        { path: 'SKILL.md', executable: false, content: Buffer.from(skillText) },
        { path: 'x', executable: false, content: Buffer.from('prefix\x00y\x00f\x000\x00suffix') },
      ]);
    }
    const prepared = await prepare({ reuseSkills: ['review'], differingReuseConfirmed: true });
    await writeFile(join(directory, 'SKILL.md'), Buffer.concat([
      Buffer.from(skillText), Buffer.from('\x00x\x00f\x000\x00prefix'),
    ]));
    await rm(join(directory, 'x'));
    await writeFile(join(directory, 'y'), 'suffix');
    await expect(command('step', prepared.runId, prepared.revision, { confirmed: true }))
      .rejects.toMatchObject({ code: process.platform === 'win32' ? 'BUNDLE_SOURCE_UNAVAILABLE' : 'PACKAGE_CHANGED' });
    await expect(command('status', prepared.runId, prepared.revision)).resolves.toMatchObject({
      run: { status: 'ready', revision: prepared.revision },
    });
  });

  it('inspects v2 agents but refuses to silently run with a different current agent', async () => {
    const agentText = '---\nname: reviewer\ndescription: Review changes\n---\nReview the task.\n';
    const fingerprint = createHash('sha256').update(agentText).digest('hex');
    const agentBundle: ChainBundle = {
      format: 'skill-loom-chain',
      version: 2,
      chain: {
        ...bundle.chain,
        agent: {
          harness: 'opencode',
          name: 'reviewer',
          sourceId: 'source',
          revision: 'a'.repeat(40),
          repositoryPath: '.opencode/agents/reviewer.md',
          agentPath: 'reviewer.md',
          fingerprint,
        },
      },
      skills: bundle.skills,
      agents: [{
        name: 'reviewer',
        harness: 'opencode',
        agentPath: 'reviewer.md',
        fingerprint,
        content: Buffer.from(agentText).toString('base64'),
      }],
    };
    await writeFile(bundlePath, JSON.stringify(agentBundle));

    const preview = await executePortableRequest({
      command: 'inspect',
      bundlePath,
      projectPath: project,
    }) as { agents: Array<{ name: string; content: string }> };
    expect(preview.agents).toEqual([
      expect.objectContaining({ name: 'reviewer', content: agentText }),
    ]);
    await expect(prepare()).rejects.toMatchObject({
      code: 'NATIVE_AGENT_REQUIRES_LOOM',
    });
    await expect(readFile(join(project, '.agents', 'skills', 'review', 'SKILL.md')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('inspects without project writes and prepares frozen inputs and approved packages', async () => {
    const preview = await executePortableRequest({ command: 'inspect', bundlePath, projectPath: project }) as {
      bundleFingerprint: string;
      reviewDigest: string;
      skills: Array<{ skillMarkdown: string; bundledFingerprint: string }>;
    };
    expect(preview.bundleFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.reviewDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.skills[0]).toMatchObject({
      skillMarkdown: skillText,
      bundledFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    await expect(readFile(join(project, '.loom', '.gitignore'))).rejects.toMatchObject({ code: 'ENOENT' });

    const result = await prepare() as { runId: string; revision: number; status: string };
    expect(result).toMatchObject({ revision: 1, status: 'ready' });
    expect(await readFile(join(project, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe(skillText);
    expect((await readFile(join(project, '.agents', 'skills', 'review', 'check.bin'))).toString('hex')).toBe('000180ff');
    expect((await readFile(join(project, '.loom', '.gitignore'), 'utf8'))).toContain('portable-runs/');

    const status = await command('status', result.runId, result.revision) as { run: Record<string, unknown> };
    expect(status.run).toMatchObject({ status: 'ready', currentStepIndex: 0 });
    expect(status.run).not.toHaveProperty('resolvedInputs');
    expect(status.run).not.toHaveProperty('bundle');
  });

  it('rejects missing or stale review evidence before installing anything', async () => {
    const inspected = await executePortableRequest({ command: 'inspect', bundlePath, projectPath: project }) as {
      reviewDigest: string;
    };
    await expect(prepare({ reviewDigest: undefined })).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    const changed = structuredClone(bundle);
    changed.chain.name = 'Changed after review';
    await writeFile(bundlePath, JSON.stringify(changed));
    await expect(prepare({ reviewDigest: inspected.reviewDigest })).rejects.toMatchObject({ code: 'REVIEW_STALE' });
    await expect(readFile(join(project, '.agents', 'skills', 'review', 'SKILL.md')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const next = await executePortableRequest({ command: 'inspect', bundlePath, projectPath: project }) as {
      reviewDigest: string;
    };
    await rename(project, join(root, 'old-project'));
    await mkdir(project);
    await expect(prepare({ reviewDigest: next.reviewDigest })).rejects.toMatchObject({ code: 'REVIEW_STALE' });
  });

  it('rejects a changed reuse package after inspection', async () => {
    const destination = join(project, '.agents', 'skills', 'review');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'SKILL.md'), skillText);
    if (process.platform === 'win32') {
      await writeInstalledModeIndex(destination, [{ path: 'SKILL.md', executable: false, content: Buffer.from(skillText) }]);
    }
    const inspected = await executePortableRequest({ command: 'inspect', bundlePath, projectPath: project }) as {
      reviewDigest: string;
    };
    await writeFile(join(destination, 'SKILL.md'), `${skillText}\nChanged after review\n`);
    await expect(prepare({
      reviewDigest: inspected.reviewDigest, reuseSkills: ['review'], differingReuseConfirmed: true,
    })).rejects.toMatchObject({ code: 'REVIEW_STALE' });
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toContain('Changed after review');
    await expect(readFile(join(project, '.loom', '.gitignore'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses oversized or linked review inputs without installing', async () => {
    const linked = join(root, 'linked.loom.json');
    await symlink(bundlePath, linked);
    await expect(executePortableRequest({ command: 'inspect', bundlePath: linked, projectPath: project }))
      .rejects.toMatchObject({ code: 'BUNDLE_INVALID' });
    const destination = join(project, '.agents', 'skills', 'review');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'large.bin'), Buffer.alloc(20 * 1024 * 1024 + 1));
    await expect(executePortableRequest({ command: 'inspect', bundlePath, projectPath: project }))
      .rejects.toMatchObject({ code: 'PACKAGE_TOO_LARGE' });
    await expect(readFile(join(project, '.loom', '.gitignore'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a linked bundle in both standalone helper mirrors', async () => {
    const linked = join(root, 'linked-helper.loom.json');
    await symlink(bundlePath, linked, 'file');
    for (const prefix of ['.github/skills', 'skill']) {
      const helper = join(process.cwd(), prefix, 'loom-run-bundle', 'scripts', 'loom-bundle.mjs');
      const result = spawnSync(process.execPath, [
        '--disable-warning=ExperimentalWarning', helper, 'inspect', '--bundle', linked, '--project', project,
      ], { encoding: 'utf8', timeout: 15_000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, error: { code: 'BUNDLE_INVALID' } });
      expect(result.stdout).toBe('');
    }
  });

  it('requires per-step confirmation, preserves order and records completion', async () => {
    const run = await prepare() as { runId: string; revision: number };
    await expect(command('step', run.runId, run.revision)).rejects.toMatchObject({
      code: 'STEP_CONFIRMATION_REQUIRED',
    });
    const first = await command('step', run.runId, run.revision, { confirmed: true }) as {
      revision: number;
      step: { index: number; instruction: string; skillPath: string };
    };
    expect(first.step).toMatchObject({
      index: 0,
      instruction: 'Skill: review\n\nInstruction:\nReview the change.',
      skillPath: join(project, '.agents', 'skills', 'review'),
    });
    const done = await command('record', run.runId, first.revision, {
      outcome: 'done',
      confirmed: true,
      summary: 'Reviewed the requested change.',
    }) as { revision: number; currentStepIndex: number };
    expect(done.currentStepIndex).toBe(1);
    const second = await command('step', run.runId, done.revision, { confirmed: true }) as {
      revision: number;
      step: { kind: string; instruction: string };
    };
    expect(second.step).toMatchObject({ index: 1, kind: 'instruction', instruction: 'Instruction:\nSummarize the change.' });
    const complete = await command('record', run.runId, second.revision, {
      outcome: 'done',
      confirmed: true,
    }) as { status: string };
    expect(complete.status).toBe('completed');
  });

  it('requires separate consent for progression and session approximations', async () => {
    await expect(prepare({
      progression: 'agent',
      progressionConfirmed: false,
    })).rejects.toMatchObject({ code: 'PROGRESSION_CONFIRMATION_REQUIRED' });
    const freshBundle = structuredClone(bundle);
    freshBundle.chain.sessionMode = 'fresh';
    await writeFile(bundlePath, JSON.stringify(freshBundle));
    await expect(prepare({
      sessionDecision: {
        requested: 'fresh',
        mechanism: 'current-conversation',
        description: 'The current conversation is not isolated.',
        confirmed: false,
      },
    })).rejects.toMatchObject({ code: 'SESSION_CONFIRMATION_REQUIRED' });
    await expect(prepare({ actualHost: 'copilot' })).rejects.toMatchObject({
      code: 'HOST_SWITCH_CONFIRMATION_REQUIRED',
    });
  });

  it('uses a bounded labelled handoff for fork mode and supports explicitly opted-in progression', async () => {
      const forkBundle = structuredClone(bundle);
      forkBundle.chain.sessionMode = 'fork';
      await writeFile(bundlePath, JSON.stringify(forkBundle));
      const run = await prepare({
        sessionDecision: {
          requested: 'fork',
          mechanism: 'handoff',
          description: 'Use a bounded handoff in a new host worker.',
          confirmed: true,
        },
      }) as { runId: string; revision: number };
      const first = await command('step', run.runId, run.revision, { confirmed: true }) as { revision: number };
      const done = await command('record', run.runId, first.revision, {
        outcome: 'done',
        confirmed: true,
        summary: 'Completed the first step.',
      }) as { revision: number };
      const second = await command('step', run.runId, done.revision, { confirmed: true }) as {
        revision: number;
        step: { handoffNote: string | null };
      };
      expect(second.step.handoffNote).toContain('not a native session fork');
      expect(second.step.handoffNote).toContain('Completed the first step.');
      await command('record', run.runId, second.revision, { outcome: 'done', confirmed: true });

      const agentRun = await prepare({
        progression: 'agent',
        progressionConfirmed: true,
        reuseSkills: ['review'],
        sessionDecision: {
          requested: 'fork',
          mechanism: 'handoff',
          description: 'Use a bounded handoff in a new host worker.',
          confirmed: true,
        },
      }) as { runId: string; revision: number };
      const agentStep = await command('step', agentRun.runId, agentRun.revision) as { revision: number };
      const agentDone = await command('record', agentRun.runId, agentStep.revision, {
        outcome: 'done',
        summary: 'Agent-reported completion.',
      }) as { status: string };
      expect(agentDone.status).toBe('ready');
  });

  it('blocks new portable runs until the existing run completes or is aborted', async () => {
    const first = await prepare();
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({ code: 'RUN_ACTIVE_CONFLICT' });
    const paused = await command('record', first.runId, first.revision, { action: 'pause' }) as { revision: number };
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({ code: 'RUN_ACTIVE_CONFLICT' });
    await command('record', first.runId, paused.revision, { action: 'abort' });
    const second = await prepare({ reuseSkills: ['review'] });
    expect(second.runId).not.toBe(first.runId);
  });

  it('keeps an unresolved attempt exclusive through explicit recovery', async () => {
    const first = await prepare();
    const step = await command('step', first.runId, first.revision, { confirmed: true }) as { revision: number };
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({ code: 'RUN_ACTIVE_CONFLICT' });
    const interrupted = await command('resume', first.runId, step.revision, { stoppedConfirmed: true }) as { revision: number; status: string };
    expect(interrupted.status).toBe('interrupted');
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({ code: 'RUN_ACTIVE_CONFLICT' });
    const failed = await command('resume', first.runId, interrupted.revision, { decision: 'failed' }) as { revision: number };
    await command('record', first.runId, failed.revision, { action: 'abort' });
    await expect(prepare({ reuseSkills: ['review'] })).resolves.toMatchObject({ status: 'ready' });
  });

  it('does not remove an existing portable mutation lock', async () => {
    const first = await prepare();
    const lock = join(project, '.loom', 'portable-runs', '.lock');
    await writeFile(lock, 'existing owner\n');
    await expect(command('step', first.runId, first.revision, { confirmed: true }))
      .rejects.toMatchObject({ code: 'RUN_LOCKED' });
    expect(await readFile(lock, 'utf8')).toBe('existing owner\n');
    await rm(lock);
    await expect(command('step', first.runId, first.revision, { confirmed: true }))
      .resolves.toMatchObject({ runId: first.runId });
  });

  it.each(['legacy', 'enabled'] as const)('admits at most one concurrent portable helper in %s mode', async (mode) => {
    if (mode === 'enabled') {
      const review = await reviewProjectCoordination(project);
      await enableReviewedProjectProtocol(project, review.reviewDigest, true);
    }
    const inspected = await executePortableRequest({ command: 'inspect', projectPath: project, bundlePath }) as {
      reviewDigest: string;
    };
    const payload = JSON.stringify({
      installConfirmed: true, reviewDigest: inspected.reviewDigest, actualHost: 'opencode',
      progression: 'supervised', inputs: { task: 'the change' },
      sessionDecision: {
        requested: 'shared', mechanism: 'current-conversation', description: 'Current conversation.', confirmed: true,
      },
    });
    const script = `
      import { runPortableCli } from './src/portable/cli.ts';
      process.exitCode = await runPortableCli(['prepare', '--project', process.argv[1], '--bundle', process.argv[2]]);
    `;
    const invoke = () => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--input-type=module', '-e', script, project, bundlePath],
        { cwd: process.cwd(), stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(payload);
    });
    const results = await Promise.all([invoke(), invoke()]);
    const successful = results.filter((result) => result.code === 0);
    expect(successful.length, JSON.stringify(results)).toBeLessThanOrEqual(1);
    if (successful.length === 0) {
      expect(mode).toBe('enabled');
      expect(results.map((result) => (JSON.parse(result.stderr) as { error: { code: string } }).error.code).sort())
        .toEqual(['PROJECT_CLAIM_BUSY', 'PROJECT_CLAIM_CONFLICT']);
      const review = await reviewProjectCoordination(project);
      expect(review.claim).toMatchObject({ kind: 'portable' });
      expect(review.records).toEqual([]);
      return;
    }
    const success = JSON.parse(results.find((result) => result.code === 0)!.stdout) as { runId: string };
    const rejected = results.find((result) => result.code !== 0)!;
    expect([
      'RUN_LOCKED', 'RUN_ACTIVE_CONFLICT', 'REVIEW_STALE', 'PROJECT_CLAIM_BUSY',
      ...(mode === 'enabled' ? ['PROJECT_CLAIM_CONFLICT'] : []),
    ], JSON.stringify(rejected))
      .toContain((JSON.parse(rejected.stderr) as { error: { code: string } }).error.code);
    const review = await reviewProjectCoordination(project);
    expect(review.records).toEqual([expect.objectContaining({ kind: 'portable', runId: success.runId, unresolved: true })]);
    if (mode === 'enabled') expect(review.claim).toMatchObject({ kind: 'portable', runId: success.runId });
    else expect(review.claim).toBeNull();
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({
      code: mode === 'enabled' ? 'PROJECT_CLAIM_CONFLICT' : 'RUN_ACTIVE_CONFLICT',
    });
  });

  it('reports underlying errors during repeated cross-process claim races', async () => {
    const script = `
      import { executePortableRequest } from './src/portable/runtime.ts';
      const request = JSON.parse(process.argv[1]);
      try {
        await executePortableRequest(request);
        console.log(JSON.stringify({ ok: true }));
      } catch (error) {
        console.log(JSON.stringify({
          ok: false, name: error?.name, code: error?.code, syscall: error?.syscall,
          message: error?.message,
        }));
      }
    `;
    const invoke = (request: object) => new Promise<{
      ok: boolean; name?: string; code?: string; syscall?: string; message?: string;
    }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--disable-warning=ExperimentalWarning', '--import', 'tsx', '--input-type=module',
        '-e', script, JSON.stringify(request),
      ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Race fixture exited ${String(code)}: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(output) as { ok: boolean; code?: string });
        } catch (error) {
          reject(error);
        }
      });
    });
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const raceProject = join(root, `race-${String(iteration)}`);
      await mkdir(raceProject);
      const initial = await reviewProjectCoordination(raceProject);
      await enableReviewedProjectProtocol(raceProject, initial.reviewDigest, true);
      execFileSync('git', ['init', '--quiet', raceProject]);
      await writeFile(join(raceProject, '.loom', '.gitignore'),
        'runs/\nportable-runs/\n!runs/\n!portable-runs/\n!project-claim.sqlite\n');
      const inspected = await executePortableRequest({
        command: 'inspect', projectPath: raceProject, bundlePath,
      }) as { reviewDigest: string };
      const request = {
        command: 'prepare', projectPath: raceProject, bundlePath,
        input: {
          installConfirmed: true, reviewDigest: inspected.reviewDigest, actualHost: 'opencode',
          progression: 'supervised', inputs: { task: 'the change' },
          sessionDecision: {
            requested: 'shared', mechanism: 'current-conversation', description: 'Current conversation.', confirmed: true,
          },
        },
      };
      const results = await Promise.all([invoke(request), invoke(request)]);
      expect(results.filter((result) => result.ok).length, JSON.stringify(results)).toBeLessThanOrEqual(1);
      for (const result of results.filter((result) => !result.ok)) {
        expect([
          'RUN_LOCKED', 'RUN_ACTIVE_CONFLICT', 'REVIEW_STALE',
          'PROJECT_CLAIM_BUSY', 'PROJECT_CLAIM_CONFLICT',
        ], JSON.stringify(results)).toContain(result.code);
      }
      for (const path of ['.loom/runs/example.json', '.loom/portable-runs/example.json', '.loom/project-claim.sqlite']) {
        execFileSync('git', ['-C', raceProject, 'check-ignore', '--quiet', path]);
      }
    }
  }, 120_000);

  it('blocks a step when another unfinished legacy portable run exists', async () => {
    const first = await prepare();
    const directory = join(project, '.loom', 'portable-runs');
    const original = JSON.parse(await readFile(join(directory, `${first.runId}.json`), 'utf8')) as Record<string, unknown>;
    const otherId = '00000000-0000-4000-8000-000000000001';
    await writeFile(join(directory, `${otherId}.json`), JSON.stringify({ ...original, id: otherId }));
    await expect(command('step', first.runId, first.revision, { confirmed: true }))
      .rejects.toMatchObject({ code: 'RUN_ACTIVE_CONFLICT' });
    await command('record', otherId, first.revision, { action: 'abort' });
    await expect(command('step', first.runId, first.revision, { confirmed: true }))
      .resolves.toMatchObject({ runId: first.runId });
  });

  it('fails closed on corrupt or unsafe sibling run records', async () => {
    const first = await prepare();
    const directory = join(project, '.loom', 'portable-runs');
    const otherId = '00000000-0000-4000-8000-000000000001';
    const otherPath = join(directory, `${otherId}.json`);
    await writeFile(otherPath, '{invalid');
    await expect(command('step', first.runId, first.revision, { confirmed: true }))
      .rejects.toMatchObject({ code: 'RUN_FILE_INVALID' });
    await rm(otherPath);
    await symlink(join(directory, `${first.runId}.json`), otherPath);
    await expect(command('step', first.runId, first.revision, { confirmed: true }))
      .rejects.toMatchObject({ code: 'RUN_FILE_INVALID' });
    await rm(otherPath);
    await writeFile(otherPath, await readFile(join(directory, `${first.runId}.json`)));
    await expect(command('step', first.runId, first.revision, { confirmed: true }))
      .rejects.toMatchObject({ code: 'RUN_FILE_INVALID' });
  });

  it('enforces the portable run conflict scan record limit at its boundary', async () => {
    const first = await prepare();
    await command('record', first.runId, first.revision, { action: 'abort' });
    const directory = join(project, '.loom', 'portable-runs');
    const record = JSON.parse(await readFile(join(directory, `${first.runId}.json`), 'utf8')) as Record<string, unknown>;
    await Promise.all(Array.from({ length: 999 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`;
      return writeFile(join(directory, `${id}.json`), JSON.stringify({ ...record, id }));
    }));
    const atLimit = await prepare({ reuseSkills: ['review'] });
    await command('record', atLimit.runId, atLimit.revision, { action: 'abort' });
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({ code: 'RUN_SCAN_TOO_LARGE' });
  }, 30_000);

  it('enforces the portable run conflict scan byte limit at its boundary', async () => {
    const first = await prepare();
    await command('record', first.runId, first.revision, { action: 'abort' });
    const directory = join(project, '.loom', 'portable-runs');
    const firstPath = join(directory, `${first.runId}.json`);
    const record = JSON.parse(await readFile(firstPath, 'utf8')) as Record<string, unknown>;
    const firstBytes = (await stat(firstPath)).size;
    const part = 24 * 1024 * 1024;
    for (const [index, bytes] of [part, part, 64 * 1024 * 1024 - 2 * part - firstBytes].entries()) {
      const id = `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`;
      const content = Buffer.alloc(bytes, 0x20);
      content.write(JSON.stringify({ ...record, id }), 'utf8');
      await writeFile(join(directory, `${id}.json`), content);
    }
    const atLimit = await prepare({ reuseSkills: ['review'] });
    await command('record', atLimit.runId, atLimit.revision, { action: 'abort' });
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({ code: 'RUN_SCAN_TOO_LARGE' });
  }, 30_000);

  it('does not overwrite a package and requires explicit approval for differing reuse', async () => {
    const destination = join(project, '.agents', 'skills', 'review');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'SKILL.md'), skillText);
    if (process.platform === 'win32') {
      await writeInstalledModeIndex(destination, [{ path: 'SKILL.md', executable: false, content: Buffer.from(skillText) }]);
    }
    await expect(prepare()).rejects.toMatchObject({ code: 'PACKAGE_CONFLICT' });
    await writeFile(join(destination, 'SKILL.md'), `${skillText}\nLocal edits\n`);
    await expect(prepare({ reuseSkills: ['review'] })).rejects.toMatchObject({
      code: 'REUSE_CONTENT_CONFIRMATION_REQUIRED',
    });
    const result = await prepare({
      reuseSkills: ['review'],
      differingReuseConfirmed: true,
    }) as { runId: string };
    expect((await readFile(join(destination, 'SKILL.md'), 'utf8')).endsWith('Local edits\n')).toBe(true);
    expect(result.runId).toBeTruthy();
  });

  it('requires explicit interrupted-run recovery and never replays automatically', async () => {
    const run = await prepare() as { runId: string; revision: number };
    const step = await command('step', run.runId, run.revision, { confirmed: true }) as { revision: number };
    await expect(command('resume', run.runId, step.revision))
      .rejects.toMatchObject({ code: 'STOP_CONFIRMATION_REQUIRED' });
    expect(await command('status', run.runId, step.revision)).toMatchObject({
      run: { status: 'running', revision: step.revision },
    });
    const interrupted = await command('resume', run.runId, step.revision, { stoppedConfirmed: true }) as {
      revision: number;
      decisionRequired: boolean;
    };
    expect(interrupted.decisionRequired).toBe(true);
    await expect(command('step', run.runId, interrupted.revision, { confirmed: true })).rejects.toMatchObject({
      code: 'RUN_NOT_READY',
    });
    const ready = await command('resume', run.runId, interrupted.revision, { decision: 'retry' }) as {
      revision: number;
      status: string;
    };
    expect(ready.status).toBe('ready');
    const retry = await command('step', run.runId, ready.revision, { confirmed: true }) as {
      attempt: number;
    };
    expect(retry.attempt).toBe(2);
  });

  it('rejects stale revisions and changed installed packages before dispatch', async () => {
    const run = await prepare() as { runId: string; revision: number };
    await expect(command('step', run.runId, run.revision + 1, { confirmed: true })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await writeFile(join(project, '.agents', 'skills', 'review', 'SKILL.md'), `${skillText}\nChanged\n`);
    await expect(command('step', run.runId, run.revision, { confirmed: true })).rejects.toMatchObject({
      code: 'PACKAGE_CHANGED',
    });
  });

  it('requires a skip reason and allows pause, continue, and abort between steps', async () => {
    const run = await prepare() as { runId: string; revision: number };
    await expect(command('record', run.runId, run.revision, { action: 'skip' })).rejects.toMatchObject({
      code: 'SKIP_REASON_REQUIRED',
    });
    const paused = await command('record', run.runId, run.revision, { action: 'pause' }) as {
      revision: number;
      status: string;
    };
    expect(paused.status).toBe('paused');
    const ready = await command('resume', run.runId, paused.revision, { decision: 'continue' }) as {
      revision: number;
      status: string;
    };
    expect(ready.status).toBe('ready');
    const aborted = await command('record', run.runId, ready.revision, { action: 'abort' }) as {
      status: string;
    };
    expect(aborted.status).toBe('aborted');
  });

  it('blocks unsupported bundle content before package installation', async () => {
    const invalidBundle = structuredClone(bundle) as unknown as Record<string, unknown>;
    (invalidBundle['skills'] as Array<{ files: Array<{ path: string }> }>)[0]!.files[0]!.path = '../escape';
    await writeFile(bundlePath, JSON.stringify(invalidBundle));
    await expect(prepare()).rejects.toBeInstanceOf(Error);
    await expect(readFile(join(project, '.agents', 'skills', 'review', 'SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
