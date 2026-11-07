import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ChainBundle } from '../shared/bundles.js';
import { frontmatterString, parseSkillFrontmatter } from '../server/catalog/frontmatter.js';
import {
  CHAIN_VERSION,
  ChainAgentSelectionSchema,
  ChainSchema,
  parseChain,
  type Chain,
} from '../server/chains/model.js';

export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
export const MAX_BUNDLE_FILES = 2_000;
export const MAX_BUNDLE_SKILLS = 100;
export const MAX_BUNDLE_REQUEST_BYTES = 30 * 1024 * 1024;

export class BundleError extends Error {
  constructor(
    readonly code: 'BUNDLE_INVALID' | 'BUNDLE_CONFLICT' | 'BUNDLE_SOURCE_UNAVAILABLE' | 'BUNDLE_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'BundleError';
  }
}

const forbiddenSegments = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i;
const fileSchema = z.strictObject({
  path: z.string().min(1).max(512),
  content: z.string().max(Math.ceil(MAX_BUNDLE_BYTES / 3) * 4),
  executable: z.boolean(),
});
const bundleSchema = z.strictObject({
  format: z.literal('skill-loom-chain'),
  version: z.literal(1),
  chain: z.strictObject({
    name: ChainSchema.shape.name,
    harness: ChainSchema.shape.harness,
    sessionMode: ChainSchema.shape.sessionMode,
    steps: ChainSchema.shape.steps,
    inputs: ChainSchema.shape.inputs,
  }),
  skills: z.array(z.strictObject({
    name: z.string().trim().min(1).max(128),
    directory: z.string().min(1).max(128).regex(/^[^/\\]+$/),
    files: z.array(fileSchema).min(1).max(MAX_BUNDLE_FILES),
  })).max(MAX_BUNDLE_SKILLS),
});
const nativeAgentSchema = z.strictObject({
  name: z.string().trim().min(1).max(128),
  harness: ChainSchema.shape.harness,
  agentPath: z.string().min(1).max(512),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().max(Math.ceil(MAX_BUNDLE_BYTES / 3) * 4),
});
const bundleV2Schema = z.strictObject({
  format: z.literal('skill-loom-chain'),
  version: z.literal(2),
  chain: z.strictObject({
    name: ChainSchema.shape.name,
    harness: ChainSchema.shape.harness,
    sessionMode: ChainSchema.shape.sessionMode,
    steps: ChainSchema.shape.steps,
    inputs: ChainSchema.shape.inputs,
    agent: ChainAgentSelectionSchema.optional(),
  }),
  skills: z.array(z.strictObject({
    name: z.string().trim().min(1).max(128),
    directory: z.string().min(1).max(128).regex(/^[^/\\]+$/),
    files: z.array(fileSchema).min(1).max(MAX_BUNDLE_FILES),
  })).max(MAX_BUNDLE_SKILLS),
  agents: z.array(nativeAgentSchema).max(1),
});

function invalid(message: string): never {
  throw new BundleError('BUNDLE_INVALID', message);
}

