import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { BundlePreview, BundleSkill, ChainBundle } from '../../shared/bundles.js';
import { projectSkillRootFor } from '../catalog/copy.js';
import { frontmatterString, parseSkillFrontmatter } from '../catalog/frontmatter.js';
import type { CatalogService } from '../catalog/merge.js';
import { ChainSchema, parseChain, type Chain } from './model.js';
import type { ChainService } from './service.js';

export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
export const MAX_BUNDLE_FILES = 2_000;
export const MAX_BUNDLE_REQUEST_BYTES = 30 * 1024 * 1024;
const MAX_BUNDLE_SKILLS = 100;

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

function invalid(message: string): never {
  throw new BundleError('BUNDLE_INVALID', message);
}

function validatePath(path: string): void {
  const parts = path.split('/');
  if (parts.length > 32 || parts.some((part) =>
    part === '.' || part === '..' || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(part) ||
    /[. ]$/.test(part) || forbiddenSegments.test(part) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    invalid('The bundle contains an unsafe or excluded package path.');
  }
}

function decodeFile(content: string): Buffer {
  if (content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(content)) {
    invalid('Package file contents must be canonical base64.');
  }
  const decoded = Buffer.from(content, 'base64');
  if (decoded.toString('base64') !== content) invalid('Package file contents are not canonical base64.');
  return decoded;
}

function skillNames(chain: Pick<Chain, 'steps'>): string[] {
  return [...new Set(chain.steps.flatMap((step) =>
    'skillName' in step && typeof step.skillName === 'string' ? [step.skillName] : []))];
}

function bundleChain(bundle: ChainBundle): Chain {
  return parseChain({
    ...bundle.chain,
    version: 1,
    id: 'bundle-preview',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    automaticPermissionOptIn: false,
  });
}

export function parseBundle(raw: unknown): ChainBundle {
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) invalid('The file is not a supported Skill Loom chain bundle.');
  const bundle = parsed.data;
  const chain = bundleChain(bundle);
  const expected = new Set(skillNames(chain));
  const names = new Set<string>();
  const directories = new Set<string>();
  let bytes = 0;
  let files = 0;
  for (const skill of bundle.skills) {
    validatePath(skill.directory);
    const directoryKey = skill.directory.toLowerCase();
    if (names.has(skill.name) || directories.has(directoryKey) || !expected.has(skill.name)) {
      invalid('The bundle contains duplicate or unreferenced skill packages.');
    }
    names.add(skill.name);
    directories.add(directoryKey);
    const paths = new Set<string>();
    for (const file of skill.files) {
      validatePath(file.path);
      const key = file.path.toLowerCase();
      if (paths.has(key)) invalid('The bundle contains duplicate package file paths.');
      paths.add(key);
      bytes += decodeFile(file.content).length;
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
      name = frontmatterString(parseSkillFrontmatter(decodeFile(entry.content).toString('utf8')).data, 'name') ??
        skill.directory;
    } catch {
      invalid('A bundled SKILL.md has invalid frontmatter.');
    }
    if (name !== skill.name) invalid('A bundled skill name does not match its SKILL.md or directory.');
  }
  if (names.size !== expected.size) invalid('The bundle is missing a referenced skill package.');
  return bundle;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false;
    throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export async function exportBundle(
  chain: Chain,
  projectPath: string,
  catalog: CatalogService,
): Promise<ChainBundle> {
  const names = skillNames(chain);
  if (names.length > MAX_BUNDLE_SKILLS) {
    throw new BundleError('BUNDLE_TOO_LARGE', 'Bundles are limited to 100 skill packages.');
  }
  const entries = names.length === 0 ? [] :
    (await catalog.getCatalog({ projectPath, harness: chain.harness })).groups.flatMap((group) => group.entries);
  const skills: BundleSkill[] = [];
  const budget = { bytes: 0, files: 0 };
  for (const name of names) {
    const matches = entries.filter((entry) => entry.enabled && entry.name === name);
    if (matches.length !== 1 || !matches[0]?.packagePath) {
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `Skill "${name}" must resolve to exactly one available package before export.`);
    }
    const source = matches[0].packagePath;
    const skill: BundleSkill = { name, directory: basename(source), files: [] };
    async function collect(directory: string, prefix: string, depth: number): Promise<void> {
      if (depth > 32) invalid('The skill package exceeds the directory depth limit.');
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = prefix + entry.name;
        validatePath(path);
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
          await collect(absolute, `${path}/`, depth + 1);
        } else if (entry.isFile()) {
          const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const info = await handle.stat();
            budget.bytes += info.size;
            budget.files += 1;
            if (!info.isFile()) invalid('Only regular package files can be exported.');
            if (budget.bytes > MAX_BUNDLE_BYTES || budget.files > MAX_BUNDLE_FILES) {
              throw new BundleError('BUNDLE_TOO_LARGE', 'Bundles are limited to 20 MiB and 2,000 files.');
            }
            const content = Buffer.alloc(info.size + 1);
            const { bytesRead } = await handle.read(content, 0, content.length, 0);
            if (bytesRead !== info.size) invalid('A package changed during export. Retry after editing finishes.');
            skill.files.push({ path, content: content.subarray(0, bytesRead).toString('base64'), executable: (info.mode & 0o111) !== 0 });
          } finally {
            await handle.close();
          }
        } else {
          invalid('Export refuses symbolic links and special files in skill packages.');
        }
      }
    }
    try {
      if (!(await lstat(source)).isDirectory() || await realpath(source) !== source) {
        invalid('Export refuses symbolic links in skill package paths.');
      }
      await collect(source, '', 0);
    } catch (error) {
      if (error instanceof BundleError) throw error;
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `The complete package for skill "${name}" could not be read. Check its files and permissions, then retry.`);
    }
    skills.push(skill);
  }
  return parseBundle({
    format: 'skill-loom-chain',
    version: 1,
    chain: {
      name: chain.name,
      harness: chain.harness,
      sessionMode: chain.sessionMode,
      steps: chain.steps,
      inputs: chain.inputs.map(({ defaultValue: _defaultValue, ...input }) => input),
    },
    skills,
  });
}

