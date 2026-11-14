import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CatalogInstallError,
  SKILL_INSTALL_ERROR_CODES,
  applyChainSkillsToProject,
  exportChainSkillsForClient,
  exportSelectedCatalogSkillsForClient,
  installSkillIntoProject,
  reviewSkillInstall,
} from '../../src/server/catalog/install.js';
import type { CatalogResponse, CatalogService } from '../../src/server/catalog/merge.js';
import { snapshotPackageFingerprint, snapshotReviewFingerprint } from '../../src/server/catalog/snapshot-fingerprint.js';
import { REMOTE_SNAPSHOT_CONTENT, type SkillEntry } from '../../src/server/catalog/types.js';
import { validateSkillTransfer } from '../../.github/skills/loom-chain-workflow/scripts/skill-loom-podman.mjs';

let root: string;
let projectPath: string;
let sourcePath: string;
let skillContent: Buffer;
let templateContent: Buffer;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loom-catalog-install-')));
  projectPath = join(root, 'project');
  sourcePath = join(root, 'personal-skills', 'release-notes');
  await mkdir(projectPath, { recursive: true });
  await mkdir(join(sourcePath, 'templates'), { recursive: true });
  skillContent = Buffer.from('---\nname: release-notes\ndescription: Writes notes\n---\nBODY\n');
  templateContent = Buffer.from('TEMPLATE\n');
  await writeFile(join(sourcePath, 'SKILL.md'), skillContent);
  await writeFile(join(sourcePath, 'templates', 'note.md'), templateContent);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function entry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id: 'opencode-personal-release-notes',
    harness: 'opencode',
    source: 'personal',
    name: 'release-notes',
    description: 'Writes notes',
    path: join(sourcePath, 'SKILL.md'),
    packagePath: sourcePath,
    enabled: true,
    ...overrides,
  };
}

function catalogWith(entries: SkillEntry[]): CatalogService {
  return {
    defaultHarness: 'opencode',
    async getCatalog(): Promise<CatalogResponse> {
      const bySource = {
        project: 0,
        personal: 0,
        custom: 0,
        plugin: 0,
        builtin: 0,
        'loom-extra': 0,
        remote: 0,
      };
      const groups = new Map<SkillEntry['source'], SkillEntry[]>();
      for (const item of entries) {
        bySource[item.source] += 1;
        const group = groups.get(item.source) ?? [];
        group.push(item);
        groups.set(item.source, group);
      }
      return {
        harness: 'opencode',
        query: '',
        total: entries.length,
        counts: { total: entries.length, bySource },
        groups: [...groups].map(([source, groupEntries]) => ({
          source,
          count: groupEntries.length,
          entries: groupEntries,
        })),
        agents: [],
        warnings: [],
        elapsedMs: 1,
      };
    },
  };
}

function indexFingerprint(path: string, content: Buffer): string {
  return createHash('sha256')
    .update('skill-loom-capability-index-v1\0')
    .update(path, 'utf8')
    .update('\0')
    .update(content)
    .digest('hex');
}

async function expectInstallError(operation: Promise<unknown>, code: string): Promise<CatalogInstallError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogInstallError);
    const installError = error as CatalogInstallError;
    expect(installError.code).toBe(code);
    return installError;
  }
  throw new Error('Expected a CatalogInstallError.');
}