export function validatePackagePath(path: string): void {
  const parts = path.split('/');
  if (parts.length > 32 || parts.some((part) =>
    part === '.' || part === '..' || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(part) ||
    /[. ]$/.test(part) || forbiddenSegments.test(part) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    invalid('The bundle contains an unsafe or excluded package path.');
  }
}

export function decodeBundleFile(content: string): Buffer {
  if (content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(content)) {
    invalid('Package file contents must be canonical base64.');
  }
  const decoded = Buffer.from(content, 'base64');
  if (decoded.toString('base64') !== content) invalid('Package file contents are not canonical base64.');
  return decoded;
}

export function bundleSkillNames(chain: Pick<Chain, 'steps'>): string[] {
  return [...new Set(chain.steps.flatMap((step) =>
    'skillName' in step && typeof step.skillName === 'string' ? [step.skillName] : []))];
}

export function chainFromBundle(bundle: ChainBundle): Chain {
  const agent = bundle.version === 2 ? bundle.chain.agent : undefined;
  return parseChain({
    ...bundle.chain,
    ...(agent === undefined ? {} : { agent }),
    version: CHAIN_VERSION,
    id: 'portable-bundle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    automaticPermissionOptIn: false,
  });
}

export function parseBundle(raw: unknown): ChainBundle {
  const version = isRecord(raw) ? raw.version : undefined;
  const parsed = version === 1
    ? bundleSchema.safeParse(raw)
    : version === 2
      ? bundleV2Schema.safeParse(raw)
      : null;
  if (parsed === null) invalid('The file is not a supported Skill Loom chain bundle.');
  if (!parsed.success) invalid('The file is not a supported Skill Loom chain bundle.');
  const bundle = parsed.data;
  const chain = chainFromBundle(bundle);
  const expected = new Set(bundleSkillNames(chain));
  const names = new Set<string>();
  const directories = new Set<string>();
  let bytes = 0;
  let files = 0;
  for (const skill of bundle.skills) {
    validatePackagePath(skill.directory);
    const directoryKey = skill.directory.toLowerCase();
    if (names.has(skill.name) || directories.has(directoryKey) || !expected.has(skill.name)) {
      invalid('The bundle contains duplicate or unreferenced skill packages.');
    }
    names.add(skill.name);
    directories.add(directoryKey);
    const paths = new Set<string>();
    for (const file of skill.files) {
      validatePackagePath(file.path);
      const key = file.path.toLowerCase();
      if (paths.has(key)) invalid('The bundle contains duplicate package file paths.');
      paths.add(key);
      bytes += decodeBundleFile(file.content).length;
      files += 1;
      if (bytes > MAX_BUNDLE_BYTES || files > MAX_BUNDLE_FILES) {
        throw new BundleError('BUNDLE_TOO_LARGE', 'Bundles are limited to 20 MiB and 2,000 files.');
      }
    }
    for (const path of paths) {
      const segments = path.split('/');
      while (segments.length > 1) {
        segments.pop();
        if (paths.has(segments.join('/'))) invalid('A package file conflicts with a directory.');
      }
    }
    const entry = skill.files.find((file) => file.path === 'SKILL.md');
    if (!entry) invalid('Each skill package must include SKILL.md.');
    let name: string;
    try {
      name = frontmatterString(parseSkillFrontmatter(decodeBundleFile(entry.content).toString('utf8')).data, 'name') ??
        skill.directory;
    } catch {
      invalid('A bundled SKILL.md has invalid frontmatter.');
    }
    if (name !== skill.name) invalid('A bundled skill name does not match its SKILL.md or directory.');
  }
  if (names.size !== expected.size) invalid('The bundle is missing a referenced skill package.');
  if (bundle.version === 2) {
    const selection = bundle.chain.agent;
    if ((selection === undefined) !== (bundle.agents.length === 0)) {
      invalid('The bundle agent inventory does not match the selected native agent.');
    }
    if (selection !== undefined) {
      const agent = bundle.agents[0];
      if (
        agent === undefined ||
        agent.name !== selection.name ||
        agent.harness !== selection.harness ||
        agent.agentPath !== selection.agentPath ||
        agent.fingerprint !== selection.fingerprint ||
        !isSafeBundledAgentPath(agent.agentPath, agent.harness)
      ) {
        invalid('The bundled native agent does not match the chain selection.');
      }
      const content = decodeBundleFile(agent.content);
      bytes += content.length;
      files += 1;
      if (bytes > MAX_BUNDLE_BYTES || files > MAX_BUNDLE_FILES) {
        throw new BundleError('BUNDLE_TOO_LARGE', 'Bundles are limited to 20 MiB and 2,000 files.');
      }
      if (createHash('sha256').update(content).digest('hex') !== agent.fingerprint) {
        invalid('The bundled native agent fingerprint does not match its content.');
      }
    }
  }
  return bundle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeBundledAgentPath(path: string, harness: Chain['harness']): boolean {
  const segments = path.split('/');
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    segments.some((segment) =>
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(segment) ||
      /[. ]$/.test(segment) ||
      forbiddenSegments.test(segment) ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment),
    )
  ) {
    return false;
  }
  return harness === 'opencode' ? path.endsWith('.md') : path.endsWith('.agent.md');
}
