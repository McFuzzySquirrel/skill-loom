#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_QUERY_BUDGET_MS,
  catalogCapabilityFallback,
  collectCapabilityPackages,
  collectRemoteCapabilityPackages,
  createCapabilitySearchService,
  defaultCapabilitySourceRoots,
  type CapabilitySearchService,
} from '../src/server/catalog/capability-index.js';
import { createCatalogService, createDefaultCatalogAdapters, type CatalogService } from '../src/server/catalog/merge.js';
import {
  snapshotPackageFingerprint,
  snapshotReviewFingerprint,
} from '../src/server/catalog/snapshot-fingerprint.js';
import type { SkillEntry, SkillSource } from '../src/server/catalog/types.js';
import { createConfigStore } from '../src/server/config/store.js';
import {
  loadRetrievalCorpus,
  type RetrievalCandidate,
  type RetrievalCorpus,
  type RetrievalRemoteBinding,
  type RetrievalTask,
} from './retrieval-corpus.js';
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
const REMOTE_REPOSITORY = 'https://example.invalid/eval-remote.git';

type EvaluationMode = 'scan' | 'index';
type RunMode = EvaluationMode | 'compare';

interface Options {
  corpus: string;
  json: boolean;
  out: string | null;
  mode: RunMode;
}

interface EvaluatedEntry {
  name: string;
  source: SkillSource;
  sourceId?: string;
  revision?: string;
  repositoryPath?: string;
}

interface TaskReport {
  id: string;
  category: string;
  query: string;
  outcome: string;
  expectNoResult: boolean;
  resultCount: number;
  allowedSources: string[];
  filters: {
    tags: string[];
    tools: string[];
    inputs: string[];
    outputs: string[];
  };
  expectedSkills: string[];
  expectedRanks: Array<number | null>;
  precisionAt10: number;
  excludedSkills: string[];
  excludedPresent: string[];
  bindings: Array<{
    skill: string;
    expected: RetrievalRemoteBinding;
    actual: RetrievalRemoteBinding | null;
    correct: boolean;
  }>;
  retrieval: { mode: EvaluationMode; reason?: string };
  topResults: Array<{ name: string; source: string }>;
  elapsedMs: number;
}

interface ModeReport {
  mode: EvaluationMode;
  buildMs: number;
  metrics: RetrievalMetrics;
  byCategory: Record<string, CategoryMetrics>;
  perTask: TaskReport[];
}

interface Comparison {
  recallAt5Delta: number;
  recallAt10Delta: number;
  fullRecallAt10Delta: number;
  precisionAt10Delta: number;
  mrrDelta: number;
  emptyResultRateDelta: number;
  p95LatencyMsDelta: number;
  meetsExitCriteria: {
    candidateRecallImproved: boolean;
    candidatePrecisionImproved: boolean;
    emptyResultRateNotWorse: boolean;
    bindingAccuracyComplete: boolean;
    excludedPolicyHeld: boolean;
    p95WithinBudget: boolean;
  };
}

interface Report {
  version: 2;
  generatedAt: string;
  node: string;
  corpus: string;
  candidates: number;
  tasks: number;
  modes: ModeReport[];
  comparison?: Comparison;
}

interface EvaluationContext {
  project: string;
  catalog: CatalogService;
  capability: CapabilitySearchService;
  corpus: RetrievalCorpus;
}

