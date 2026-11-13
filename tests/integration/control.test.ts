import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { promisify } from 'node:util';
import { spawn as spawnPty } from 'node-pty';
import { describe, expect, it, vi } from 'vitest';
import { executePortableRequest } from '../../src/portable/runtime.js';
import { createConfigStore } from '../../src/server/config/store.js';
import { createCatalogService, createDefaultCatalogAdapters } from '../../src/server/catalog/merge.js';
import { attachControlTerminal, callControl, startControlServer, streamControlEvents } from '../../src/server/control.js';
import { runCli } from '../../src/server/cli.js';
import { startServer } from '../../src/server/index.js';
import { acquireProfileOwner } from '../../src/server/profile-owner.js';
import type { PreflightReport } from '../../src/server/preflight/engine.js';
import type { RunOrchestrator } from '../../src/server/runs/orchestrator.js';
import { CHAIN_VERSION, parseChain } from '../../src/server/chains/model.js';
import { createChainService } from '../../src/server/chains/service.js';
import { createRunRecord } from '../../src/server/runs/model.js';
import { createRunOwner } from '../../src/server/runs/owner.js';
import { createRunStore } from '../../src/server/runs/store.js';
import { createLoomServices } from '../../src/server/services.js';
import { createTerminalManager, TerminalSubscriberConflictError } from '../../src/server/terminal/pty.js';