describe.skipIf(process.platform === 'win32')('catalog skill install', () => {
  it('uses the reviewed package fingerprint for selected client export', async () => {
    const personal = entry();
    const catalogService = catalogWith([personal]);
    const reviewed = await reviewSkillInstall(
      { catalogService },
      {
        projectId: 'project-1',
        projectPath,
        harness: 'opencode',
        candidate: { id: personal.id, source: 'personal' },
      },
    );
    const fingerprint = reviewed.candidate.fingerprint;
    const transfer = await exportSelectedCatalogSkillsForClient(
      { catalogService },
      {
        projectId: 'project-1',
        projectPath,
        harness: 'opencode',
        selections: [{ id: personal.id, fingerprint }],
      },
    );

    expect(transfer.skills[0]?.fingerprint).toBe(fingerprint);
    expect(validateSkillTransfer(transfer, [{ id: personal.id, fingerprint }])).toHaveLength(1);
  });

  it('applies and exports the exact bound remote package over a same-named personal package', async () => {
    const remotePath = join(root, 'remote-skills', 'release-notes');
    await mkdir(remotePath, { recursive: true });
    const remoteSkillContent = Buffer.from('---\nname: release-notes\ndescription: Hosted version\n---\nREMOTE\n');
    await writeFile(join(remotePath, 'SKILL.md'), remoteSkillContent);
    const remoteFiles = [{ path: 'SKILL.md', content: remoteSkillContent, executable: false }];
    const binding = {
      sourceId: 'hosted-skills',
      revision: 'a'.repeat(40),
      repositoryPath: 'skills/release-notes',
    };
    const personal = entry();
    const remote = entry({
      id: 'opencode-remote-release-notes',
      source: 'remote',
      sourceId: binding.sourceId,
      revision: binding.revision,
      repositoryPath: binding.repositoryPath,
      path: join(remotePath, 'SKILL.md'),
      packagePath: remotePath,
      [REMOTE_SNAPSHOT_CONTENT]: {
        fingerprint: snapshotPackageFingerprint(remoteFiles),
        reviewFingerprint: snapshotReviewFingerprint(remoteFiles),
        executablePaths: [],
      },
    });
    const catalogService = catalogWith([personal, remote]);
    const chain = {
      harness: 'opencode' as const,
      steps: [{
        id: 'step-one',
        kind: 'skill' as const,
        skillName: 'release-notes',
        skillBinding: binding,
        instruction: 'Write the notes.',
      }],
    };
    const transfer = await exportChainSkillsForClient(
      { catalogService },
      { projectId: 'project-1', projectPath, chain },
    );
    const installed = await applyChainSkillsToProject(
      { catalogService },
      { projectId: 'project-1', projectPath, chain },
    );

    expect(Buffer.from(transfer.skills[0]!.files[0]!.content, 'base64')).toEqual(remoteSkillContent);
    expect(installed.installed).toMatchObject([{ name: 'release-notes', source: 'remote' }]);
    await expect(readFile(join(projectPath, '.agents', 'skills', 'release-notes', 'SKILL.md')))
      .resolves.toEqual(remoteSkillContent);
  });

  it('exports only referenced global packages for client-local apply', async () => {
    const projectSource = join(root, 'project-skill');
    await mkdir(projectSource, { recursive: true });
    await writeFile(join(projectSource, 'SKILL.md'), '---\nname: release-notes\n---\nPROJECT\n');
    const personal = entry();
    const project = entry({
      id: 'opencode-project-release-notes',
      source: 'project',
      path: join(projectSource, 'SKILL.md'),
      packagePath: projectSource,
    });
    const transfer = await exportChainSkillsForClient(
      { catalogService: catalogWith([project, personal]) },
      {
        projectId: 'project-1',
        projectPath,
        chain: {
          harness: 'opencode',
          steps: [{ id: 'step-one', kind: 'skill', skillName: 'release-notes', instruction: 'Write notes.' }],
        },
      },
    );

    expect(transfer).toMatchObject({
      format: 'skill-loom-project-skills',
      version: 1,
      skills: [{
        name: 'release-notes',
        directory: 'release-notes',
        files: [
          { path: 'SKILL.md', content: skillContent.toString('base64') },
          { path: 'templates/note.md', content: templateContent.toString('base64') },
        ],
      }],
    });
    await expect(access(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reviews a candidate without writing to the project', async () => {
    const review = await reviewSkillInstall(
      { catalogService: catalogWith([entry()]) },
      {
        projectId: 'project-1',
        projectPath,
        harness: 'opencode',
        candidate: { id: 'opencode-personal-release-notes', source: 'personal' },
      },
    );

    expect(review).toMatchObject({
      project: { id: 'project-1', path: projectPath },
      harness: 'opencode',
      candidate: {
        id: 'opencode-personal-release-notes',
        source: 'personal',
        name: 'release-notes',
        personalSource: true,
      },
      destination: {
        root: join(projectPath, '.agents', 'skills'),
        name: 'release-notes',
        path: join(projectPath, '.agents', 'skills', 'release-notes'),
        conflict: null,
      },
      totalFiles: 2,
      totalBytes: skillContent.length + templateContent.length,
      reviewDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(review.files.map((file) => file.path)).toEqual(['SKILL.md', 'templates/note.md']);
    expect(review.files[0]?.sha256).toBe(createHash('sha256').update(skillContent).digest('hex'));
    await expect(access(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('installs the reviewed package and refuses a second copy', async () => {
    const service = catalogWith([entry()]);
    const request = {
      projectId: 'project-1',
      projectPath,
      harness: 'opencode' as const,
      candidate: { id: 'opencode-personal-release-notes', source: 'personal' as const },
    };
    const review = await reviewSkillInstall({ catalogService: service }, request);
    const installed = await installSkillIntoProject(
      { catalogService: service },
      { ...request, reviewDigest: review.reviewDigest },
    );

    expect(installed).toMatchObject({
      name: 'release-notes',
      source: 'personal',
      destinationPath: join(projectPath, '.agents', 'skills', 'release-notes'),
      totalFiles: 2,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await readFile(join(installed.destinationPath, 'SKILL.md'))).toEqual(skillContent);
    expect(await readFile(join(installed.destinationPath, 'templates', 'note.md'))).toEqual(templateContent);

    const conflict = await reviewSkillInstall({ catalogService: service }, request);
    expect(conflict.destination.conflict).toBe('EXISTS');
    await expectInstallError(
      installSkillIntoProject({ catalogService: service }, { ...request, reviewDigest: conflict.reviewDigest }),
      SKILL_INSTALL_ERROR_CODES.DESTINATION_CONFLICT,
    );
  });

  it('rejects a stale digest after the package changes', async () => {
    const service = catalogWith([entry()]);
    const request = {
      projectId: 'project-1',
      projectPath,
      harness: 'opencode' as const,
      candidate: { id: 'opencode-personal-release-notes', source: 'personal' as const },
    };
    const review = await reviewSkillInstall({ catalogService: service }, request);
    await writeFile(join(sourcePath, 'SKILL.md'), '---\nname: release-notes\n---\nCHANGED\n');

    await expectInstallError(
      installSkillIntoProject({ catalogService: service }, { ...request, reviewDigest: review.reviewDigest }),
      SKILL_INSTALL_ERROR_CODES.REVIEW_STALE,
    );
    await expect(access(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('validates a candidate fingerprint from indexed discovery', async () => {
    const matching = indexFingerprint(join(sourcePath, 'SKILL.md'), skillContent);
    await expect(reviewSkillInstall(
      { catalogService: catalogWith([entry()]) },
      {
        projectId: 'project-1',
        projectPath,
        harness: 'opencode',
        candidate: {
          id: 'opencode-personal-release-notes',
          source: 'personal',
          fingerprint: matching,
        },
      },
    )).resolves.toMatchObject({ candidate: { personalSource: true } });

    await expectInstallError(
      reviewSkillInstall(
        { catalogService: catalogWith([entry()]) },
        {
          projectId: 'project-1',
          projectPath,
          harness: 'opencode',
          candidate: {
            id: 'opencode-personal-release-notes',
            source: 'personal',
            fingerprint: 'a'.repeat(64),
          },
        },
      ),
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
    );
  });

  it('rejects the project source, unknown candidates, and symlinked packages', async () => {
    await expectInstallError(
      reviewSkillInstall(
        { catalogService: catalogWith([entry({ source: 'project' })]) },
        {
          projectId: 'project-1',
          projectPath,
          harness: 'opencode',
          candidate: { id: 'opencode-personal-release-notes', source: 'project' },
        },
      ),
      SKILL_INSTALL_ERROR_CODES.SOURCE_UNSUPPORTED,
    );

    await expectInstallError(
      reviewSkillInstall(
        { catalogService: catalogWith([entry({ source: 'builtin' })]) },
        {
          projectId: 'project-1',
          projectPath,
          harness: 'opencode',
          candidate: { id: 'opencode-personal-release-notes', source: 'builtin' },
        },
      ),
      SKILL_INSTALL_ERROR_CODES.SOURCE_UNSUPPORTED,
    );

    await expectInstallError(
      reviewSkillInstall(
        { catalogService: catalogWith([entry()]) },
        {
          projectId: 'project-1',
          projectPath,
          harness: 'opencode',
          candidate: { id: 'missing', source: 'personal' },
        },
      ),
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_NOT_FOUND,
    );

    await symlink(join(sourcePath, 'SKILL.md'), join(sourcePath, 'linked.md'));
    await expectInstallError(
      reviewSkillInstall(
        { catalogService: catalogWith([entry()]) },
        {
          projectId: 'project-1',
          projectPath,
          harness: 'opencode',
          candidate: { id: 'opencode-personal-release-notes', source: 'personal' },
        },
      ),
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
    );
  });

  it('binds a remote candidate to its verified snapshot', async () => {
    const files = [
      { path: 'SKILL.md', content: skillContent, executable: false },
      { path: 'templates/note.md', content: templateContent, executable: false },
    ];
    const fingerprint = snapshotPackageFingerprint(files);
    const remote = entry({
      source: 'remote',
      sourceId: 'git-source',
      revision: 'a'.repeat(40),
      repositoryPath: 'skills/release-notes',
      [REMOTE_SNAPSHOT_CONTENT]: {
        fingerprint,
        reviewFingerprint: snapshotReviewFingerprint(files),
        executablePaths: [],
      },
    });
    const request = {
      projectId: 'project-1',
      projectPath,
      harness: 'opencode' as const,
      candidate: {
        id: remote.id,
        source: 'remote' as const,
        sourceId: 'git-source',
        revision: 'a'.repeat(40),
        repositoryPath: 'skills/release-notes',
        fingerprint,
      },
    };
    const review = await reviewSkillInstall({ catalogService: catalogWith([remote]) }, request);
    expect(review.candidate).toMatchObject({
      source: 'remote',
      sourceId: 'git-source',
      revision: 'a'.repeat(40),
      repositoryPath: 'skills/release-notes',
      fingerprint,
      personalSource: false,
    });
    await installSkillIntoProject(
      { catalogService: catalogWith([remote]) },
      { ...request, reviewDigest: review.reviewDigest },
    );
    expect(await readFile(join(projectPath, '.agents', 'skills', 'release-notes', 'SKILL.md'))).toEqual(skillContent);

    await expectInstallError(
      reviewSkillInstall(
        { catalogService: catalogWith([remote]) },
        { ...request, candidate: { ...request.candidate, fingerprint: 'b'.repeat(64) } },
      ),
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
    );
    await expectInstallError(
      reviewSkillInstall(
        { catalogService: catalogWith([remote]) },
        { ...request, candidate: { ...request.candidate, revision: 'b'.repeat(40) } },
      ),
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
    );
    const withoutSnapshot = entry({
      source: 'remote',
      sourceId: 'git-source',
      revision: 'a'.repeat(40),
      repositoryPath: 'skills/release-notes',
    });
    await expectInstallError(
      reviewSkillInstall({ catalogService: catalogWith([withoutSnapshot]) }, request),
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_CHANGED,
    );
  });

  it('requires exact remote identity and slugs an explicit destination name', async () => {
    const remote = entry({
      source: 'remote',
      sourceId: 'git-source',
      revision: 'a'.repeat(40),
      repositoryPath: 'skills/release-notes',
      [REMOTE_SNAPSHOT_CONTENT]: {
        fingerprint: snapshotPackageFingerprint([
          { path: 'SKILL.md', content: skillContent, executable: false },
          { path: 'templates/note.md', content: templateContent, executable: false },
        ]),
        reviewFingerprint: snapshotReviewFingerprint([
          { path: 'SKILL.md', content: skillContent, executable: false },
          { path: 'templates/note.md', content: templateContent, executable: false },
        ]),
        executablePaths: [],
      },
    });
    await expectInstallError(
      reviewSkillInstall(
        { catalogService: catalogWith([remote]) },
        {
          projectId: 'project-1',
          projectPath,
          harness: 'opencode',
          candidate: { id: remote.id, source: 'remote' },
        },
      ),
      SKILL_INSTALL_ERROR_CODES.CANDIDATE_NOT_FOUND,
    );

    const review = await reviewSkillInstall(
      { catalogService: catalogWith([entry()]) },
      {
        projectId: 'project-1',
        projectPath,
        harness: 'opencode',
        candidate: { id: 'opencode-personal-release-notes', source: 'personal' },
        destinationName: 'My Notes',
      },
    );
    expect(review.destination.name).toBe('my-notes');
  });
});