export async function previewBundle(
  raw: unknown,
  projectPath: string,
  catalog: CatalogService,
): Promise<BundlePreview> {
  const bundle = parseBundle(raw);
  const entries = bundle.skills.length === 0 ? [] :
    (await catalog.getCatalog({ projectPath, harness: bundle.chain.harness })).groups.flatMap((group) => group.entries);
  return {
    bundle,
    skills: await Promise.all(bundle.skills.map(async (skill) => ({
      name: skill.name,
      conflict: entries.some((entry) => entry.enabled && entry.name === skill.name),
      directoryExists: await exists(join(projectSkillRootFor(bundle.chain.harness, projectPath), skill.directory)),
      files: skill.files.length,
      bytes: skill.files.reduce((sum, file) => sum + decodeFile(file.content).length, 0),
    }))),
  };
}

async function safeSkillRoot(projectPath: string, harness: Chain['harness']): Promise<string> {
  const root = projectSkillRootFor(harness, projectPath);
  for (const path of [join(projectPath, harness === 'opencode' ? '.opencode' : '.github'), root]) {
    try {
      await mkdir(path, { mode: 0o755 });
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error;
    }
    if (!(await lstat(path)).isDirectory() || await realpath(path) !== path) {
      invalid('Import refuses symbolic links in the project skill directory.');
    }
  }
  return root;
}

export async function importBundle(
  raw: unknown,
  projectPath: string,
  catalog: CatalogService,
  chains: ChainService,
  reuseSkills: string[],
): Promise<Chain> {
  const preview = await previewBundle(raw, projectPath, catalog);
  const reuse = new Set(reuseSkills);
  if (reuse.size !== reuseSkills.length || [...reuse].some((name) =>
    !preview.skills.some((skill) => skill.name === name && skill.conflict))) {
    invalid('Only an existing skill shown in the preview can be reused.');
  }
  for (const skill of preview.skills) {
    if (!reuse.has(skill.name) && (skill.conflict || skill.directoryExists)) {
      throw new BundleError('BUNDLE_CONFLICT', `Skill "${skill.name}" already exists. Reuse the installed skill or cancel; import never overwrites packages.`);
    }
  }
  const created: string[] = [];
  try {
    if (preview.bundle.skills.some((skill) => !reuse.has(skill.name))) {
      const root = await safeSkillRoot(projectPath, preview.bundle.chain.harness);
      for (const skill of preview.bundle.skills) {
        if (reuse.has(skill.name)) continue;
        const destination = join(root, skill.directory);
        try {
          await mkdir(destination, { mode: 0o755 });
        } catch (error) {
          if (isErrno(error, 'EEXIST')) throw new BundleError('BUNDLE_CONFLICT', 'A skill directory appeared since preview. Preview the bundle again.');
          throw error;
        }
        created.push(destination);
        for (const file of skill.files) {
          const segments = file.path.split('/');
          segments.pop();
          if (segments.length > 0) await mkdir(join(destination, ...segments), { recursive: true, mode: 0o755 });
          await writeFile(join(destination, file.path), decodeFile(file.content), {
            flag: 'wx',
            mode: file.executable ? 0o755 : 0o644,
          });
        }
      }
    }
    return await chains.importChain(projectPath, bundleChain(preview.bundle));
  } catch (error) {
    await Promise.all(created.map((path) => rm(path, { recursive: true, force: true })));
    throw error;
  }
}
