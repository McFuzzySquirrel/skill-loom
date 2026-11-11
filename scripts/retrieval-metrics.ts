export interface TaskOutcome {
  id: string;
  category: string;
  expectNoResult: boolean;
  resultCount: number;
  /** 1-based rank of each expected skill, or null when it was not returned. */
  expectedRanks: Array<number | null>;
  elapsedMs: number;
}

export interface RetrievalMetrics {
  tasks: number;
  positiveTasks: number;
  negativeTasks: number;
  recallAt5: number;
  recallAt10: number;
  fullRecallAt10: number;
  mrr: number;
  emptyResultRate: number;
  falsePositiveRate: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
}

export interface CategoryMetrics {
  tasks: number;
  positiveTasks: number;
  recallAt10: number;
  fullRecallAt10: number;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function rankOfSkill(names: readonly string[], skill: string): number | null {
  const index = names.indexOf(skill);
  return index === -1 ? null : index + 1;
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function positive(outcomes: readonly TaskOutcome[]): TaskOutcome[] {
  return outcomes.filter((outcome) => !outcome.expectNoResult);
}

function anyWithin(outcome: TaskOutcome, limit: number): boolean {
  return outcome.expectedRanks.some((rank) => rank !== null && rank <= limit);
}

function allWithin(outcome: TaskOutcome, limit: number): boolean {
  return outcome.expectedRanks.length > 0 &&
    outcome.expectedRanks.every((rank) => rank !== null && rank <= limit);
}

function firstRank(outcome: TaskOutcome): number | null {
  const ranks = outcome.expectedRanks.filter((rank): rank is number => rank !== null);
  return ranks.length === 0 ? null : Math.min(...ranks);
}

export function computeMetrics(outcomes: readonly TaskOutcome[]): RetrievalMetrics {
  const positives = positive(outcomes);
  const negatives = outcomes.filter((outcome) => outcome.expectNoResult);
  const latency = outcomes.map((outcome) => outcome.elapsedMs);

  const recallAt5 = positives.filter((outcome) => anyWithin(outcome, 5)).length;
  const recallAt10 = positives.filter((outcome) => anyWithin(outcome, 10)).length;
  const fullRecallAt10 = positives.filter((outcome) => allWithin(outcome, 10)).length;
  const reciprocalRank = positives.reduce((sum, outcome) => {
    const rank = firstRank(outcome);
    return sum + (rank === null ? 0 : 1 / rank);
  }, 0);
  const empty = positives.filter((outcome) => outcome.resultCount === 0).length;
  const falsePositive = negatives.filter((outcome) => outcome.resultCount > 0).length;

  return {
    tasks: outcomes.length,
    positiveTasks: positives.length,
    negativeTasks: negatives.length,
    recallAt5: positives.length === 0 ? 0 : round(recallAt5 / positives.length),
    recallAt10: positives.length === 0 ? 0 : round(recallAt10 / positives.length),
    fullRecallAt10: positives.length === 0 ? 0 : round(fullRecallAt10 / positives.length),
    mrr: positives.length === 0 ? 0 : round(reciprocalRank / positives.length),
    emptyResultRate: positives.length === 0 ? 0 : round(empty / positives.length),
    falsePositiveRate: negatives.length === 0 ? 0 : round(falsePositive / negatives.length),
    meanLatencyMs: latency.length === 0 ? 0 : round(latency.reduce((sum, value) => sum + value, 0) / latency.length),
    p95LatencyMs: round(percentile(latency, 0.95)),
  };
}

export function computeCategoryMetrics(outcomes: readonly TaskOutcome[]): Record<string, CategoryMetrics> {
  const categories: Record<string, CategoryMetrics> = {};
  for (const outcome of outcomes) {
    const current = categories[outcome.category] ?? {
      tasks: 0,
      positiveTasks: 0,
      recallAt10: 0,
      fullRecallAt10: 0,
    };
    current.tasks += 1;
    if (!outcome.expectNoResult) {
      current.positiveTasks += 1;
      if (anyWithin(outcome, 10)) current.recallAt10 += 1;
      if (allWithin(outcome, 10)) current.fullRecallAt10 += 1;
    }
    categories[outcome.category] = current;
  }
  for (const metrics of Object.values(categories)) {
    if (metrics.positiveTasks > 0) {
      metrics.recallAt10 = round(metrics.recallAt10 / metrics.positiveTasks);
      metrics.fullRecallAt10 = round(metrics.fullRecallAt10 / metrics.positiveTasks);
    }
  }
  return categories;
}
