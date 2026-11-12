import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const RemoteBindingSchema = z.strictObject({
  sourceId: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  revision: z.string().trim().regex(/^[a-f0-9]{40,64}$/),
  repositoryPath: z.string().trim().min(1).max(4_096),
});

const CandidateSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  source: z.string().trim().min(1).max(4_096),
  /** Where the evaluation places the fixture. Remote candidates use a pinned snapshot. */
  location: z.enum(['project', 'personal', 'remote']).default('project'),
  /** Exact pinned snapshot identity for a remote candidate. */
  remote: RemoteBindingSchema.optional(),
}).superRefine((candidate, context) => {
  if (candidate.location === 'remote' && candidate.remote === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'A remote candidate must declare its exact remote binding.',
      path: ['remote'],
    });
  }
  if (candidate.location !== 'remote' && candidate.remote !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Only a remote candidate may declare a remote binding.',
      path: ['remote'],
    });
  }
});

const TaskSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  outcome: z.string().trim().min(1).max(2_000),
  query: z.string().trim().min(1).max(500),
  category: z.enum([
    'description-match', 'body-only', 'compose', 'remote', 'filter', 'metadata', 'negative',
  ]).default('description-match'),
  harness: z.enum(['opencode', 'copilot']).default('opencode'),
  expectedSkills: z.array(z.string().trim().min(1)).max(20).default([]),
  acceptableSkills: z.array(z.string().trim().min(1)).max(20).default([]),
  /** Consumer-side source policy; results outside this list are discarded before ranking. */
  allowedSources: z.array(z.enum([
    'project', 'personal', 'custom', 'plugin', 'builtin', 'loom-extra', 'remote',
  ])).default(['project', 'personal', 'custom', 'plugin', 'builtin', 'loom-extra', 'remote']),
  /** Indexed metadata filters. The scan fallback cannot apply these. */
  tags: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  tools: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  inputs: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  outputs: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  /** Skills that the source policy must remove from the candidate list. */
  excludedSkills: z.array(z.string().trim().min(1)).max(20).default([]),
  /** Exact remote identity each named skill must carry. */
  expectedBindings: z.record(z.string(), RemoteBindingSchema).default({}),
  expectNoResult: z.boolean().default(false),
}).superRefine((task, context) => {
  if (task.expectNoResult && task.expectedSkills.length !== 0) {
    context.addIssue({
      code: 'custom',
      message: 'A negative task must not name expected skills.',
      path: ['expectedSkills'],
    });
  }
  if (!task.expectNoResult && task.expectedSkills.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'A positive task must name at least one expected skill.',
      path: ['expectedSkills'],
    });
  }
  const overlap = task.acceptableSkills.filter((name) => task.expectedSkills.includes(name));
  if (overlap.length > 0) {
    context.addIssue({
      code: 'custom',
      message: `Acceptable skills repeat expected skills: ${overlap.join(', ')}.`,
      path: ['acceptableSkills'],
    });
  }
  const excludedOverlap = task.excludedSkills.filter((name) =>
    task.expectedSkills.includes(name) || task.acceptableSkills.includes(name));
  if (excludedOverlap.length > 0) {
    context.addIssue({
      code: 'custom',
      message: `Excluded skills overlap selected skills: ${excludedOverlap.join(', ')}.`,
      path: ['excludedSkills'],
    });
  }
  for (const name of Object.keys(task.expectedBindings)) {
    if (!task.expectedSkills.includes(name)) {
      context.addIssue({
        code: 'custom',
        message: `An expected binding names "${name}", which is not an expected skill.`,
        path: ['expectedBindings', name],
      });
    }
  }
});

export const RetrievalCorpusSchema = z.strictObject({
  version: z.literal(1),
  description: z.string().trim().min(1),
  candidates: z.array(CandidateSchema).min(1),
  tasks: z.array(TaskSchema).min(1),
}).superRefine((corpus, context) => {
  const names = new Map<string, z.infer<typeof CandidateSchema>>();
  corpus.candidates.forEach((candidate, index) => {
    if (names.has(candidate.name)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate candidate skill "${candidate.name}".`,
        path: ['candidates', index, 'name'],
      });
    }
    names.set(candidate.name, candidate);
  });
  const ids = new Set<string>();
  corpus.tasks.forEach((task, index) => {
    if (ids.has(task.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate task id "${task.id}".`,
        path: ['tasks', index, 'id'],
      });
    }
    ids.add(task.id);
    for (const skill of [
      ...task.expectedSkills,
      ...task.acceptableSkills,
      ...task.excludedSkills,
    ]) {
      if (!names.has(skill)) {
        context.addIssue({
          code: 'custom',
          message: `Task "${task.id}" names an unknown candidate skill "${skill}".`,
          path: ['tasks', index, 'expectedSkills'],
        });
      }
    }
    for (const [skill, binding] of Object.entries(task.expectedBindings)) {
      const candidate = names.get(skill);
      if (candidate?.remote === undefined) {
        context.addIssue({
          code: 'custom',
          message: `Task "${task.id}" expects a remote binding for non-remote skill "${skill}".`,
          path: ['tasks', index, 'expectedBindings', skill],
        });
        continue;
      }
      if (candidate.remote.sourceId !== binding.sourceId ||
          candidate.remote.revision !== binding.revision ||
          candidate.remote.repositoryPath !== binding.repositoryPath) {
        context.addIssue({
          code: 'custom',
          message: `Task "${task.id}" expects a binding that does not match the candidate "${skill}".`,
          path: ['tasks', index, 'expectedBindings', skill],
        });
      }
    }
  });
});

export type RetrievalCorpus = z.infer<typeof RetrievalCorpusSchema>;
export type RetrievalTask = RetrievalCorpus['tasks'][number];
export type RetrievalCandidate = RetrievalCorpus['candidates'][number];
export type RetrievalRemoteBinding = z.infer<typeof RemoteBindingSchema>;

export async function loadRetrievalCorpus(path: string): Promise<RetrievalCorpus> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`The retrieval corpus is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = RetrievalCorpusSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`The retrieval corpus is invalid: ${details}`);
  }
  return result.data;
}
