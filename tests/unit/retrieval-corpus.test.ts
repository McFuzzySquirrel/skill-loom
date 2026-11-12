import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RetrievalCorpusSchema, loadRetrievalCorpus } from '../../scripts/retrieval-corpus.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const corpusPath = resolve(repoRoot, 'tests', 'fixtures', 'retrieval', 'chain-authoring-corpus.json');

describe('chain-authoring retrieval corpus', () => {
  it('loads a reviewed corpus with known candidate packages', async () => {
    const corpus = await loadRetrievalCorpus(corpusPath);

    expect(corpus.version).toBe(1);
    expect(corpus.candidates.length).toBeGreaterThanOrEqual(10);
    expect(corpus.tasks.length).toBeGreaterThanOrEqual(30);
    expect(new Set(corpus.tasks.map((task) => task.id)).size).toBe(corpus.tasks.length);

    for (const candidate of corpus.candidates) {
      await expect(access(resolve(repoRoot, candidate.source))).resolves.toBeUndefined();
    }
  });

  it('keeps negative tasks empty and positive tasks named', async () => {
    const corpus = await loadRetrievalCorpus(corpusPath);

    for (const task of corpus.tasks) {
      if (task.expectNoResult) {
        expect(task.expectedSkills).toEqual([]);
      } else {
        expect(task.expectedSkills.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects a task that names an unknown candidate skill', () => {
    const result = RetrievalCorpusSchema.safeParse({
      version: 1,
      description: 'invalid fixture',
      candidates: [{ name: 'known', source: 'skills/known' }],
      tasks: [{
        id: 'invalid-task',
        outcome: 'Do something',
        query: 'something',
        expectedSkills: ['unknown'],
      }],
    });

    expect(result.success).toBe(false);
  });

  it('covers remote bindings and source-policy exclusions', async () => {
    const corpus = await loadRetrievalCorpus(corpusPath);
    const remoteCandidate = corpus.candidates.find((candidate) => candidate.name === 'remote-release-audit');
    expect(remoteCandidate).toMatchObject({
      location: 'remote',
      remote: {
        sourceId: 'eval-remote-team',
        revision: 'a'.repeat(40),
        repositoryPath: 'collection/remote-release-audit',
      },
    });
    expect(corpus.tasks.some((task) => task.category === 'remote')).toBe(true);
    const filterTask = corpus.tasks.find((task) => task.category === 'filter');
    expect(filterTask).toMatchObject({
      allowedSources: ['project'],
      excludedSkills: ['personal-skill-inventory'],
    });
    const metadataTask = corpus.tasks.find((task) => task.category === 'metadata');
    expect(metadataTask).toBeDefined();
    expect(corpus.tasks.some((task) => task.tags.length > 0)).toBe(true);
    expect(corpus.tasks.some((task) => task.tools.length > 0)).toBe(true);
    expect(corpus.tasks.some((task) => task.inputs.length > 0)).toBe(true);
    expect(corpus.tasks.some((task) => task.outputs.length > 0)).toBe(true);
  });

  it('rejects a remote candidate without a binding and a mismatched expected binding', () => {
    const missing = RetrievalCorpusSchema.safeParse({
      version: 1,
      description: 'invalid fixture',
      candidates: [{ name: 'remote', source: 'skills/remote', location: 'remote' }],
      tasks: [{
        id: 'invalid-task',
        outcome: 'Do something',
        query: 'something',
        expectedSkills: ['remote'],
      }],
    });
    expect(missing.success).toBe(false);

    const mismatched = RetrievalCorpusSchema.safeParse({
      version: 1,
      description: 'invalid fixture',
      candidates: [{
        name: 'remote', source: 'skills/remote', location: 'remote',
        remote: { sourceId: 'team', revision: 'a'.repeat(40), repositoryPath: 'collection/remote' },
      }],
      tasks: [{
        id: 'invalid-task',
        outcome: 'Do something',
        query: 'something',
        expectedSkills: ['remote'],
        expectedBindings: {
          remote: { sourceId: 'team', revision: 'b'.repeat(40), repositoryPath: 'collection/remote' },
        },
      }],
    });
    expect(mismatched.success).toBe(false);
  });
});
