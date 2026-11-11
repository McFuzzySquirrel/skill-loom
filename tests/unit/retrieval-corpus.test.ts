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
});
