import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const CandidateSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  source: z.string().trim().min(1).max(4_096),
});

const TaskSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  outcome: z.string().trim().min(1).max(2_000),
  query: z.string().trim().min(1).max(500),
  category: z.enum(['description-match', 'body-only', 'compose', 'negative']).default('description-match'),
  harness: z.enum(['opencode', 'copilot']).default('opencode'),
  expectedSkills: z.array(z.string().trim().min(1)).max(20).default([]),
  acceptableSkills: z.array(z.string().trim().min(1)).max(20).default([]),
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
});

export const RetrievalCorpusSchema = z.strictObject({
  version: z.literal(1),
  description: z.string().trim().min(1),
  candidates: z.array(CandidateSchema).min(1),
  tasks: z.array(TaskSchema).min(1),
}).superRefine((corpus, context) => {
  const names = new Set<string>();
  corpus.candidates.forEach((candidate, index) => {
    if (names.has(candidate.name)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate candidate skill "${candidate.name}".`,
        path: ['candidates', index, 'name'],
      });
    }
    names.add(candidate.name);
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
    for (const skill of [...task.expectedSkills, ...task.acceptableSkills]) {
      if (!names.has(skill)) {
        context.addIssue({
          code: 'custom',
          message: `Task "${task.id}" names an unknown candidate skill "${skill}".`,
          path: ['tasks', index, 'expectedSkills'],
        });
      }
    }
  });
});

export type RetrievalCorpus = z.infer<typeof RetrievalCorpusSchema>;
export type RetrievalTask = RetrievalCorpus['tasks'][number];

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