describe.skipIf(process.platform === 'win32')('local control transport', () => {
  it('exports only exact reviewed catalog selections and rejects changed packages', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-selected-export-')));
    const project = join(root, 'project');
    const globalSkills = join(root, 'host-skills');
    const configDirectory = join(root, 'config');
    const selected = join(globalSkills, 'formatting');
    const unselected = join(globalSkills, 'private-helper');
    await mkdir(project);
    await mkdir(selected, { recursive: true });
    await mkdir(unselected, { recursive: true });
    await writeFile(join(selected, 'SKILL.md'), '---\nname: formatting\n---\nFormat safely.\n');
    await writeFile(join(selected, 'helper.mjs'), 'export {};\n');
    await writeFile(join(unselected, 'SKILL.md'), '---\nname: formatting\n---\nDo not export.\n');
    const config = createConfigStore({ env: { LOOM_CONFIG_DIR: configDirectory } });
    await config.update({});
    const services = createLoomServices({
      configStore: config,
      preflightEnv: { LOOM_CAPABILITY_INDEX: '0', LOOM_SKILLS_DIR: globalSkills },
    });
    const server = await startControlServer(config, { services });
    try {
      const opened = await callControl(configDirectory, 'project.open', { path: project });
      if (!opened.ok) throw new Error('Project registration failed.');
      const projectId = (opened.result as { project: { id: string } }).project.id;
      const page = await callControl(configDirectory, 'catalog.project.page', {
        projectId, harness: 'opencode', sources: ['personal'], offset: 0, limit: 50, warningsOffset: 0,
      });
      if (!page.ok) throw new Error('Catalog query failed.');
      const selectedEntry = (page.result as { entries: Array<{ id: string; name: string }> }).entries
        .find((entry) => entry.name === 'formatting');
      if (selectedEntry === undefined) throw new Error('Selected catalog entry was not discovered.');
      const review = await callControl(configDirectory, 'catalog.skill.review', {
        projectId, harness: 'opencode', candidate: { id: selectedEntry.id, source: 'personal' },
      });
      if (!review.ok) throw new Error('Catalog selection review failed.');
      const fingerprint = (review.result as { candidate: { fingerprint: string } }).candidate.fingerprint;

      const request = {
        projectId,
        harness: 'opencode',
        selections: [{ id: selectedEntry.id, fingerprint }],
      };
      let output = '';
      let error = '';
      const exportExitCode = await runCli(['catalog', 'skill', 'export', '--config-dir', configDirectory], {
        env: {},
        stdin: Readable.from([JSON.stringify(request)]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk) => { error += String(chunk); return true; } },
      });
      expect(exportExitCode, error).toBe(0);
      expect(error).toBe('');
      const exported = JSON.parse(output) as { ok: boolean; result: unknown };
      expect(exported).toMatchObject({
        ok: true,
        result: {
          format: 'skill-loom-project-skills', version: 2,
          skills: [{ id: selectedEntry.id, fingerprint, name: 'formatting', directory: 'formatting' }],
        },
      });
      expect(JSON.stringify(exported)).toContain(Buffer.from('---\nname: formatting\n---\nFormat safely.\n').toString('base64'));
      expect(JSON.stringify(exported)).not.toContain(Buffer.from('---\nname: formatting\n---\nDo not export.\n').toString('base64'));
      await expect(access(join(project, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });

      const added = join(globalSkills, 'added-after-query');
      await mkdir(added);
      await writeFile(join(added, 'SKILL.md'), '---\nname: added-after-query\n---\nVisible on refresh.\n');
      const refreshedPage = await callControl(configDirectory, 'catalog.project.page', {
        projectId, harness: 'opencode', query: 'added-after-query',
        sources: ['personal'], offset: 0, limit: 50, warningsOffset: 0,
      });
      expect(refreshedPage).toMatchObject({
        ok: true,
        result: { entries: [expect.objectContaining({ name: 'added-after-query' })] },
      });

      await writeFile(join(selected, 'helper.mjs'), 'changed after package review\n');
      expect(await callControl(configDirectory, 'catalog.skills.export', request))
        .toMatchObject({ ok: false, error: { code: 'SKILL_INSTALL_CANDIDATE_CHANGED' } });
      expect(await callControl(configDirectory, 'catalog.skills.export', {
        projectId, harness: 'opencode', selections: [{ id: 'opencode-personal-not-found', fingerprint }],
      })).toMatchObject({ ok: false, error: { code: 'SKILL_INSTALL_CANDIDATE_NOT_FOUND' } });
      expect(await callControl(configDirectory, 'catalog.skills.export', {
        projectId, projectPath: project, harness: 'opencode', selections: [{ id: selectedEntry.id, fingerprint }],
      })).toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies a shared chain’s global skills to the registered project without overwriting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-chain-apply-'));
    const project = join(root, 'project');
    const globalSkills = join(root, 'host', '.agents', 'skills');
    const configDirectory = join(root, 'config');
    const skillDirectory = join(globalSkills, 'formatting');
    await mkdir(project);
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      join(skillDirectory, 'SKILL.md'),
      '---\nname: formatting\ndescription: Format project files.\n---\n\nFormat carefully.\n',
    );
    const config = createConfigStore({ env: { LOOM_CONFIG_DIR: configDirectory } });
    await config.update({});
    const services = createLoomServices({
      configStore: config,
      preflightEnv: { LOOM_SKILLS_DIR: globalSkills },
    });
    const registration = await services.projectRegistry.openProject(project);
    const legacyChain = await createChainService().create(registration.canonicalPath, {
      name: 'Formatting chain',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [{ id: 'step-one', skillName: 'formatting', instruction: 'Format the changed files.' }],
      inputs: [],
    });
    const server = await startControlServer(config, { services });
    try {
      const opened = await callControl(configDirectory, 'project.open', { path: project });
      if (!opened.ok) throw new Error('Project registration failed.');
      const projectId = (opened.result as { project: { id: string } }).project.id;
      const request = { projectId, chainId: legacyChain.id };
      let output = '';
      let error = '';
      const exitCode = await runCli(['chain', 'project', 'apply', '--config-dir', configDirectory], {
        env: {},
        stdin: Readable.from([JSON.stringify(request)]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk) => { error += String(chunk); return true; } },
      });
      expect(exitCode, error).toBe(0);
      expect(error).toBe('');
      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        result: {
          projectId,
          installed: [{
            name: 'formatting',
            destinationPath: join(project, '.agents', 'skills', 'formatting'),
            fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          }],
        },
      });
      output = '';
      error = '';
      const exportExitCode = await runCli(['chain', 'project', 'export', '--config-dir', configDirectory], {
        env: {},
        stdin: Readable.from([JSON.stringify(request)]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk) => { error += String(chunk); return true; } },
      });
      expect(exportExitCode, error).toBe(0);
      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        result: {
          format: 'skill-loom-project-skills',
          version: 1,
          skills: [{ name: 'formatting', files: [{ path: 'SKILL.md' }] }],
        },
      });
      const installedPath = join(project, '.agents', 'skills', 'formatting', 'SKILL.md');
      expect(await readFile(installedPath, 'utf8')).toContain('Format carefully.');
      await expect(access(join(project, '.loom', 'chains', `${legacyChain.id}.json`))).resolves.toBeUndefined();
      await expect(access(join(configDirectory, 'chains', `${legacyChain.id}.json`))).resolves.toBeUndefined();

      const conflict = await callControl(configDirectory, 'chain.project.apply', request);
      expect(conflict).toMatchObject({ ok: false });
      expect(await readFile(installedPath, 'utf8')).toContain('Format carefully.');

      const missingChain = await services.chainService.create(registration.canonicalPath, {
        name: 'Missing skill chain',
        harness: 'opencode',
        sessionMode: 'shared',
        steps: [{ id: 'step-one', skillName: 'not-installed-globally', instruction: 'Continue.' }],
        inputs: [],
      });
      expect(await callControl(configDirectory, 'chain.project.apply', {
        projectId, chainId: missingChain.id,
      })).toMatchObject({
        ok: false,
        error: { code: 'SKILL_INSTALL_CANDIDATE_NOT_FOUND' },
      });
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reviews project coordination through the CLI without modifying run records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-coordination-review-'));
    const project = join(root, 'project');
    const configDirectory = join(root, 'config');
    await mkdir(project);
    const config = createConfigStore({ env: { LOOM_CONFIG_DIR: configDirectory } });
    await config.update({});
    const server = await startControlServer(config);
    try {
      const opened = await callControl(configDirectory, 'project.open', { path: project });
      if (!opened.ok) throw new Error('Project registration failed.');
      const projectId = (opened.result as { project: { id: string } }).project.id;
      expect(await callControl(configDirectory, 'run.list', { projectId }))
        .toEqual({ protocolVersion: 1, ok: true, result: { records: [] } });
      await expect(access(join(project, '.loom', 'project-claim.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
      const timestamp = '2026-01-01T00:00:00.000Z';
      const chain = parseChain({
        version: CHAIN_VERSION, id: 'chain-one', name: 'Test', harness: 'copilot', sessionMode: 'shared',
        steps: [{ id: 'one', kind: 'instruction', instruction: 'Review.' }],
        inputs: [], automaticPermissionOptIn: false, createdAt: timestamp, updatedAt: timestamp,
      });
      const run = createRunRecord({ id: 'run-test', projectId, chain, mode: 'supervised' });
      await createRunStore({ projectPath: project, configDirectory }).create(run);
      const runFile = join(project, '.loom', 'runs', 'run-test.json');
      const pointer = join(configDirectory, 'active-run.json');
      const originalRun = await readFile(runFile, 'utf8');
      const originalPointer = await readFile(pointer, 'utf8');
      let output = '';
      let error = '';
      expect(await runCli(['run', 'list', '--config-dir', configDirectory], {
        env: {}, stdin: Readable.from([JSON.stringify({ projectId })]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk) => { error += String(chunk); return true; } },
      })).toBe(0);
      expect(error).toBe('');
      expect(JSON.parse(output)).toMatchObject({
        ok: true, result: { records: [{
          kind: 'managed', runId: run.id, status: 'starting', unresolved: true,
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        }] },
      });
      expect(output).not.toContain('Review.');
      expect(await readFile(runFile, 'utf8')).toBe(originalRun);
      expect(await readFile(pointer, 'utf8')).toBe(originalPointer);
      await expect(access(join(project, '.loom', 'project-claim.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await callControl(configDirectory, 'run.list', { projectId: 'not-registered' }))
        .toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });
      expect(await callControl(configDirectory, 'run.list', { projectId, extra: true }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      output = '';
      expect(await runCli(['project', 'coordination-review', '--config-dir', configDirectory], {
        env: {}, stdin: Readable.from([JSON.stringify({ projectId })]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk) => { error += String(chunk); return true; } },
      })).toBe(0);
      expect(error).toBe('');
      expect(JSON.parse(output)).toMatchObject({
        ok: true, result: {
          executionCoordinated: false,
          review: {
            protocol: null, claim: null, reviewDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
            records: [{ kind: 'managed', runId: run.id, status: 'starting', unresolved: true }],
          },
        },
      });
      expect(await readFile(runFile, 'utf8')).toBe(originalRun);
      expect(await readFile(pointer, 'utf8')).toBe(originalPointer);
      expect(await callControl(configDirectory, 'project.coordination.review', { projectId: 'not-registered' }))
        .toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });
      expect(await callControl(configDirectory, 'project.coordination.review', { projectId, extra: true }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      await writeFile(runFile, '{broken');
      expect(await callControl(configDirectory, 'run.list', { projectId }))
        .toMatchObject({ ok: false, error: { code: 'PROJECT_RUN_RECORDS_UNSAFE' } });
      expect(await callControl(configDirectory, 'project.coordination.review', { projectId }))
        .toMatchObject({ ok: false, error: { code: 'PROJECT_RUN_RECORDS_UNSAFE' } });
      expect(await readFile(runFile, 'utf8')).toBe('{broken');
      await rename(join(project, '.loom'), join(root, 'held-loom'));
      await symlink(join(root, 'held-loom'), join(project, '.loom'));
      expect(await callControl(configDirectory, 'run.list', { projectId }))
        .toMatchObject({ ok: false, error: { code: 'PROJECT_RUN_RECORDS_UNSAFE' } });
      await unlink(join(project, '.loom'));
      await rename(join(root, 'held-loom'), join(project, '.loom'));
      await rm(project, { recursive: true });
      expect(await callControl(configDirectory, 'run.list', { projectId }))
        .toMatchObject({ ok: false, error: { code: 'PROJECT_RUN_RECORDS_UNSAFE' } });
      expect(await callControl(configDirectory, 'project.coordination.review', { projectId }))
        .toMatchObject({ ok: false, error: { code: 'PROJECT_CLAIM_UNSAFE' } });
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serves ranked capability-index entries from the host-global catalog', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-capability-page-')));
    const project = join(root, 'project');
    const configDirectory = join(root, 'config');
    const home = join(root, 'home');
    const globalSkillsDirectory = join(home, '.agents', 'skills');
    const skill = join(globalSkillsDirectory, 'body-only-review');
    await mkdir(skill, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), [
      '---',
      'name: body-only-review',
      'description: Review a generic helper.',
      'allowed-tools: Read Grep',
      'inputs: [release_manifest]',
      'metadata:',
      '  tags: [review, release]',
      '---',
      '',
      '## Attestation bundle',
      '',
      'Verify the attestation bundle and record the pinned revision.',
      '',
    ].join('\n'));
    const config = createConfigStore({ env: { LOOM_CONFIG_DIR: configDirectory } });
    await config.update({});
    await mkdir(project, { recursive: true });
    const services = createLoomServices({
      configStore: config,
      preflightEnv: { LOOM_CAPABILITY_INDEX: '1', LOOM_SKILLS_DIR: globalSkillsDirectory },
      preflightHomeDirectory: home,
    });
    const server = await startControlServer(config, { services });
    try {
      // The first capability query builds the index and truthfully reports the
      // scan fallback; later queries use the indexed path.
      await services.capabilitySearchService.search({
        harness: 'opencode', projectPath: project, query: 'warm', offset: 0, limit: 1,
      });
      const opened = await callControl(configDirectory, 'project.open', { path: project });
      if (!opened.ok) throw new Error('Project registration failed.');
      const projectId = (opened.result as { project: { id: string } }).project.id;
      const response = await callControl(configDirectory, 'catalog.project.page', {
        projectId, harness: 'opencode', query: 'attestation bundle',
        sources: ['personal'], tags: ['release'], tools: ['grep'], inputs: ['release_manifest'],
        hasTools: true,
      });
      expect(response).toMatchObject({
        ok: true,
        result: {
          retrieval: { mode: 'index', ranking: 'fts5' },
          metadataCoverage: {
            total: 1, withTags: 1, withTools: 1, withInputs: 1, withoutStructuredMetadata: 0,
          },
          metadataFacets: {
            tags: [{ value: 'release', count: 1 }, { value: 'review', count: 1 }],
            tools: [{ value: 'Grep', count: 1 }, { value: 'Read', count: 1 }],
            inputs: [{ value: 'release_manifest', count: 1 }],
            outputs: [],
          },
          entries: [{
            name: 'body-only-review',
            source: 'personal',
            fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
            metadata: {
              tags: ['review', 'release'],
              tools: ['Read', 'Grep'],
              inputs: ['release_manifest'],
              outputs: [],
            },
            match: {
              score: expect.any(Number),
              snippet: expect.stringContaining('attestation'),
            },
          }],
        },
      });
    } finally {
      await server.close();
      await services.capabilitySearchService.dispose({ deleteIndex: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reviews and installs a host-global catalog skill into the shared project root', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-skill-install-')));
    const project = join(root, 'project');
    const configDirectory = join(root, 'config');
    const home = join(root, 'home');
    const globalSkillsDirectory = join(root, 'global-skills');
    const packagePath = join(globalSkillsDirectory, 'note-writer');
    await mkdir(project, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(packagePath, { recursive: true });
    await writeFile(
      join(packagePath, 'SKILL.md'),
      '---\nname: note-writer\ndescription: Writes review notes.\n---\n\nWrite review notes.\n',
    );
    const config = createConfigStore({ env: { LOOM_CONFIG_DIR: configDirectory } });
    await config.update({});
    const services = createLoomServices({
      configStore: config,
      preflightEnv: {
        LOOM_CAPABILITY_INDEX: '1',
        LOOM_SKILLS_DIR: globalSkillsDirectory,
      },
      preflightHomeDirectory: home,
    });
    const server = await startControlServer(config, { services });
    try {
      const opened = await callControl(configDirectory, 'project.open', { path: project });
      if (!opened.ok) throw new Error('Project registration failed.');
      const projectId = (opened.result as { project: { id: string } }).project.id;
      const page = await callControl(configDirectory, 'catalog.project.page', {
        projectId, harness: 'opencode', query: 'note-writer', sources: ['personal'], limit: 10,
      });
      if (!page.ok) throw new Error('Catalog page failed.');
      const entries = (page.result as {
        entries: Array<{ id: string; source: string; name: string; fingerprint: string }>;
      }).entries;
      expect(entries).toHaveLength(1);
      const found = entries[0]!;
      const candidate = {
        id: found.id,
        source: found.source,
        ...(/^[a-f0-9]{64}$/.test(found.fingerprint) ? { fingerprint: found.fingerprint } : {}),
      };
      const request = { projectId, harness: 'opencode', candidate };
      const review = await callControl(configDirectory, 'catalog.skill.review', request);
      expect(review).toMatchObject({
        ok: true,
        result: {
          destination: {
            path: join(project, '.agents', 'skills', 'note-writer'),
            conflict: null,
          },
          candidate: { name: 'note-writer', source: 'personal' },
          totalFiles: 1,
          reviewDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      const reviewDigest = (review as { result: { reviewDigest: string } }).result.reviewDigest;

      expect(await callControl(configDirectory, 'catalog.skill.install', {
        ...request, reviewDigest,
      })).toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(configDirectory, 'catalog.skill.install', {
        ...request, reviewDigest: 'a'.repeat(64), confirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'SKILL_INSTALL_REVIEW_STALE' } });

      const installed = await callControl(configDirectory, 'catalog.skill.install', {
        ...request, reviewDigest, confirmed: true,
      });
      expect(installed).toMatchObject({
        ok: true,
        result: {
          name: 'note-writer',
          source: 'personal',
          destinationPath: join(project, '.agents', 'skills', 'note-writer'),
          totalFiles: 1,
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(await readFile(join(project, '.agents', 'skills', 'note-writer', 'SKILL.md'), 'utf8'))
        .toContain('Write review notes.');

      const conflict = await callControl(configDirectory, 'catalog.skill.review', request);
      expect(conflict).toMatchObject({ ok: true, result: { destination: { conflict: 'EXISTS' } } });

      let output = '';
      let error = '';
      expect(await runCli(['catalog', 'skill', 'review', '--config-dir', configDirectory], {
        env: {},
        stdin: Readable.from([JSON.stringify(request)]),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk) => { error += String(chunk); return true; } },
      })).toBe(0);
      expect(error).toBe('');
      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        result: { destination: { conflict: 'EXISTS' }, reviewDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
    } finally {
      await server.close();
      await services.capabilitySearchService.dispose({ deleteIndex: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses startup without deleting a corrupt active-run pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-corrupt-active-pointer-'));
    try {
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
      await store.update({});
      const pointer = join(root, 'active-run.json');
      await writeFile(pointer, '{"version":1', 'utf8');
      await expect(startServer({
        host: '127.0.0.1', port: 7373, serveStatic: false, configStore: store,
      })).rejects.toMatchObject({ code: 'RUN_ACTIVE_POINTER_CORRUPT' });
      expect(await readFile(pointer, 'utf8')).toBe('{"version":1');
      const owner = await acquireProfileOwner(root);
      owner.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses startup when the active pointer references a corrupt run record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-corrupt-active-run-'));
    try {
      const store = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
      await store.update({});
      const project = join(root, 'project');
      await mkdir(project);
      const timestamp = '2026-01-01T00:00:00.000Z';
      const chain = parseChain({
        version: CHAIN_VERSION, id: 'chain-one', name: 'Test', harness: 'copilot', sessionMode: 'shared',
        steps: [{ id: 'one', kind: 'instruction', instruction: 'Review.' }],
        inputs: [], automaticPermissionOptIn: false, createdAt: timestamp, updatedAt: timestamp,
      });
      const run = createRunRecord({ id: 'run-test', projectId: 'project-test', chain, mode: 'supervised' });
      await createRunStore({ projectPath: project, configDirectory: root }).create(run);
      const pointer = join(root, 'active-run.json');
      const pointerBefore = await readFile(pointer, 'utf8');
      const record = join(project, '.loom', 'runs', 'run-test.json');
      await writeFile(record, '{"version":1', 'utf8');
      await expect(startServer({
        host: '127.0.0.1', port: 7373, serveStatic: false, configStore: store,
      })).rejects.toMatchObject({ code: 'RUN_FILE_CORRUPT' });
      expect(await readFile(pointer, 'utf8')).toBe(pointerBefore);
      expect(await readFile(record, 'utf8')).toBe('{"version":1');
      const owner = await acquireProfileOwner(root);
      owner.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps control available to retry a failed run-owner shutdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-control-stop-retry-'));
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
    await store.update({});
    const reservation = createServer();
    await new Promise<void>((ready, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', ready);
    });
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((done, reject) => reservation.close((error) => error ? reject(error) : done()));
    const orchestrator: RunOrchestrator = {
      createRun: vi.fn(), getRun: vi.fn(), getRunView: vi.fn(),
      getActiveRun: vi.fn().mockResolvedValue({ active: false }), hasLiveProject: vi.fn().mockReturnValue(false),
      applyAction: vi.fn(), subscribe: vi.fn(), recoverOnStartup: vi.fn(),
      shutdown: vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValue(undefined),
    };
    const previousExitCode = process.exitCode;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const started = await startServer({
      host: '127.0.0.1', port, serveStatic: false, configStore: store,
      runOrchestrator: orchestrator, runRecoverOnStartup: false,
    });
    try {
      await started.app.loomRunOwner.get();
      expect(await callControl(root, 'service.stop', {})).toMatchObject({ ok: true });
      await vi.waitFor(() => expect(started.app.loomLifecycle.state).toBe('failed'));
      expect(await callControl(root, 'status', {})).toMatchObject({ ok: true, result: { state: 'failed' } });
      expect(await callControl(root, 'service.stop', {})).toMatchObject({ ok: true });
      await vi.waitFor(() => expect(started.app.loomLifecycle.state).toBe('stopped'));
      expect(orchestrator.shutdown).toHaveBeenCalledTimes(2);
      const owner = await acquireProfileOwner(root);
      owner.release();
    } finally {
      await started.stop().catch(() => undefined);
      process.exitCode = previousExitCode;
      log.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('attaches a TTY to the shared run terminal and detaches without ending the process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-control-terminal-'));
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
    await store.update({});
    const manager = createTerminalManager();
    const session = manager.createSession({
      executable: process.execPath,
      args: ['-e', `
        process.stdin.setRawMode(true);
        process.stdin.on('data', (data) => process.stdout.write('ECHO:' + data));
        process.stdout.write('HARNESS_READY\\r\\n');
      `],
    }, { id: 'loom_run_test' });
    const orchestrator: RunOrchestrator = {
      createRun: vi.fn(), getRun: vi.fn(),
      getRunView: vi.fn().mockResolvedValue({ terminalId: session.id }),
      getActiveRun: vi.fn(), hasLiveProject: vi.fn().mockReturnValue(false), applyAction: vi.fn(), subscribe: vi.fn(),
      recoverOnStartup: vi.fn(), shutdown: vi.fn(),
    };
    const owner = createRunOwner({
      configStore: store, terminalManager: manager, runOrchestrator: orchestrator,
      runRecoverOnStartup: false,
    });
    const server = await startControlServer(store, { runOwner: owner, terminalManager: manager });
    class FakeTty extends PassThrough {
      isTTY = true;
      isRaw = false;
      setRawMode(value: boolean) { this.isRaw = value; return this; }
    }
    try {
      await expect(attachControlTerminal(root, 'run-test', Readable.from([]), {
        isTTY: false, write: () => true,
      })).rejects.toMatchObject({ code: 'TERMINAL_TTY_REQUIRED' });
      const input = new FakeTty();
      let output = '';
      const attached = attachControlTerminal(root, 'run-test', input, {
        isTTY: true, columns: 70, rows: 20,
        write: (chunk) => { output += String(chunk); return true; },
      });
      await vi.waitFor(() => expect(output).toContain('HARNESS_READY'), { timeout: 10_000 });
      expect(input.isRaw).toBe(true);
      expect(() => manager.attach(session.id, { send() {}, close() {} }))
        .toThrow(TerminalSubscriberConflictError);
      const competing = new FakeTty();
      await expect(attachControlTerminal(root, 'run-test', competing, {
        isTTY: true, write: () => true,
      })).rejects.toMatchObject({ code: 'TERMINAL_SUBSCRIBER_CONFLICT' });
      expect(competing.isRaw).toBe(false);
      await vi.waitFor(() => expect([session.cols, session.rows]).toEqual([70, 20]));
      input.write('hello');
      await vi.waitFor(() => expect(output).toContain('ECHO:hello'));
      input.write(Buffer.from([0x1d]));
      await attached;
      expect(input.isRaw).toBe(false);
      expect(session.isRunning()).toBe(true);
      await vi.waitFor(() => {
        const next = manager.attach(session.id, { send() {}, close() {} });
        next.detach();
      });
      const cli = spawnPty(process.execPath, [
        '--import', 'tsx', 'src/server/cli.ts', 'run', 'attach', '--run', 'run-test', '--config-dir', root,
      ], { cwd: process.cwd(), name: 'xterm-256color', cols: 80, rows: 25, env: process.env });
      let cliOutput = '';
      let cliExited = false;
      const exit = new Promise<number>((resolveExit) => {
        cli.onExit(({ exitCode }) => { cliExited = true; resolveExit(exitCode); });
      });
      cli.onData((chunk) => { cliOutput += chunk; });
      try {
        await vi.waitFor(() => expect(cliOutput).toContain('HARNESS_READY'), { timeout: 10_000 });
        cli.write('from-cli');
        await vi.waitFor(() => expect(cliOutput).toContain('ECHO:from-cli'));
        cli.resize(100, 30);
        await vi.waitFor(() => expect([session.cols, session.rows]).toEqual([100, 30]));
        cli.write('\x1d');
        expect(await exit).toBe(0);
        expect(session.isRunning()).toBe(true);
      } finally {
        if (!cliExited) cli.kill();
      }
    } finally {
      await server.close();
      await owner.shutdown();
      await manager.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('streams snapshots and state events without terminal output, and unsubscribes on disconnect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-control-events-'));
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
    await store.update({});
    const timestamp = '2026-01-01T00:00:00.000Z';
    const chain = parseChain({
      version: CHAIN_VERSION, id: 'chain-one', name: 'Test', harness: 'copilot', sessionMode: 'shared',
      steps: [{ id: 'one', kind: 'instruction', instruction: 'Review.' }],
      inputs: [], automaticPermissionOptIn: false, createdAt: timestamp, updatedAt: timestamp,
    });
    const run = createRunRecord({ id: 'run-test', projectId: 'project-test', chain, mode: 'supervised' });
    const actions = {
      next: false, retry: false, skip: false, abort: true, pause: false, resume: false,
      runNext: false, done: true, failed: true, continue: false, restart: false,
    };
    const unsubscribe = vi.fn();
    const subscribe: RunOrchestrator['subscribe'] = async (id, listener) => {
      listener({ type: 'snapshot', runId: id, sequence: 0, run, terminalId: null, actions, recovery: null });
      listener({
        type: 'output', runId: id, sequence: 1, run, terminalId: null, actions,
        stepIndex: 0, stepId: 'one', chunk: 'terminal-secret-marker',
      });
      listener({
        type: 'step-started', runId: id, sequence: 2, run, terminalId: null, actions,
        stepIndex: 0, stepId: 'one',
      });
      return unsubscribe;
    };
    const orchestrator: RunOrchestrator = {
      createRun: vi.fn(), getRun: vi.fn(), getRunView: vi.fn(), getActiveRun: vi.fn(), hasLiveProject: vi.fn().mockReturnValue(false),
      applyAction: vi.fn(), subscribe, recoverOnStartup: vi.fn(), shutdown: vi.fn(),
    };
    const owner = createRunOwner({
      configStore: store, terminalManager: createTerminalManager(),
      runOrchestrator: orchestrator, runRecoverOnStartup: false,
    });
    const server = await startControlServer(store, { runOwner: owner });
    try {
      const received: unknown[] = [];
      const abort = new AbortController();
      const stream = streamControlEvents(root, 'run-test', (event) => {
        received.push(event);
        if (received.length === 2) abort.abort();
        return true;
      }, abort.signal);
      await stream;
      expect(received).toMatchObject([
        { ok: true, event: { type: 'snapshot', sequence: 0, runId: 'run-test' } },
        { ok: true, event: { type: 'step-started', sequence: 2, runId: 'run-test' } },
      ]);
      expect(JSON.stringify(received)).not.toContain('terminal-secret-marker');
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
      await expect(streamControlEvents(root, 'run-test', () => false))
        .rejects.toMatchObject({ code: 'CONTROL_STREAM_BACKPRESSURE' });
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(2));

      const child = spawn(process.execPath, [
        '--import', 'tsx', 'src/server/cli.ts', 'run', 'events', '--config-dir', root,
      ], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stdin.end(JSON.stringify({ runId: 'run-test' }));
      try {
        await vi.waitFor(() => expect(output.trim().split('\n')).toHaveLength(2), { timeout: 10_000 });
        expect(output).not.toContain('terminal-secret-marker');
        expect(JSON.parse(output.split('\n')[0]!)).toMatchObject({ event: { type: 'snapshot' } });
      } finally {
        if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
          process.kill(child.pid, 'SIGINT');
        }
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise<void>((done) => child.once('close', () => done()));
        }
      }
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(3));

      let receivedShutdownSnapshot = false;
      const interrupted = streamControlEvents(root, 'run-test', () => {
        receivedShutdownSnapshot = true;
        return true;
      });
      const rejection = expect(interrupted).rejects.toMatchObject({ code: 'CONTROL_UNAVAILABLE' });
      await vi.waitFor(() => expect(receivedShutdownSnapshot).toBe(true));
      await server.close();
      await rejection;
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(4));
    } finally {
      await server.close();
      await owner.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not listen after failed startup recovery and releases ownership after cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-recovery-failure-'));
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
    await store.update({});
    const reservation = createServer();
    await new Promise<void>((ready, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', ready);
    });
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((done, reject) => reservation.close((error) => error ? reject(error) : done()));
    const recovery = vi.fn().mockRejectedValue(new Error('recovery failed'));
    const orchestrator: RunOrchestrator = {
      createRun: vi.fn(), getRun: vi.fn(), getRunView: vi.fn(), getActiveRun: vi.fn(), hasLiveProject: vi.fn().mockReturnValue(false),
      applyAction: vi.fn(), subscribe: vi.fn(), recoverOnStartup: recovery, shutdown: vi.fn(),
    };
    try {
      await expect(startServer({
        host: '127.0.0.1', port, serveStatic: false, configStore: store, runOrchestrator: orchestrator,
      })).rejects.toThrow('recovery failed');
      expect(recovery).toHaveBeenCalled();
      const owner = await acquireProfileOwner(root);
      owner.release();
      const probe = createServer();
      await new Promise<void>((ready, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', ready);
      });
      await new Promise<void>((done, reject) => probe.close((error) => error ? reject(error) : done()));
      expect(await readdir(root)).not.toContain('control.json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains the profile lock when startup recovery and cleanup both fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-recovery-cleanup-failure-'));
    try {
      await createConfigStore({ env: { LOOM_CONFIG_DIR: root } }).update({});
      const script = `
        import { startServer } from './src/server/index.ts';
        import { acquireProfileOwner } from './src/server/profile-owner.ts';
        const orchestrator = {
          async recoverOnStartup() { throw new Error('recovery failed'); },
          async shutdown() { throw new Error('cleanup failed'); },
        };
        let startup;
        try {
          await startServer({ host: '127.0.0.1', port: 7373, serveStatic: false,
            env: { ...process.env, LOOM_CONFIG_DIR: process.argv[1] }, runOrchestrator: orchestrator });
          startup = 'unexpected-success';
        } catch (error) {
          const messages = (item) => item instanceof AggregateError
            ? item.errors.flatMap(messages) : [item.message];
          startup = messages(error);
        }
        let lock;
        try {
          const owner = await acquireProfileOwner(process.argv[1]);
          owner.release();
          lock = 'unexpected-success';
        } catch (error) {
          lock = error.code;
        }
        process.stdout.write(JSON.stringify({ startup, lock }) + '\\n');
      `;
      const { stdout } = await promisify(execFile)(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e', script, root,
      ], { cwd: process.cwd(), timeout: 15_000 });
      expect(JSON.parse(stdout)).toEqual({ startup: ['recovery failed', 'cleanup failed'], lock: 'PROFILE_IN_USE' });
      const owner = await acquireProfileOwner(root);
      owner.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows exactly one of two separate production owners to start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-owner-race-'));
    await createConfigStore({ env: { LOOM_CONFIG_DIR: root } }).update({});
    const reservation = createServer();
    await new Promise<void>((ready, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', ready);
    });
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((done, reject) => reservation.close((error) => error ? reject(error) : done()));
    const script = `
      import { startServer } from './src/server/index.ts';
      import { appendFile } from 'node:fs/promises';
      const orchestrator = {
        async recoverOnStartup() {
          await appendFile(process.argv[1] + '/recoveries', 'recovered\\n');
          return { interrupted: [], clearedActiveRun: false, warnings: [], projects: [] };
        },
        async getActiveRun() { return { active: false }; },
        async shutdown() {},
      };
      try {
        await startServer({ host: '127.0.0.1', port: Number(process.argv[2]), serveStatic: false,
          env: { ...process.env, LOOM_CONFIG_DIR: process.argv[1] }, runOrchestrator: orchestrator });
        process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
      } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, code: error.code }) + '\\n');
      }
    `;
    const children = [0, 1].map(() => spawn(process.execPath, [
      '--import', 'tsx', '--input-type=module', '-e', script, root, String(port),
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }));
    try {
      const results = await Promise.all(children.map((child) => new Promise<{ ok: boolean; code?: string }>((done, reject) => {
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const end = output.indexOf('\n');
          if (end >= 0) {
            try { done(JSON.parse(output.slice(0, end)) as { ok: boolean; code?: string }); }
            catch (error) { reject(error); }
          }
        });
        child.once('error', reject);
        child.once('close', () => { if (!output.includes('\n')) reject(new Error('Owner exited before reporting startup.')); });
      })));
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: 'PROFILE_IN_USE' }]);
      expect(await readFile(join(root, 'recoveries'), 'utf8')).toBe('recovered\n');
      expect(await callControl(root, 'status', {})).toMatchObject({ ok: true });
      expect(await callControl(root, 'service.stop', {})).toMatchObject({ ok: true });
      await Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((done) => child.once('close', () => done()))));
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) process.kill(child.pid, 'SIGKILL');
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('shares profile updates between the CLI and the running UI owner', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-control-app-')));
    const globalSkillsDirectory = join(root, 'global-skills');
    const configStore = createConfigStore({ env: { LOOM_CONFIG_DIR: root }, homeDirectory: () => join(root, 'home') });
    const copilotRunner = vi.fn(async ({ cwd }: { cwd: string }) => {
      const skillsRoot = join(cwd, '.agents', 'skills');
      let directories: Dirent[];
      try {
        directories = await readdir(skillsRoot, { withFileTypes: true });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        directories = [];
      }
      const skills = [];
      for (const entry of directories) {
        if (!entry.isDirectory()) continue;
        const path = join(skillsRoot, entry.name);
        try {
          await access(join(path, 'SKILL.md'));
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
          throw error;
        }
        skills.push({ name: entry.name, path, source: 'project', enabled: true });
      }
      return { exitCode: 0, stdout: JSON.stringify(skills), stderr: '', timedOut: false };
    });
    const reservation = createServer();
    await new Promise<void>((ready, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', ready);
    });
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((done, reject) => reservation.close((error) => error ? reject(error) : done()));
    const started = await startServer({
      host: '127.0.0.1', port, serveStatic: false,
      env: { ...process.env, LOOM_CONFIG_DIR: root, LOOM_CAPABILITY_INDEX: '0' },
      configStore,
      catalogService: createCatalogService({
        configStore,
        globalSkillsDirectory: () => globalSkillsDirectory,
        adapters: createDefaultCatalogAdapters({ homeDirectory: join(root, 'home'), copilotRunner }),
      }),
      runRecoverOnStartup: false,
    });
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [
        '--import', 'tsx', 'src/server/cli.ts', 'service', 'status', '--config-dir', root,
      ], { cwd: process.cwd() });
      expect(JSON.parse(stdout)).toMatchObject({ ok: true, result: { state: 'running' } });
      let output = '';
      let error = '';
      const code = await runCli(['catalog', 'source', 'add', '--config-dir', root], {
        env: {},
        stdin: Readable.from(['{"repository":"https://example.invalid/shared.git"}']),
        stdout: { write: (chunk) => { output += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk) => { error += String(chunk); return true; } },
      });
      expect(code).toBe(0);
      expect(error).toBe('');
      expect(JSON.parse(output)).toMatchObject({ ok: true, result: { source: { repository: 'https://example.invalid/shared.git' } } });
      expect((await configStore.get()).remoteSkillSources).toMatchObject([
        { repository: 'https://example.invalid/shared.git' },
      ]);
      const addFromProcess = (repository: string) => new Promise<{ code: number | null; stdout: string }>((done, reject) => {
        const child = spawn(process.execPath, [
          '--import', 'tsx', 'src/server/cli.ts', 'catalog', 'source', 'add', '--config-dir', root,
        ], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.once('error', reject);
        child.once('close', (code) => done({ code, stdout }));
        child.stdin.end(JSON.stringify({ repository }));
      });
      const concurrent = await Promise.all([
        addFromProcess('https://example.invalid/a.git'),
        addFromProcess('https://example.invalid/b.git'),
      ]);
      for (const result of concurrent) {
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
      }
      expect((await configStore.get()).remoteSkillSources.map((source) => source.repository).sort()).toEqual([
        'https://example.invalid/a.git', 'https://example.invalid/b.git', 'https://example.invalid/shared.git',
      ]);
      const project = join(root, 'project');
      await mkdir(project);
      const opened = await callControl(root, 'project.open', { path: project });
      expect(opened).toMatchObject({
        ok: true, result: { project: { canonicalPath: project } },
      });
      if (!opened.ok) throw new Error('Project registration failed.');
      const projectId = (opened.result as { project: { id: string } }).project.id;
      const localSkill = join(globalSkillsDirectory, 'local-review');
      await mkdir(localSkill, { recursive: true });
      await writeFile(join(localSkill, 'SKILL.md'), '---\nname: local-review\ndescription: Local review\n---\nReview locally.\n');
      const secondSkill = join(globalSkillsDirectory, 'local-review-two');
      await mkdir(secondSkill, { recursive: true });
      await writeFile(join(secondSkill, 'SKILL.md'), '---\nname: local-review-two\ndescription: Local review\n---\nReview locally.\n');
      let catalogOutput = '';
      expect(await runCli(['catalog', 'project', 'page', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify({ projectId, harness: 'opencode', query: 'local-review', limit: 1 })]),
        stdout: { write: (chunk) => { catalogOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      expect(JSON.parse(catalogOutput)).toMatchObject({
        ok: true, result: {
          total: 2, entries: [{ name: 'local-review', source: 'personal' }],
          nextOffset: 1, snapshotId: expect.any(String),
        },
      });
      const snapshotId = (JSON.parse(catalogOutput) as { result: { snapshotId: string } }).result.snapshotId;
      await rm(join(secondSkill, 'SKILL.md'));
      expect(await callControl(root, 'catalog.project.page', {
        projectId, harness: 'opencode', query: 'local-review', limit: 1, offset: 1, snapshotId,
      })).toMatchObject({
        ok: true, result: { total: 2, entries: [{ name: 'local-review-two' }], nextOffset: null },
      });
      expect(await callControl(root, 'catalog.project.page', {
        projectId, harness: 'opencode', query: 'different', snapshotId,
      })).toMatchObject({ ok: false, error: { code: 'CATALOG_PAGE_MISMATCH' } });
      expect(await callControl(root, 'catalog.project.page', {
        projectId, harness: 'opencode', query: 'local-review',
      })).toMatchObject({ ok: true, result: { total: 1 } });
      const draft = {
        name: 'CLI workflow', harness: 'copilot', sessionMode: 'shared',
        steps: [{ id: 'one', kind: 'instruction', instruction: 'Review the task.' }],
        inputs: [],
      };
      let draftOutput = '';
      expect(await runCli(['chain', 'draft', 'validate', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify(draft)]),
        stdout: { write: (chunk) => { draftOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      expect(JSON.parse(draftOutput)).toMatchObject({ ok: true, result: { valid: true } });
      draftOutput = '';
      expect(await runCli(['chain', 'draft', 'create', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify(draft)]),
        stdout: { write: (chunk) => { draftOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      const created = JSON.parse(draftOutput) as { result: { chain: { id: string } } };
      const uiDraft = await started.app.inject(`/api/drafts/${created.result.chain.id}`);
      expect(uiDraft.json()).toMatchObject({ chain: { name: 'CLI workflow' } });
      const bundlePath = join(root, 'workflow.loom.json');
      let bundleOutput = '';
      let bundleError = '';
      const bundleStreams = {
        env: {},
        stdout: { write: (chunk: string | Uint8Array) => { bundleOutput += String(chunk); return true; }, isTTY: false },
        stderr: { write: (chunk: string | Uint8Array) => { bundleError += String(chunk); return true; } },
      };
      const bundleArgs = ['bundle', 'create', '--draft', created.result.chain.id, '--output', bundlePath, '--config-dir', root];
      expect(await runCli(bundleArgs, bundleStreams)).toBe(0);
      expect(JSON.parse(bundleOutput)).toMatchObject({ ok: true, result: { path: bundlePath, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) } });
      const bundleBytes = await readFile(bundlePath, 'utf8');
      expect(JSON.parse(bundleBytes)).toMatchObject({ format: 'skill-loom-chain', chain: { name: 'CLI workflow' } });
      expect(await runCli(bundleArgs, bundleStreams)).toBe(1);
      expect(JSON.parse(bundleError)).toMatchObject({ ok: false, error: { code: 'BUNDLE_CONFLICT' } });
      expect(await readFile(bundlePath, 'utf8')).toBe(bundleBytes);
      let reviewOutput = '';
      const reviewInput = { projectId, bundlePath };
      expect(await runCli(['bundle', 'review', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify(reviewInput)]),
        stdout: { write: (chunk) => { reviewOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      const review = JSON.parse(reviewOutput) as { result: { reviewDigest: string; evidence: { bundleFingerprint: string } } };
      expect(review.result.evidence.bundleFingerprint).toBe(JSON.parse(bundleOutput).result.fingerprint);
      const importInput = { ...reviewInput, reviewDigest: review.result.reviewDigest, confirmed: true };
      expect(await callControl(root, 'bundle.import', { ...importInput, confirmed: false }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      const altered = JSON.parse(bundleBytes) as { chain: { name: string } };
      altered.chain.name = 'Changed after review';
      await writeFile(bundlePath, JSON.stringify(altered));
      expect(await callControl(root, 'bundle.import', importInput))
        .toMatchObject({ ok: false, error: { code: 'BUNDLE_CONFLICT' } });
      await writeFile(bundlePath, bundleBytes);
      let importedOutput = '';
      expect(await runCli(['bundle', 'import', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify(importInput)]),
        stdout: { write: (chunk) => { importedOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      const imported = JSON.parse(importedOutput) as { result: { chain: { id: string; name: string } } };
      expect(imported).toMatchObject({ ok: true, result: { chain: { name: 'CLI workflow copy' } } });
      const projectChains = await started.app.inject(`/api/projects/${projectId}/chains`);
      expect(projectChains.json()).toMatchObject({ chains: [{ name: 'CLI workflow copy' }] });
      const uiCreated = await started.app.inject({
        method: 'POST', url: `/api/projects/${projectId}/chains`,
        payload: { ...draft, name: 'Created in UI' },
      });
      expect(uiCreated.statusCode).toBe(201);
      const uiChain = uiCreated.json<{ chain: { id: string; name: string } }>().chain;
      const skillChainResponse = await started.app.inject({
        method: 'POST', url: `/api/projects/${projectId}/chains`,
        payload: { ...draft, name: 'Project skill workflow',
          steps: [{ id: 'one', skillName: 'local-review', instruction: 'Review locally.' }] },
      });
      expect(skillChainResponse.statusCode).toBe(201);
      const skillChainId = skillChainResponse.json<{ chain: { id: string } }>().chain.id;
      const projectBundlePath = join(root, 'project-workflow.loom.json');
      let projectBundleOutput = '';
      expect(await runCli([
        'bundle', 'create', '--project', projectId, '--chain', skillChainId,
        '--output', projectBundlePath, '--config-dir', root,
      ], {
        env: {}, stdout: { write: (chunk) => { projectBundleOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      expect(JSON.parse(projectBundleOutput)).toMatchObject({ ok: true, result: { path: projectBundlePath } });
      const projectBundle = JSON.parse(await readFile(projectBundlePath, 'utf8'));
      expect(projectBundle).toMatchObject({ skills: [{ name: 'local-review' }] });
      const portableProject = join(root, 'portable-project');
      await mkdir(portableProject);
      const portableReview = await executePortableRequest({
        command: 'inspect', projectPath: portableProject, bundlePath: projectBundlePath,
      }) as { reviewDigest: string; skills: Array<{ name: string; skillMarkdown: string }> };
      expect(portableReview.skills).toMatchObject([{ name: 'local-review', skillMarkdown: expect.stringContaining('Review locally.') }]);
      const portableRun = await executePortableRequest({
        command: 'prepare', projectPath: portableProject, bundlePath: projectBundlePath,
        input: {
          installConfirmed: true, reviewDigest: portableReview.reviewDigest, actualHost: 'copilot',
          progression: 'supervised', inputs: {},
          sessionDecision: {
            requested: 'shared', mechanism: 'current-conversation', description: 'Simulated host.', confirmed: true,
          },
        },
      }) as { runId: string; revision: number };
      const portableRegistration = await callControl(root, 'project.open', { path: portableProject });
      if (!portableRegistration.ok) throw new Error('Portable project registration failed.');
      const portableProjectId = (portableRegistration.result as { project: { id: string } }).project.id;
      expect(await callControl(root, 'run.list', { projectId: portableProjectId })).toMatchObject({
        ok: true, result: { records: [{ kind: 'portable', runId: portableRun.runId, status: 'ready', unresolved: true }] },
      });
      const portableStep = await executePortableRequest({
        command: 'step', projectPath: portableProject, runId: portableRun.runId,
        input: { revision: portableRun.revision, confirmed: true },
      }) as { revision: number; step: { skillPath: string; instruction: string } };
      expect(portableStep.step).toMatchObject({
        skillPath: join(portableProject, '.agents', 'skills', 'local-review'),
        instruction: expect.stringContaining('Review locally.'),
      });
      expect(await readFile(join(portableStep.step.skillPath, 'SKILL.md'), 'utf8')).toContain('Review locally.');
      const interrupted = await executePortableRequest({
        command: 'resume', projectPath: portableProject, runId: portableRun.runId,
        input: { revision: portableStep.revision, stoppedConfirmed: true },
      }) as { revision: number; status: string };
      expect(interrupted.status).toBe('interrupted');
      await expect(executePortableRequest({
        command: 'resume', projectPath: portableProject, runId: portableRun.runId,
        input: { revision: interrupted.revision, decision: 'done', confirmed: true, summary: 'Simulated host result.' },
      })).resolves.toMatchObject({ status: 'completed' });
      await expect(executePortableRequest({
        command: 'status', projectPath: portableProject, runId: portableRun.runId,
      })).resolves.toMatchObject({
        run: { status: 'completed', steps: [{ attempts: [{ status: 'done', summary: 'Simulated host result.' }] }] },
      });
      expect(await callControl(root, 'run.list', { projectId: portableProjectId })).toMatchObject({
        ok: true, result: { records: [{ kind: 'portable', runId: portableRun.runId, status: 'completed', unresolved: false }] },
      });
      let invalidBundleError = '';
      expect(await runCli([
        'bundle', 'create', '--draft', created.result.chain.id, '--project', projectId,
        '--chain', skillChainId, '--output', join(root, 'invalid.loom.json'), '--config-dir', root,
      ], {
        env: {}, stderr: { write: (chunk) => { invalidBundleError += String(chunk); return true; } },
      })).toBe(2);
      expect(JSON.parse(invalidBundleError)).toMatchObject({ ok: false, error: { code: 'CLI_USAGE' } });
      let chainOutput = '';
      const chainCli = async (command: 'list' | 'show', input: unknown) => {
        chainOutput = '';
        return runCli(['chain', 'project', command, '--config-dir', root], {
          env: {}, stdin: Readable.from([JSON.stringify(input)]),
          stdout: { write: (chunk) => { chainOutput += String(chunk); return true; }, isTTY: false },
        });
      };
      expect(await chainCli('list', { projectId })).toBe(0);
      expect(JSON.parse(chainOutput)).toMatchObject({
        ok: true, result: { chains: expect.arrayContaining([
          expect.objectContaining({ id: uiChain.id, name: 'Created in UI' }),
          expect.objectContaining({ id: imported.result.chain.id, name: 'CLI workflow copy' }),
        ]), warnings: [] },
      });
      expect(await chainCli('show', { projectId, chainId: uiChain.id })).toBe(0);
      expect(JSON.parse(chainOutput)).toMatchObject({
        protocolVersion: 1, ok: true,
        result: { chain: uiChain, revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
      const initialRevision = (JSON.parse(chainOutput) as { result: { revision: string } }).result.revision;
      const [uiUpdate, cliUpdate] = await Promise.all([
        started.app.inject({
          method: 'PUT', url: `/api/projects/${projectId}/chains/${uiChain.id}`,
          headers: { 'x-loom-chain-revision': initialRevision },
          payload: { ...draft, name: 'UI update' },
        }),
        callControl(root, 'chain.project.update', {
          projectId, chainId: uiChain.id, expectedRevision: initialRevision,
          draft: { ...draft, name: 'CLI update' },
        }),
      ]);
      expect([uiUpdate.statusCode === 200, cliUpdate.ok].filter(Boolean)).toHaveLength(1);
      if (uiUpdate.statusCode !== 200) expect(uiUpdate.json()).toMatchObject({ error: { code: 'CHAIN_STALE' } });
      if (!cliUpdate.ok) expect(cliUpdate).toMatchObject({ error: { code: 'CHAIN_STALE' } });
      expect(await callControl(root, 'chain.project.remove', {
        projectId, chainId: uiChain.id, expectedRevision: initialRevision, confirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'CHAIN_STALE' } });
      const currentChain = await callControl(root, 'chain.project.get', { projectId, chainId: uiChain.id });
      if (!currentChain.ok) throw new Error('Updated project chain could not be read.');
      const currentRevision = (currentChain.result as { revision: string }).revision;
      expect(currentRevision).not.toBe(initialRevision);
      expect(await callControl(root, 'chain.project.remove', {
        projectId, chainId: uiChain.id, expectedRevision: currentRevision,
      })).toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(root, 'chain.project.remove', {
        projectId, chainId: uiChain.id, expectedRevision: currentRevision, confirmed: true,
      })).toMatchObject({ ok: true, result: { deleted: true } });
      const initialDraft = await callControl(root, 'draft.get', { draftId: created.result.chain.id });
      if (!initialDraft.ok) throw new Error('Draft could not be read.');
      const draftRevision = (initialDraft.result as { revision: string }).revision;
      const changedDraft = await callControl(root, 'draft.update', {
        draftId: created.result.chain.id, expectedRevision: draftRevision,
        draft: { ...draft, name: 'Updated draft' },
      });
      expect(changedDraft).toMatchObject({ ok: true, result: { chain: { name: 'Updated draft' } } });
      expect(await callControl(root, 'draft.remove', {
        draftId: created.result.chain.id, expectedRevision: draftRevision, confirmed: true,
      })).toMatchObject({ ok: false, error: { code: 'CHAIN_STALE' } });
      expect(await callControl(root, 'chain.project.get', { projectId, chainId: '../unsafe' }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(root, 'chain.project.list', { projectId: 'not-registered' }))
        .toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });
      expect(await callControl(root, 'chain.project.get', { projectId }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      const report: PreflightReport = {
        status: 'pass', startAllowed: true,
        chain: { id: imported.result.chain.id, name: 'CLI workflow copy', stepCount: 1 },
        harness: 'copilot', displayName: 'Copilot', sessionMode: 'shared', mode: 'supervised',
        checks: [], resolvedInputs: {}, skills: [], catalogWarnings: [], sessionPlan: null, permissions: null,
        acknowledgements: { required: [], provided: [], missing: [] },
      };
      const runPreflight = vi.fn().mockResolvedValue(report);
      vi.spyOn(started.app.loomServices.preflightProvider, 'preflightEngine').mockResolvedValue({ run: runPreflight });
      const preflightInput = { projectId, chainId: imported.result.chain.id, mode: 'supervised' };
      let preflightOutput = '';
      expect(await runCli(['run', 'preflight', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify(preflightInput)]),
        stdout: { write: (chunk) => { preflightOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      expect(JSON.parse(preflightOutput)).toMatchObject({ ok: true, result: report });
      expect(runPreflight).toHaveBeenCalledTimes(1);
      let workspaceOutput = '';
      expect(await runCli(['workspace', 'create', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify({ sourceDraftId: created.result.chain.id })]),
        stdout: { write: (chunk) => { workspaceOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      const workspace = (JSON.parse(workspaceOutput) as { result: { workspace: { id: string; path: string } } }).result.workspace;
      await writeFile(join(workspace.path, 'result.bin'), Buffer.from([0, 1, 255]));
      await symlink(project, join(workspace.path, 'outside'));
      expect(await callControl(root, 'workspace.inspect', { workspaceId: workspace.id, path: 'result.bin' }))
        .toMatchObject({ ok: true, result: { type: 'file', bytes: 3, encoding: 'base64', content: 'AAH/' } });
      let inspectedOutput = '';
      expect(await runCli(['workspace', 'inspect', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify({ workspaceId: workspace.id, path: 'result.bin' })]),
        stdout: { write: (chunk) => { inspectedOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      expect(JSON.parse(inspectedOutput)).toMatchObject({ ok: true, result: { content: 'AAH/' } });
      const checksum = createHash('sha256').update(Buffer.from([0, 1, 255])).digest('hex');
      const checks = [
        { path: 'result.bin', sha256: checksum },
        { path: 'result.bin', sha256: '0'.repeat(64) },
        { path: 'absent.txt' },
        { path: '.loom' },
      ];
      let evaluationOutput = '';
      expect(await runCli(['workspace', 'evaluate', '--config-dir', root], {
        env: {}, stdin: Readable.from([JSON.stringify({ workspaceId: workspace.id, checks })]),
        stdout: { write: (chunk) => { evaluationOutput += String(chunk); return true; }, isTTY: false },
      })).toBe(0);
      expect(JSON.parse(evaluationOutput)).toMatchObject({
        ok: true, result: { passed: false, checks: [
          { path: 'result.bin', passed: true, bytes: 3, sha256: checksum },
          { path: 'result.bin', passed: false, outcome: 'hash-mismatch' },
          { path: 'absent.txt', passed: false, outcome: 'missing' },
          { path: '.loom', passed: false, outcome: 'not-file' },
        ] },
      });
      await writeFile(join(workspace.path, 'result.txt'), 'Hello, café!\n');
      const textChecks = await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id,
        checks: [
          { path: 'result.txt', contains: 'café' },
          { path: 'result.txt', contains: 'missing' },
          { path: 'result.bin', contains: 'a' },
          { path: 'result.txt', contains: 'Hello', sha256: '0'.repeat(64) },
        ],
      });
      expect(textChecks).toMatchObject({ ok: true, result: { passed: false, checks: [
        { passed: true, outcome: 'matched', textMatched: true },
        { passed: false, outcome: 'text-mismatch', textMatched: false },
        { passed: false, outcome: 'invalid-utf8', textMatched: false },
        { passed: false, outcome: 'hash-mismatch', textMatched: true },
      ] } });
      expect(await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id, checks: [{ path: 'result.txt', contains: '' }],
      })).toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id, checks: [{ path: 'result.txt', contains: 'a'.repeat(4096) }],
      })).toMatchObject({ ok: true, result: { checks: [{ outcome: 'text-mismatch' }] } });
      expect(await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id, checks: [{ path: 'result.txt', contains: 'a'.repeat(4097) }],
      })).toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      await writeFile(join(workspace.path, 'result.json'), JSON.stringify({
        'a/b': { '~key': [true, null, 'done'] },
      }));
      await writeFile(join(workspace.path, 'scalar.json'), '42');
      await writeFile(join(workspace.path, 'unsafe-number.json'), '9007199254740993');
      const jsonChecks = await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id,
        checks: [
          { path: 'result.json', json: { pointer: '/a~1b/~0key/0', equals: true } },
          { path: 'result.json', json: { pointer: '/a~1b/~0key/1', equals: null } },
          { path: 'result.json', json: { pointer: '/a~1b/~0key/2', equals: 'other' } },
          { path: 'result.json', json: { pointer: '/a~1b/~0key/01', equals: null } },
          { path: 'result.json', json: { pointer: '/a~1b/~0key/length', equals: 3 } },
          { path: 'result.json', json: { pointer: '/constructor', equals: null } },
          { path: 'result.json', json: { pointer: '', equals: null } },
          { path: 'result.txt', json: { pointer: '', equals: null } },
          { path: 'result.bin', json: { pointer: '', equals: null } },
          { path: 'result.json', contains: 'done', json: { pointer: '/a~1b/~0key/2', equals: 'done' } },
          { path: 'scalar.json', json: { pointer: '', equals: 42 } },
          { path: 'scalar.json', json: { pointer: '', equals: '42' } },
          { path: 'unsafe-number.json', json: { pointer: '', equals: 0 } },
        ],
      });
      expect(jsonChecks).toMatchObject({ ok: true, result: { passed: false, checks: [
        { passed: true, outcome: 'matched', jsonMatched: true },
        { passed: true, outcome: 'matched', jsonMatched: true },
        { passed: false, outcome: 'json-mismatch', jsonMatched: false },
        { passed: false, outcome: 'json-pointer-missing', jsonMatched: false },
        { passed: false, outcome: 'json-pointer-missing', jsonMatched: false },
        { passed: false, outcome: 'json-pointer-missing', jsonMatched: false },
        { passed: false, outcome: 'json-mismatch', jsonMatched: false },
        { passed: false, outcome: 'invalid-json', jsonMatched: false },
        { passed: false, outcome: 'invalid-utf8', jsonMatched: false },
        { passed: true, outcome: 'matched', textMatched: true, jsonMatched: true },
        { passed: true, outcome: 'matched', jsonMatched: true },
        { passed: false, outcome: 'json-mismatch', jsonMatched: false },
        { passed: false, outcome: 'json-number-unsafe', jsonMatched: false },
      ] } });
      await writeFile(join(workspace.path, 'numeric.json'),
        '{"underflow":1e-4000,"rounded":9007199254740991.1,"precise":1.23456789012345678,' +
        '"normalized":1.2000e1,"tiny":5e-324,"huge":1e4000,"zero":0e999999999999999999,' +
        '"max":9007199254740991,"nested":[1e-4000]}');
      await writeFile(join(workspace.path, 'underflow.json'), '1e-4000');
      const numericChecks = await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id,
        checks: [
          { path: 'numeric.json', json: { pointer: '/underflow', equals: 0 } },
          { path: 'numeric.json', json: { pointer: '/rounded', equals: 9007199254740991 } },
          { path: 'numeric.json', json: { pointer: '/precise', equals: 1.2345678901234567 } },
          { path: 'numeric.json', json: { pointer: '/normalized', equals: 12 } },
          { path: 'numeric.json', json: { pointer: '/tiny', equals: 5e-324 } },
          { path: 'numeric.json', json: { pointer: '/huge', equals: 0 } },
          { path: 'numeric.json', json: { pointer: '/zero', equals: 0 } },
          { path: 'numeric.json', json: { pointer: '/max', equals: 9007199254740991 } },
          { path: 'numeric.json', json: { pointer: '/nested/0', equals: 0 } },
          { path: 'underflow.json', json: { pointer: '', equals: 0 } },
          { path: 'numeric.json', json: { pointer: '/underflow/value', equals: 0 } },
        ],
      });
      expect(numericChecks).toMatchObject({ ok: true, result: { checks: [
        { passed: false, outcome: 'json-number-unsafe' },
        { passed: false, outcome: 'json-number-unsafe' },
        { passed: false, outcome: 'json-number-unsafe' },
        { passed: true, outcome: 'matched' },
        { passed: true, outcome: 'matched' },
        { passed: false, outcome: 'json-number-unsafe' },
        { passed: true, outcome: 'matched' },
        { passed: true, outcome: 'matched' },
        { passed: false, outcome: 'json-number-unsafe' },
        { passed: false, outcome: 'json-number-unsafe' },
        { passed: false, outcome: 'json-pointer-missing' },
      ] } });
      for (const json of [
        { pointer: '/invalid~2escape', equals: null },
        { pointer: 'relative', equals: null },
        { pointer: '', equals: { unexpected: 'object' } },
        { pointer: '' },
        { pointer: '', equals: 'a'.repeat(4097) },
        { pointer: '', equals: 9007199254740992 },
        { pointer: `/${'a'.repeat(4096)}`, equals: null },
      ]) {
        expect(await callControl(root, 'workspace.evaluate', {
          workspaceId: workspace.id, checks: [{ path: 'result.json', json }],
        })).toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      }
      expect(await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id,
        checks: [{ path: 'result.json', json: { pointer: `/${'a'.repeat(4095)}`, equals: 'a'.repeat(4096) } }],
      })).toMatchObject({ ok: true, result: { checks: [{ outcome: 'json-pointer-missing' }] } });
      expect(await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id, checks: [{ path: 'outside' }],
      })).toMatchObject({ ok: false, error: { code: 'TEST_WORKSPACE_PATH_INVALID' } });
      expect(await callControl(root, 'workspace.evaluate', {
        workspaceId: workspace.id, checks: Array.from({ length: 21 }, () => ({ path: 'result.bin' })),
      })).toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(root, 'workspace.inspect', { workspaceId: workspace.id, path: '../project' }))
        .toMatchObject({ ok: false, error: { code: 'TEST_WORKSPACE_PATH_INVALID' } });
      expect(await callControl(root, 'workspace.inspect', { workspaceId: workspace.id, path: 'outside' }))
        .toMatchObject({ ok: false, error: { code: 'TEST_WORKSPACE_PATH_INVALID' } });
      const listing = await callControl(root, 'workspace.inspect', { workspaceId: workspace.id, limit: 1 });
      expect(listing).toMatchObject({ ok: true, result: { type: 'directory', entries: [{ name: '.loom' }], nextOffset: 1 } });
      await writeFile(join(workspace.path, 'large.bin'), Buffer.alloc(1024 * 1024 + 1));
      expect(await callControl(root, 'workspace.inspect', { workspaceId: workspace.id, path: 'large.bin' }))
        .toMatchObject({ ok: false, error: { code: 'TEST_WORKSPACE_INSPECT_FAILED' } });
      expect(await callControl(root, 'workspace.remove', { workspaceId: workspace.id }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(root, 'workspace.remove', { workspaceId: workspace.id, confirmed: true }))
        .toMatchObject({ ok: true, result: { id: workspace.id, removed: true } });
      expect(await callControl(root, 'service.stop', {})).toMatchObject({
        ok: true, result: { state: 'stopping' },
      });
      await vi.waitFor(() => expect(started.app.loomLifecycle.state).toBe('stopped'));
    } finally {
      await started.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses a normal service stop while a managed run is active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-control-active-'));
    const reservation = createServer();
    await new Promise<void>((ready, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', ready);
    });
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((done, reject) => reservation.close((error) => error ? reject(error) : done()));
    const orchestrator: RunOrchestrator = {
      createRun: vi.fn(),
      getRun: vi.fn(),
      getRunView: vi.fn().mockResolvedValue({ run: { id: 'run-test', status: 'aborted' }, terminalId: null, actions: {}, recovery: null }),
      getActiveRun: vi.fn().mockResolvedValue({ active: true }), hasLiveProject: vi.fn().mockReturnValue(false),
      applyAction: vi.fn().mockResolvedValue({ run: { id: 'run-test', status: 'aborted' }, restartedFrom: null }),
      subscribe: vi.fn(),
      recoverOnStartup: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const started = await startServer({
      host: '127.0.0.1', port, serveStatic: false,
      env: { ...process.env, LOOM_CONFIG_DIR: root },
      runOrchestrator: orchestrator,
      runRecoverOnStartup: false,
    });
    try {
      expect(await callControl(root, 'run.active', {})).toMatchObject({
        ok: true, result: { active: true },
      });
      expect(await callControl(root, 'service.stop', {})).toMatchObject({
        ok: false, error: { code: 'CONTROL_RUN_ACTIVE' },
      });
      expect(started.app.loomLifecycle.state).toBe('running');
      expect(await callControl(root, 'status', {}))
        .toMatchObject({ ok: true, result: { httpEndpoint: { host: '127.0.0.1', port } } });
      expect(orchestrator.shutdown).not.toHaveBeenCalled();
      expect(await callControl(root, 'run.abort', { runId: 'run-test' }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_INVALID_REQUEST' } });
      expect(await callControl(root, 'run.abort', { runId: 'run-test', confirmed: true, reason: 'Stop the test' }))
        .toMatchObject({ ok: true, result: { run: { id: 'run-test', status: 'aborted' } } });
      expect(orchestrator.applyAction).toHaveBeenCalledWith('run-test', { action: 'abort', reason: 'Stop the test' });
    } finally {
      await started.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('authenticates, validates, and serializes catalog mutations in the owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-control-test-'));
    const store = createConfigStore({ env: { LOOM_CONFIG_DIR: root } });
    let ready = false;
    const server = await startControlServer(store, { isReady: () => ready });
    try {
      expect(await callControl(root, 'status', {})).toMatchObject({
        ok: true, result: { state: 'starting' },
      });
      expect(await callControl(root, 'catalog.source.add', { repository: 'https://example.invalid/a.git' }))
        .toMatchObject({ ok: false, error: { code: 'CONTROL_BUSY' } });
      ready = true;
      expect(await callControl(root, 'status', {})).toMatchObject({
        protocolVersion: 1, ok: true, result: { state: 'running' },
      });
      const added = await callControl(root, 'catalog.source.add', { repository: 'https://example.invalid/a.git' });
      expect(added).toMatchObject({ ok: true, result: { source: { repository: 'https://example.invalid/a.git' } } });
      expect((await store.get()).remoteSkillSources).toHaveLength(1);
      expect(await callControl(root, 'catalog.source.add', { repository: 'not-a-remote' }))
        .toMatchObject({ ok: false, error: { code: 'REMOTE_SOURCE_INVALID' } });
      await expect(startControlServer(store)).rejects.toMatchObject({ code: 'CONTROL_ENDPOINT_IN_USE' });

      const metadata = JSON.parse(await readFile(join(root, 'control.json'), 'utf8')) as { socket: string };
      const response = await new Promise<string>((resolveResponse, reject) => {
        const client = createConnection(metadata.socket);
        let data = '';
        client.once('connect', () => client.write(`${JSON.stringify({
          version: 1, token: 'x'.repeat(43), operation: 'status', input: {},
        })}\n`));
        client.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        client.once('end', () => resolveResponse(data));
        client.once('error', reject);
      });
      expect(JSON.parse(response)).toMatchObject({ ok: false, error: { code: 'CONTROL_AUTH_FAILED' } });
    } finally {
      await server.close();
      expect(await readdir(root)).toEqual(['config.json']);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replaces an unreachable endpoint after a crashed owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-control-crash-'));
    const script = `
      import { createConfigStore } from './src/server/config/store.ts';
      import { startControlServer } from './src/server/control.ts';
      await startControlServer(createConfigStore({ env: { LOOM_CONFIG_DIR: process.argv[1] } }));
      process.stdout.write('ready\\n');
    `;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, root], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((ready, reject) => {
        child.stdout.once('data', () => ready());
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`Owner exited before ready: ${String(code)}`)));
      });
      expect(child.pid).toBeDefined();
      process.kill(child.pid!, 'SIGKILL');
      await new Promise<void>((resolveExit) => child.once('close', () => resolveExit()));
      const server = await startControlServer(createConfigStore({ env: { LOOM_CONFIG_DIR: root } }));
      try {
        expect(await callControl(root, 'status', {})).toMatchObject({ ok: true });
      } finally {
        await server.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) process.kill(child.pid, 'SIGKILL');
      await rm(root, { recursive: true, force: true });
    }
  });
});
