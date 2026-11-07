import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  copyNativeAgentIntoProject,
  inspectInstalledNativeAgent,
  NativeAgentCopyError,
} from '../../src/server/catalog/agent-copy.js';
import type { NativeAgentEntry } from '../../src/server/catalog/types.js';

let root: string;
let projectPath: string;
let sourcePath: string;
let sourceContent: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loom-agent-copy-'));
  projectPath = join(root, 'project');
  sourcePath = join(root, 'snapshot', 'reviewer.agent.md');
  sourceContent = '---\nname: reviewer\n---\nReview carefully.\n';
  await mkdir(projectPath, { recursive: true });
  await mkdir(join(root, 'snapshot'), { recursive: true });
  await writeFile(sourcePath, sourceContent, 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function entry(overrides: Partial<NativeAgentEntry> = {}): NativeAgentEntry {
  return {
    id: 'remote-agent-reviewer',
    harness: 'copilot',
    source: 'remote',
    name: 'reviewer',
    description: 'Reviews carefully',
    path: sourcePath,
    agentPath: 'reviewer.agent.md',
    sourceId: 'source',
    repository: 'https://example.test/agents.git',
    revision: 'a'.repeat(40),
    repositoryPath: '.github/agents/reviewer.agent.md',
    fingerprint: createHash('sha256').update(sourceContent).digest('hex'),
    status: 'available',
    statusReason: null,
    ...overrides,
  };
}

describe('native agent project installation', () => {
  it('installs only verified agent content in its native project location', async () => {
    const result = await copyNativeAgentIntoProject({ projectPath, entry: entry() });
    const installedPath = join(projectPath, '.github', 'agents', 'reviewer.agent.md');

    expect(result.destinationPath).toBe(installedPath);
    expect(await readFile(installedPath, 'utf8')).toBe(sourceContent);
    expect(await inspectInstalledNativeAgent({
      projectPath,
      selection: {
        harness: 'copilot',
        name: 'reviewer',
        sourceId: 'source',
        revision: 'a'.repeat(40),
        repositoryPath: '.github/agents/reviewer.agent.md',
        agentPath: 'reviewer.agent.md',
        fingerprint: result.fingerprint,
      },
    })).toBe('available');
  });

  it('does not overwrite a project agent and reports modified installed content', async () => {
    await copyNativeAgentIntoProject({ projectPath, entry: entry() });
    await expect(
      copyNativeAgentIntoProject({ projectPath, entry: entry() }),
    ).rejects.toMatchObject({ code: 'NATIVE_AGENT_CONFLICT' });

    await writeFile(join(projectPath, '.github', 'agents', 'reviewer.agent.md'), 'changed');
    expect(await inspectInstalledNativeAgent({
      projectPath,
      selection: {
        harness: 'copilot',
        name: 'reviewer',
        sourceId: 'source',
        revision: 'a'.repeat(40),
        repositoryPath: '.github/agents/reviewer.agent.md',
        agentPath: 'reviewer.agent.md',
        fingerprint: entry().fingerprint,
      },
    })).toBe('modified');
  });

  it('rejects unsafe agent paths and linked native roots', async () => {
    await expect(
      copyNativeAgentIntoProject({
        projectPath,
        entry: entry({ agentPath: '../reviewer.agent.md' }),
      }),
    ).rejects.toBeInstanceOf(NativeAgentCopyError);

    const outside = join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(projectPath, '.github'));
    await expect(
      copyNativeAgentIntoProject({ projectPath, entry: entry() }),
    ).rejects.toMatchObject({ code: 'NATIVE_AGENT_COPY_FAILED' });
  });
});
