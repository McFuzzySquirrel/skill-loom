import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoveryApi, discoveryCandidateFromPackage } from '../../src/web/api/discovery.js';

const revision = 'a'.repeat(40);

function candidate(name: string) {
  return discoveryCandidateFromPackage(
    'test-source',
    revision,
    'https://example.test/skills.git',
    {
      name,
      description: `Fixture ${name}`,
      repositoryPath: `skills/${name}`,
      fingerprint: 'b'.repeat(64),
      directory: 'c'.repeat(64),
      bytes: 48,
      files: 1,
    },
  );
}

function handoff(goal: string, harness: 'opencode' | 'copilot', candidates: ReturnType<typeof candidate>[]) {
  return {
    format: 'skill-loom-discovery-handoff',
    version: 1,
    goal,
    harness,
    createdAt: '2026-11-08T00:00:00.000Z',
    candidates: candidates.map(({ sourceId, revision: candidateRevision, repositoryPath, fingerprint, name }) => ({
      sourceId,
      revision: candidateRevision,
      repositoryPath,
      name,
      fingerprint,
      files: [{
        path: 'SKILL.md',
        content: Buffer.from(`---\nname: ${name}\n---\nReview.\n`).toString('base64'),
        executable: false,
      }],
    })),
    fingerprint: 'd'.repeat(64),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discovery API request identities', () => {
  it.each([
    ['one candidate', ['alpha']],
    ['bulk candidates', ['alpha', 'beta']],
  ])('sends only exact pinned identities for %s', async (_label, names) => {
    const candidates = names.map((name) => candidate(name));
    const goal = 'Review the selected skills';
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        goal: string;
        harness: string;
        candidates: unknown[];
      };
      return Response.json(handoff(request.goal, request.harness as 'opencode', candidates));
    });
    vi.stubGlobal('fetch', fetch);

    await discoveryApi.prepare({ goal, harness: 'opencode', candidates });

    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body).toEqual({
      goal,
      harness: 'opencode',
      candidates: candidates.map(({ sourceId, revision: candidateRevision, repositoryPath, fingerprint }) => ({
        sourceId,
        revision: candidateRevision,
        repositoryPath,
        fingerprint,
      })),
    });
  });
});
