import { describe, expect, it } from 'vitest';
import {
  computeCategoryMetrics,
  computeMetrics,
  percentile,
  rankOfSkill,
} from '../../scripts/retrieval-metrics.js';

describe('retrieval metrics', () => {
  it('ranks skills by one-based position and reports missing skills', () => {
    expect(rankOfSkill(['accessible-react-workflows', 'atomic-json-persistence'], 'atomic-json-persistence')).toBe(2);
    expect(rankOfSkill(['accessible-react-workflows'], 'missing')).toBeNull();
  });

  it('computes recall, full recall, MRR, empty results, false positives, and latency', () => {
    const outcomes = [
      { id: 'a', category: 'description-match', expectNoResult: false, resultCount: 2, expectedRanks: [2], elapsedMs: 10 },
      { id: 'b', category: 'body-only', expectNoResult: false, resultCount: 1, expectedRanks: [null], elapsedMs: 20 },
      { id: 'c', category: 'compose', expectNoResult: false, resultCount: 3, expectedRanks: [1, 12], elapsedMs: 30 },
      { id: 'd', category: 'negative', expectNoResult: true, resultCount: 0, expectedRanks: [], elapsedMs: 40 },
      { id: 'e', category: 'negative', expectNoResult: true, resultCount: 1, expectedRanks: [], elapsedMs: 50 },
    ];

    const metrics = computeMetrics(outcomes);

    expect(metrics.tasks).toBe(5);
    expect(metrics.positiveTasks).toBe(3);
    expect(metrics.negativeTasks).toBe(2);
    expect(metrics.recallAt5).toBe(0.6667);
    expect(metrics.recallAt10).toBe(0.6667);
    expect(metrics.fullRecallAt10).toBe(0.3333);
    expect(metrics.mrr).toBe(0.5);
    expect(metrics.emptyResultRate).toBe(0);
    expect(metrics.falsePositiveRate).toBe(0.5);
    expect(metrics.meanLatencyMs).toBe(30);
    expect(metrics.p95LatencyMs).toBe(50);
  });

  it('computes category metrics without counting negative tasks as positives', () => {
    const categories = computeCategoryMetrics([
      { id: 'a', category: 'description-match', expectNoResult: false, resultCount: 1, expectedRanks: [1], elapsedMs: 1 },
      { id: 'b', category: 'body-only', expectNoResult: false, resultCount: 0, expectedRanks: [null], elapsedMs: 1 },
      { id: 'c', category: 'negative', expectNoResult: true, resultCount: 0, expectedRanks: [], elapsedMs: 1 },
    ]);

    expect(categories['description-match']).toMatchObject({
      tasks: 1,
      positiveTasks: 1,
      recallAt10: 1,
      fullRecallAt10: 1,
    });
    expect(categories['body-only']).toMatchObject({
      tasks: 1,
      positiveTasks: 1,
      recallAt10: 0,
      fullRecallAt10: 0,
    });
    expect(categories.negative).toMatchObject({
      tasks: 1,
      positiveTasks: 0,
      recallAt10: 0,
      fullRecallAt10: 0,
    });
  });

  it('reports exact-binding accuracy, excluded-policy violations, and fallbacks', () => {
    const metrics = computeMetrics([
      {
        id: 'remote', category: 'remote', expectNoResult: false, resultCount: 1,
        expectedRanks: [1], elapsedMs: 1,
        bindingCases: 2, bindingCorrect: 1, excludedCases: 2, excludedPresent: 1,
      },
      {
        id: 'scan-fallback', category: 'body-only', expectNoResult: false, resultCount: 1,
        expectedRanks: [1], elapsedMs: 1, fallback: true,
      },
    ]);

    expect(metrics.bindingCases).toBe(2);
    expect(metrics.bindingAccuracy).toBe(0.5);
    expect(metrics.excludedCases).toBe(2);
    expect(metrics.excludedViolationRate).toBe(0.5);
    expect(metrics.fallbackCount).toBe(1);
  });

  it('treats absent binding cases as fully accurate and absent exclusions as clean', () => {
    const metrics = computeMetrics([
      { id: 'a', category: 'description-match', expectNoResult: false, resultCount: 1, expectedRanks: [1], elapsedMs: 1 },
    ]);
    expect(metrics.bindingAccuracy).toBe(1);
    expect(metrics.excludedViolationRate).toBe(0);
  });

  it('computes precision@10 across the top candidate window', () => {
    const metrics = computeMetrics([
      {
        id: 'a', category: 'description-match', expectNoResult: false, resultCount: 4,
        expectedRanks: [1], elapsedMs: 1, topCount: 4, relevantTopCount: 2,
      },
      {
        id: 'b', category: 'body-only', expectNoResult: false, resultCount: 0,
        expectedRanks: [null], elapsedMs: 1, topCount: 0, relevantTopCount: 0,
      },
      {
        id: 'c', category: 'negative', expectNoResult: true, resultCount: 0,
        expectedRanks: [], elapsedMs: 1, topCount: 0, relevantTopCount: 0,
      },
    ]);
    expect(metrics.precisionAt10).toBe(0.25);
  });

  it('returns zero for an empty percentile sample', () => {
    expect(percentile([], 0.95)).toBe(0);
  });
});
