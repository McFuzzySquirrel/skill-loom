#!/usr/bin/env node
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalogService, createDefaultCatalogAdapters } from '../src/server/catalog/merge.js';
import { createConfigStore } from '../src/server/config/store.js';
import { loadRetrievalCorpus } from './retrieval-corpus.js';
import {
  computeCategoryMetrics,
  computeMetrics,
  rankOfSkill,
  type CategoryMetrics,
  type RetrievalMetrics,
  type TaskOutcome,
} from './retrieval-metrics.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CORPUS = 'tests/fixtures/retrieval/chain-authoring-corpus.json';

interface Options {
  corpus: string;
  json: boolean;
  out: string | null;
}

interface TaskReport {
  id: string;
  category: string;
  query: string;
  outcome: string;
  expectNoResult: boolean;
  resultCount: number;
  expectedSkills: string[];
  expectedRanks: Array<number | null>;
  topResults: Array<{ name: string; source: string }>;
  elapsedMs: number;
}

interface Report {
  version: 1;
  generatedAt: string;
  node: string;
  corpus: string;
  candidates: number;
  tasks: number;
  metrics: RetrievalMetrics;
  byCategory: Record<string, CategoryMetrics>;
  perTask: TaskReport[];
}

function usage(): string {
  return [
    'Usage: npm run eval:retrieval -- [--corpus <path>] [--json] [--out <path>]',
    '',
    'Runs the chain-authoring retrieval corpus against the current catalog search.',
    'It copies the corpus candidate packages into a temporary project, makes no',
    'model calls, and reports recall, MRR, empty results, false positives, and latency.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Options {
  let corpus = DEFAULT_CORPUS;
  let json = false;
  let out: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--corpus' || argument === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.trim() === '') throw new Error(`${argument} requires a path.`);
      if (argument === '--corpus') corpus = value;
      else out = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument "${argument}".\n\n${usage()}`);
  }
  return { corpus, json, out };
}

function displayPath(path: string): string {
  return isAbsolute(path) ? relative(repoRoot, path) : path;
}

function format(value: number): string {
  return value.toFixed(3);
}

function printSummary(report: Report): void {
  const { metrics } = report;
  console.log(`Retrieval baseline: ${report.candidates} candidates, ${report.tasks} tasks ` +
    `(${metrics.positiveTasks} positive, ${metrics.negativeTasks} negative)`);
  console.log(`recall@5 ${format(metrics.recallAt5)}  recall@10 ${format(metrics.recallAt10)}  ` +
    `full recall@10 ${format(metrics.fullRecallAt10)}  MRR ${format(metrics.mrr)}`);
  console.log(`empty ${format(metrics.emptyResultRate)}  false-positive ${format(metrics.falsePositiveRate)}  ` +
    `mean ${metrics.meanLatencyMs} ms  p95 ${metrics.p95LatencyMs} ms`);

  console.log('By category:');
  for (const [category, values] of Object.entries(report.byCategory).sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`  ${category}: recall@10 ${format(values.recallAt10)}  ` +
      `full recall@10 ${format(values.fullRecallAt10)}  (${values.tasks} tasks)`);
  }

  const issues = report.perTask.filter((task) => {
    if (task.expectNoResult) return task.resultCount > 0;
    return task.expectedSkills.some((_, index) => {
      const rank = task.expectedRanks[index];
      return rank === undefined || rank === null || rank > 10;
    });
  });
  if (issues.length > 0) {
    console.log('Misses:');
    for (const task of issues) {
      if (task.expectNoResult) {
        console.log(`  ${task.id}: expected no result, got ${task.resultCount}`);
        continue;
      }
      const missing = task.expectedSkills.filter((_, index) => task.expectedRanks[index] === null);
      const outside = task.expectedSkills.filter((_, index) => {
        const rank = task.expectedRanks[index];
        return rank !== undefined && rank !== null && rank > 10;
      });
      console.log(`  ${task.id} [${task.category}] query="${task.query}" ` +
        `missing=${missing.join(',') || '-'} outside10=${outside.join(',') || '-'} results=${task.resultCount}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const corpusPath = resolve(repoRoot, options.corpus);
  const corpus = await loadRetrievalCorpus(corpusPath);
  const root = await mkdtemp(join(tmpdir(), 'loom-retrieval-'));

  try {
    const project = join(root, 'project');
    const home = join(root, 'home');
    const config = join(root, 'config');
    await mkdir(join(project, '.agents', 'skills'), { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(config, { recursive: true });

    for (const candidate of corpus.candidates) {
      const source = resolve(repoRoot, candidate.source);
      await cp(source, join(project, '.agents', 'skills', candidate.name), { recursive: true });
    }

    const canonicalProject = await realpath(project);
    const canonicalHome = await realpath(home);
    const canonicalConfig = await realpath(config);
    const configStore = createConfigStore({
      env: { ...process.env, LOOM_CONFIG_DIR: canonicalConfig },
      homeDirectory: () => canonicalHome,
    });
    const service = createCatalogService({
      configStore,
      adapters: createDefaultCatalogAdapters({ homeDirectory: canonicalHome }),
    });

    const outcomes: TaskOutcome[] = [];
    const perTask: TaskReport[] = [];
    for (const task of corpus.tasks) {
      const started = performance.now();
      const response = await service.getCatalog({
        projectPath: canonicalProject,
        harness: task.harness,
        query: task.query,
      });
      const elapsedMs = performance.now() - started;
      const entries = response.groups.flatMap((group) => group.entries);
      const names = entries.map((entry) => entry.name);
      const expectedRanks = task.expectedSkills.map((skill) => rankOfSkill(names, skill));
      outcomes.push({
        id: task.id,
        category: task.category,
        expectNoResult: task.expectNoResult,
        resultCount: entries.length,
        expectedRanks,
        elapsedMs,
      });
      perTask.push({
        id: task.id,
        category: task.category,
        query: task.query,
        outcome: task.outcome,
        expectNoResult: task.expectNoResult,
        resultCount: entries.length,
        expectedSkills: task.expectedSkills,
        expectedRanks,
        topResults: entries.slice(0, 5).map((entry) => ({ name: entry.name, source: entry.source })),
        elapsedMs: Math.round(elapsedMs * 100) / 100,
      });
    }

    const report: Report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      node: process.version,
      corpus: displayPath(options.corpus),
      candidates: corpus.candidates.length,
      tasks: corpus.tasks.length,
      metrics: computeMetrics(outcomes),
      byCategory: computeCategoryMetrics(outcomes),
      perTask,
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;

    if (options.out !== null) {
      const target = resolve(repoRoot, options.out);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, json, 'utf8');
    }
    if (options.json) process.stdout.write(json);
    else printSummary(report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`Retrieval evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