function usage(): string {
  return [
    'Usage: npm run eval:retrieval -- [--corpus <path>] [--mode scan|index|compare] [--json] [--out <path>]',
    '',
    'Runs the chain-authoring retrieval corpus against the current catalog scan and,',
    'when selected, the derived capability index. It copies the corpus candidates into',
    'a temporary project, publishes remote fixtures as pinned snapshots, makes no',
    'model calls or network requests, and reports recall, precision, MRR, empty',
    'results, false positives, exact remote bindings, source and metadata',
    'filters, and latency.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Options {
  let corpus = DEFAULT_CORPUS;
  let json = false;
  let out: string | null = null;
  let mode: RunMode = 'compare';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--corpus' || argument === '--out' || argument === '--mode') {
      const value = argv[index + 1];
      if (value === undefined || value.trim() === '') throw new Error(`${argument} requires a value.`);
      if (argument === '--corpus') corpus = value;
      else if (argument === '--out') out = value;
      else if (value === 'scan' || value === 'index' || value === 'compare') mode = value;
      else throw new Error(`Unknown mode "${value}". Use scan, index, or compare.`);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument "${argument}".\n\n${usage()}`);
  }
  return { corpus, json, out, mode };
}

function displayPath(path: string): string {
  return isAbsolute(path) ? relative(repoRoot, path) : path;
}

function format(value: number): string {
  return value.toFixed(3);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function printMode(report: ModeReport): void {
  const { metrics } = report;
  const build = report.mode === 'index' ? `  build ${report.buildMs} ms` : '';
  console.log(`${report.mode.padEnd(5)} recall@5 ${format(metrics.recallAt5)}  ` +
    `recall@10 ${format(metrics.recallAt10)}  full recall@10 ${format(metrics.fullRecallAt10)}  ` +
    `precision@10 ${format(metrics.precisionAt10)}  MRR ${format(metrics.mrr)}  ` +
    `empty ${format(metrics.emptyResultRate)}  ` +
    `false-positive ${format(metrics.falsePositiveRate)}  ` +
    `mean ${metrics.meanLatencyMs} ms  p95 ${metrics.p95LatencyMs} ms${build}`);
  if (metrics.bindingCases > 0) {
    console.log(`      binding accuracy ${format(metrics.bindingAccuracy)} (${metrics.bindingCases} cases)  ` +
      `excluded violations ${format(metrics.excludedViolationRate)} (${metrics.excludedCases} cases)  ` +
      `fallbacks ${metrics.fallbackCount}`);
  }
  console.log('      By category:');
  for (const [category, values] of Object.entries(report.byCategory).sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`        ${category}: recall@10 ${format(values.recallAt10)}  ` +
      `full recall@10 ${format(values.fullRecallAt10)}  (${values.tasks} tasks)`);
  }
}

function printMisses(report: ModeReport): void {
  const issues = report.perTask.filter((task) => {
    if (task.expectNoResult) return task.resultCount > 0;
    if (task.excludedPresent.length > 0) return true;
    if (task.bindings.some((binding) => !binding.correct)) return true;
    return task.expectedSkills.some((_, index) => {
      const rank = task.expectedRanks[index];
      return rank === undefined || rank === null || rank > 10;
    });
  });
  if (issues.length === 0) return;
  console.log(`      Misses (${report.mode}):`);
  for (const task of issues) {
    if (task.expectNoResult) {
      console.log(`        ${task.id}: expected no result, got ${task.resultCount}`);
      continue;
    }
    const missing = task.expectedSkills.filter((_, index) => task.expectedRanks[index] === null);
    const outside = task.expectedSkills.filter((_, index) => {
      const rank = task.expectedRanks[index];
      return rank !== undefined && rank !== null && rank > 10;
    });
    const bindingMisses = task.bindings.filter((binding) => !binding.correct).map((binding) => binding.skill);
    console.log(`        ${task.id} [${task.category}] query="${task.query}" ` +
      `missing=${missing.join(',') || '-'} outside10=${outside.join(',') || '-'} ` +
      `excluded=${task.excludedPresent.join(',') || '-'} bindings=${bindingMisses.join(',') || '-'} ` +
      `results=${task.resultCount} retrieval=${task.retrieval.mode}`);
  }
}

function printComparison(comparison: Comparison): void {
  const criteria = comparison.meetsExitCriteria;
  console.log('Comparison (index - scan):');
  console.log(`  recall@5 ${format(comparison.recallAt5Delta)}  ` +
    `recall@10 ${format(comparison.recallAt10Delta)}  ` +
    `full recall@10 ${format(comparison.fullRecallAt10Delta)}  ` +
    `precision@10 ${format(comparison.precisionAt10Delta)}  ` +
    `MRR ${format(comparison.mrrDelta)}  ` +
    `empty ${format(comparison.emptyResultRateDelta)}  ` +
    `p95 ${format(comparison.p95LatencyMsDelta)} ms`);
  const failed = Object.entries(criteria).filter(([, passed]) => !passed).map(([name]) => name);
  console.log(`  exit criteria: ${failed.length === 0 ? 'met' : `unmet (${failed.join(', ')})`}`);
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
    await mkdir(join(home, '.agents', 'skills'), { recursive: true });
    await mkdir(config, { recursive: true });

    const remoteSources = await prepareCandidates(corpus, project, home, config);

    const canonicalProject = await realpath(project);
    const canonicalHome = await realpath(home);
    const canonicalConfig = await realpath(config);
    const configStore = createConfigStore({
      env: { ...process.env, LOOM_CONFIG_DIR: canonicalConfig },
      homeDirectory: () => canonicalHome,
    });
    const catalog = createCatalogService({
      configStore,
      adapters: createDefaultCatalogAdapters({ homeDirectory: canonicalHome }),
    });
    const capability = createCapabilitySearchService({
      enabled: true,
      index: { directory: canonicalConfig },
      sources: async ({ projectPath, harness }) => {
        if (harness !== 'opencode') return { roots: [], packages: [], warnings: [] };
        const local = await collectCapabilityPackages(defaultCapabilitySourceRoots({
          projectPath,
          harness,
          homeDirectory: canonicalHome,
          includeBundled: false,
        }));
        const remote = await collectRemoteCapabilityPackages({
          configDirectory: canonicalConfig,
          sources: remoteSources,
          harness,
        });
        return {
          roots: local.roots,
          packages: [...local.packages, ...remote.packages],
          warnings: [...local.warnings, ...remote.warnings],
        };
      },
      fallback: catalogCapabilityFallback(catalog),
    });

    const context: EvaluationContext = {
      project: canonicalProject, catalog, capability, corpus,
    };
    const modes: EvaluationMode[] = options.mode === 'compare'
      ? ['scan', 'index']
      : [options.mode];
    const reports: ModeReport[] = [];
    for (const mode of modes) reports.push(await runMode(mode, context));

    const comparison = options.mode === 'compare'
      ? compare(reports[0]!, reports[1]!)
      : undefined;
    const report: Report = {
      version: 2,
      generatedAt: new Date().toISOString(),
      node: process.version,
      corpus: displayPath(options.corpus),
      candidates: corpus.candidates.length,
      tasks: corpus.tasks.length,
      modes: reports,
      ...(comparison === undefined ? {} : { comparison }),
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;

    if (options.out !== null) {
      const target = resolve(repoRoot, options.out);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, json, 'utf8');
    }
    if (options.json) {
      process.stdout.write(json);
    } else {
      console.log(`Retrieval evaluation: ${report.candidates} candidates, ${report.tasks} tasks`);
      for (const modeReport of reports) {
        printMode(modeReport);
        printMisses(modeReport);
      }
      if (comparison !== undefined) printComparison(comparison);
    }
    await capability.dispose({ deleteIndex: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runMode(mode: EvaluationMode, context: EvaluationContext): Promise<ModeReport> {
  let buildMs = 0;
  if (mode === 'index') {
    const started = performance.now();
    await context.capability.search({
      harness: 'opencode', projectPath: context.project, query: '__eval_warm__', offset: 0, limit: 1,
    });
    buildMs = Math.round((performance.now() - started) * 100) / 100;
  }

  const outcomes: TaskOutcome[] = [];
  const perTask: TaskReport[] = [];
  for (const task of context.corpus.tasks) {
    const started = performance.now();
    let entries: EvaluatedEntry[];
    let resultMode: EvaluationMode = 'scan';
    let reason: string | undefined;
    if (mode === 'index') {
      const response = await context.capability.search({
        harness: task.harness, projectPath: context.project, query: task.query, offset: 0, limit: 10,
        sources: task.allowedSources,
        tags: task.tags,
        tools: task.tools,
        inputs: task.inputs,
        outputs: task.outputs,
      });
      entries = response.candidates.map((candidate) => ({
        name: candidate.name,
        source: candidate.source,
        ...(candidate.sourceId === undefined ? {} : { sourceId: candidate.sourceId }),
        ...(candidate.revision === undefined ? {} : { revision: candidate.revision }),
        ...(candidate.repositoryPath === undefined ? {} : { repositoryPath: candidate.repositoryPath }),
      }));
      resultMode = response.mode;
      reason = response.reason;
    } else {
      const response = await context.catalog.getCatalog({
        projectPath: context.project, harness: task.harness, query: task.query,
      });
      entries = response.groups.flatMap((group) => group.entries).map(scanEntry);
    }
    const elapsedMs = performance.now() - started;
    const allowed = entries.filter((entry) => task.allowedSources.includes(entry.source));
    const names = allowed.map((entry) => entry.name);
    const expectedRanks = task.expectedSkills.map((skill) => rankOfSkill(names, skill));
    const excludedPresent = task.excludedSkills.filter((skill) => names.includes(skill));
    const bindings = bindingChecks(task, allowed);
    const relevant = new Set([...task.expectedSkills, ...task.acceptableSkills]);
    const top = allowed.slice(0, 10);
    const relevantTopCount = top.filter((entry) => relevant.has(entry.name)).length;
    const precisionAt10 = relevantTopCount / Math.max(1, top.length);
    outcomes.push({
      id: task.id,
      category: task.category,
      expectNoResult: task.expectNoResult,
      resultCount: allowed.length,
      expectedRanks,
      elapsedMs,
      topCount: top.length,
      relevantTopCount,
      bindingCases: bindings.length,
      bindingCorrect: bindings.filter((binding) => binding.correct).length,
      excludedCases: task.excludedSkills.length,
      excludedPresent: excludedPresent.length,
      fallback: mode === 'index' && resultMode === 'scan',
    });
    perTask.push({
      id: task.id,
      category: task.category,
      query: task.query,
      outcome: task.outcome,
      expectNoResult: task.expectNoResult,
      resultCount: allowed.length,
      allowedSources: [...task.allowedSources],
      filters: {
        tags: [...task.tags],
        tools: [...task.tools],
        inputs: [...task.inputs],
        outputs: [...task.outputs],
      },
      expectedSkills: task.expectedSkills,
      expectedRanks,
      precisionAt10: Math.round(precisionAt10 * 10_000) / 10_000,
      excludedSkills: [...task.excludedSkills],
      excludedPresent,
      bindings,
      retrieval: { mode: resultMode, ...(reason === undefined ? {} : { reason }) },
      topResults: allowed.slice(0, 5).map((entry) => ({ name: entry.name, source: entry.source })),
      elapsedMs: Math.round(elapsedMs * 100) / 100,
    });
  }

  return {
    mode,
    buildMs,
    metrics: computeMetrics(outcomes),
    byCategory: computeCategoryMetrics(outcomes),
    perTask,
  };
}

function scanEntry(entry: SkillEntry): EvaluatedEntry {
  return {
    name: entry.name,
    source: entry.source,
    ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
    ...(entry.revision === undefined ? {} : { revision: entry.revision }),
    ...(entry.repositoryPath === undefined ? {} : { repositoryPath: entry.repositoryPath }),
  };
}

function bindingChecks(task: RetrievalTask, entries: readonly EvaluatedEntry[]) {
  return Object.entries(task.expectedBindings).map(([skill, expected]) => {
    const found = entries.find((entry) => entry.name === skill);
    const actual: RetrievalRemoteBinding | null = found === undefined ||
      found.sourceId === undefined || found.revision === undefined || found.repositoryPath === undefined
      ? null
      : {
        sourceId: found.sourceId,
        revision: found.revision,
        repositoryPath: found.repositoryPath,
      };
    return {
      skill,
      expected,
      actual,
      correct: actual !== null &&
        actual.sourceId === expected.sourceId &&
        actual.revision === expected.revision &&
        actual.repositoryPath === expected.repositoryPath,
    };
  });
}

function compare(scan: ModeReport, index: ModeReport): Comparison {
  return {
    recallAt5Delta: round(index.metrics.recallAt5 - scan.metrics.recallAt5),
    recallAt10Delta: round(index.metrics.recallAt10 - scan.metrics.recallAt10),
    fullRecallAt10Delta: round(index.metrics.fullRecallAt10 - scan.metrics.fullRecallAt10),
    precisionAt10Delta: round(index.metrics.precisionAt10 - scan.metrics.precisionAt10),
    mrrDelta: round(index.metrics.mrr - scan.metrics.mrr),
    emptyResultRateDelta: round(index.metrics.emptyResultRate - scan.metrics.emptyResultRate),
    p95LatencyMsDelta: round(index.metrics.p95LatencyMs - scan.metrics.p95LatencyMs),
    meetsExitCriteria: {
      candidateRecallImproved: index.metrics.recallAt10 > scan.metrics.recallAt10 ||
        index.metrics.fullRecallAt10 > scan.metrics.fullRecallAt10,
      candidatePrecisionImproved: index.metrics.precisionAt10 > scan.metrics.precisionAt10,
      emptyResultRateNotWorse: index.metrics.emptyResultRate <= scan.metrics.emptyResultRate,
      bindingAccuracyComplete: index.metrics.bindingAccuracy === 1,
      excludedPolicyHeld: index.metrics.excludedViolationRate === 0,
      p95WithinBudget: index.metrics.p95LatencyMs <= CAPABILITY_QUERY_BUDGET_MS,
    },
  };
}

async function prepareCandidates(
  corpus: RetrievalCorpus,
  project: string,
  home: string,
  config: string,
): Promise<Array<{ id: string; repository: string }>> {
  const remoteSources = new Map<string, { id: string; repository: string }>();
  for (const candidate of corpus.candidates) {
    const source = resolve(repoRoot, candidate.source);
    if (candidate.location === 'project') {
      await cp(source, join(project, '.agents', 'skills', candidate.name), { recursive: true });
      continue;
    }
    if (candidate.location === 'personal') {
      await cp(source, join(home, '.agents', 'skills', candidate.name), { recursive: true });
      continue;
    }
    await publishRemoteCandidate(candidate, config);
    const remote = candidate.remote!;
    remoteSources.set(remote.sourceId, { id: remote.sourceId, repository: REMOTE_REPOSITORY });
  }
  return [...remoteSources.values()];
}

async function publishRemoteCandidate(candidate: RetrievalCandidate, config: string): Promise<void> {
  const remote = candidate.remote;
  if (remote === undefined) throw new Error(`Remote candidate "${candidate.name}" has no binding.`);
  const directory = createHash('sha256').update(remote.repositoryPath).digest('hex');
  const snapshotRoot = join(config, 'catalog-sources', remote.sourceId, remote.revision);
  const packageRoot = join(snapshotRoot, 'packages', directory);
  await cp(resolve(repoRoot, candidate.source), packageRoot, { recursive: true });
  const files = await readPackageFiles(packageRoot);
  const bytes = files.reduce((sum, file) => sum + file.content.byteLength, 0);
  const fingerprint = snapshotPackageFingerprint(files);
  const reviewFingerprint = snapshotReviewFingerprint(files);
  const manifest = {
    version: 1,
    sourceId: remote.sourceId,
    repository: REMOTE_REPOSITORY,
    revision: remote.revision,
    packages: [{
      name: candidate.name,
      description: '',
      repositoryPath: remote.repositoryPath,
      directory,
      files: files.length,
      bytes,
      fingerprint,
    }],
    agents: [],
  };
  await writeFile(join(snapshotRoot, 'snapshot.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await mkdir(join(snapshotRoot, 'modes'), { recursive: true });
  await writeFile(join(snapshotRoot, 'modes', `${directory}.json`), `${JSON.stringify({
    version: 1,
    executablePaths: files.filter((file) => file.executable).map((file) => file.path),
  })}\n`, 'utf8');
  await writeFile(join(snapshotRoot, 'modes', `${directory}.review.json`), `${JSON.stringify({
    version: 1,
    fingerprint: reviewFingerprint,
  })}\n`, 'utf8');
}

async function readPackageFiles(root: string): Promise<Array<{
  path: string;
  content: Buffer;
  executable: boolean;
}>> {
  const files: Array<{ path: string; content: Buffer; executable: boolean }> = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (info.isSymbolicLink()) throw new Error(`Remote fixture contains a symlink: ${relativePath}`);
      if (info.isDirectory()) {
        await visit(path, relativePath);
        continue;
      }
      if (!info.isFile()) throw new Error(`Remote fixture contains a non-regular file: ${relativePath}`);
      files.push({
        path: relativePath,
        content: await readFile(path),
        executable: process.platform !== 'win32' && (info.mode & 0o111) !== 0,
      });
    }
  }
  await visit(root, '');
  return files;
}

main().catch((error: unknown) => {
  console.error(`Retrieval evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
