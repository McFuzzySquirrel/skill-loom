import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBundle } from '../../src/portable/bundle.js';

const roots: string[] = [];
const scripts = join(process.cwd(), '.github', 'skills', 'scenario-discovery', 'scripts');

async function fixture(root: string, skillName = 'helper-skill') {
  const files = [
    {
      path: 'SKILL.md',
      content: Buffer.from(`---\nname: ${skillName}\ndescription: Helper fixture.\n---\nReview.\n`).toString('base64'),
      executable: false,
    },
    {
      path: 'scripts/check.sh',
      content: Buffer.from('#!/bin/sh\nprintf safe\n').toString('base64'),
      executable: true,
    },
  ];
  const packageFingerprint = createHash('sha256');
  for (const file of files) {
    packageFingerprint
      .update(file.path)
      .update('\0')
      .update(file.executable ? 'x' : '-')
      .update('\0')
      .update(Buffer.from(file.content, 'base64'));
  }
  const candidate = {
    sourceId: 'test-source',
    revision: 'a'.repeat(40),
    repositoryPath: 'skills/helper',
    name: skillName,
    fingerprint: packageFingerprint.digest('hex'),
    files,
  };
  const body = {
    format: 'skill-loom-discovery-handoff',
    version: 1,
    goal: 'Review a helper skill',
    harness: 'opencode',
    createdAt: '2026-11-08T00:00:00.000Z',
    candidates: [candidate],
  };
  const handoff = {
    ...body,
    fingerprint: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
  };
  const handoffPath = join(root, 'input.loom-discovery.json');
  await writeFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
  const manifestPath = join(root, 'approved.json');
  await writeFile(manifestPath, JSON.stringify({
    chain: {
      name: 'Approved review',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{
        id: 'review',
        kind: 'skill',
        skillName,
        instruction: 'Review {{scope}}.',
      }],
      inputs: [{ name: 'scope', label: 'Review scope', required: true }],
    },
    candidates: [{
      sourceId: candidate.sourceId,
      revision: candidate.revision,
      repositoryPath: candidate.repositoryPath,
      fingerprint: candidate.fingerprint,
    }],
  }));
  return { handoff, handoffPath, manifestPath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('scenario-discovery standalone handoff helpers', () => {
  it('validates a complete handoff and builds only the approved package with executable flags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-handoff-helper-'));
    roots.push(root);
    const { handoff, handoffPath, manifestPath } = await fixture(root);
    const read = spawnSync(process.execPath, [
      join(scripts, 'read-handoff.mjs'),
      '--handoff',
      handoffPath,
    ], { encoding: 'utf8' });
    expect(read.status).toBe(0);
    expect(JSON.parse(read.stdout)).toMatchObject({
      format: 'skill-loom-discovery-handoff',
      candidates: [{ name: 'helper-skill' }],
    });

    const outputPath = join(root, 'approved.loom.json');
    const build = spawnSync(process.execPath, [
      join(scripts, 'build-from-handoff.mjs'),
      '--handoff',
      handoffPath,
      '--manifest',
      manifestPath,
      '--out',
      outputPath,
    ], { encoding: 'utf8' });
    expect(build.status).toBe(0);
    const bundle = parseBundle(JSON.parse(await readFile(outputPath, 'utf8')));
    expect(bundle.version).toBe(1);
    expect(bundle.skills).toHaveLength(1);
    expect(bundle.skills[0]?.files.find((file) => file.path === 'scripts/check.sh')).toMatchObject({
      executable: true,
      content: handoff.candidates[0]?.files[1]?.content,
    });

    const secondBuild = spawnSync(process.execPath, [
      join(scripts, 'build-from-handoff.mjs'),
      '--handoff',
      handoffPath,
      '--manifest',
      manifestPath,
      '--out',
      outputPath,
    ], { encoding: 'utf8' });
    expect(secondBuild.status).not.toBe(0);
    expect(parseBundle(JSON.parse(await readFile(outputPath, 'utf8'))).chain.name).toBe('Approved review');
  });

  it('rejects a path-traversing package name before exposing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-handoff-invalid-'));
    roots.push(root);
    const { handoffPath } = await fixture(root, '../outside');
    const read = spawnSync(process.execPath, [
      join(scripts, 'read-handoff.mjs'),
      '--handoff',
      handoffPath,
    ], { encoding: 'utf8' });
    expect(read.status).not.toBe(0);
    expect(read.stdout).toBe('');
    expect(read.stderr).toMatch(/unsafe|invalid|path/i);
  });

  it('refuses same-name candidates together but builds the explicitly selected identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-handoff-duplicates-'));
    roots.push(root);
    const { handoff, handoffPath, manifestPath } = await fixture(root);
    const first = handoff.candidates[0]!;
    const secondFiles = first.files.map((file) => file.path === 'SKILL.md'
      ? { ...file, content: Buffer.from('---\nname: helper-skill\ndescription: Second fixture.\n---\nReview the second.\n').toString('base64') }
      : file);
    const hash = createHash('sha256');
    for (const file of secondFiles) {
      hash.update(file.path).update('\0').update(file.executable ? 'x' : '-')
        .update('\0').update(Buffer.from(file.content, 'base64'));
    }
    const second = { ...first, repositoryPath: 'skills/second', fingerprint: hash.digest('hex'), files: secondFiles };
    const { fingerprint: _fingerprint, ...body } = handoff;
    const updated = { ...body, candidates: [first, second] };
    await writeFile(handoffPath, JSON.stringify({
      ...updated, fingerprint: createHash('sha256').update(JSON.stringify(updated)).digest('hex'),
    }));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      chain: unknown;
      candidates: Array<{ sourceId: string; revision: string; repositoryPath: string; fingerprint: string }>;
    };
    const identity = {
      sourceId: second.sourceId, revision: second.revision,
      repositoryPath: second.repositoryPath, fingerprint: second.fingerprint,
    };
    const outputPath = join(root, 'approved.loom.json');
    const build = () => spawnSync(process.execPath, [
      join(scripts, 'build-from-handoff.mjs'), '--handoff', handoffPath,
      '--manifest', manifestPath, '--out', outputPath,
    ], { encoding: 'utf8' });
    await writeFile(manifestPath, JSON.stringify({ ...manifest, candidates: [...manifest.candidates, identity] }));
    const ambiguous = build();
    expect(ambiguous.status).not.toBe(0);
    expect(ambiguous.stderr).toContain('ambiguous same-name package');
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(manifestPath, JSON.stringify({ ...manifest, candidates: [identity] }));
    expect(build().status).toBe(0);
    const bundle = parseBundle(JSON.parse(await readFile(outputPath, 'utf8')));
    expect(bundle.skills[0]?.files.find((file) => file.path === 'SKILL.md')?.content).toBe(secondFiles[0]!.content);
  });
});
