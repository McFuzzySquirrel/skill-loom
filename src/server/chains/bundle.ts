import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { BundlePreview, BundleSkill, ChainBundle } from '../../shared/bundles.js';
import { projectSkillRootFor } from '../catalog/copy.js';
import { SHARED_PROJECT_SKILLS_SEGMENTS, sharedProjectSkillRoot } from '../catalog/project-paths.js';
import {
  installNativeAgentContentIntoProject,
  inspectInstalledNativeAgent,
  installedNativeAgentPath,
  NativeAgentCopyError,
  removeNativeAgentIfUnchanged,
} from '../catalog/agent-copy.js';
import type { CatalogService } from '../catalog/merge.js';
import type { Chain } from './model.js';
import type { ChainService } from './service.js';
import {
  BundleError,
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_FILES,
  MAX_BUNDLE_SKILLS,
  bundleSkillNames,
  chainFromBundle,
  decodeBundleFile,
  parseBundle,
  validatePackagePath,
} from '../../portable/bundle.js';
export { BundleError, MAX_BUNDLE_BYTES, parseBundle } from '../../portable/bundle.js';

export { MAX_BUNDLE_REQUEST_BYTES } from '../../portable/bundle.js';

function invalid(message: string): never {
  throw new BundleError('BUNDLE_INVALID', message);
}

function skillNames(chain: Pick<Chain, 'steps'>): string[] {
  return bundleSkillNames(chain);
}

function bundleChain(bundle: ChainBundle): Chain {
  return chainFromBundle(bundle);
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
  const catalogResult = names.length === 0 && chain.agent === undefined
    ? undefined
    : await catalog.getCatalog({ projectPath, harness: chain.harness });
  const entries = catalogResult?.groups.flatMap((group) => group.entries) ?? [];
  const skills: BundleSkill[] = [];
  const budget = { bytes: 0, files: 0 };
  for (const name of names) {
    const matches = entries.filter((entry) => entry.name === name);
    const available = matches.filter((entry) => entry.enabled);
    const projectPackages = uniquePackages(available.filter((entry) => entry.source === 'project'));
    let candidates: typeof available;
    if (projectPackages.length > 1) {
      throw new BundleError(
        'BUNDLE_SOURCE_UNAVAILABLE',
        `Skill "${name}" has multiple project packages. Keep one project copy or rename the duplicates before export.`,
      );
    }
    if (projectPackages.length === 1) {
      candidates = projectPackages;
    } else {
      candidates = uniquePackages(available.filter((entry) => entry.source !== 'project'));
      if (candidates.length > 1) {
        throw new BundleError(
          'BUNDLE_SOURCE_UNAVAILABLE',
          `Skill "${name}" has multiple non-project packages and no project copy to prefer. Keep one available package before export.`,
        );
      }
    }
    const selected = candidates[0];
    if (!selected) {
      const warnings = catalogResult?.warnings ?? [];
      const discoveryNote = warnings.length === 0
        ? ''
        : ` Discovery reported ${String(warnings.length)} warning(s); review the catalog warnings before concluding the skill is missing.`;
      const message = matches.length > 0
        ? `Skill "${name}" is disabled in the ${chain.harness} catalog. Enable it or choose an available package before export.${discoveryNote}`
        : `Skill "${name}" is not present in the ${chain.harness} catalog. Refresh discovery or add the skill to a supported location before export.${discoveryNote}`;
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', message);
    }
    if (!selected.packagePath) {
      throw new BundleError(
        'BUNDLE_SOURCE_UNAVAILABLE',
        `Skill "${name}" is listed in the ${chain.harness} catalog, but its package directory is unavailable. Check the package path and permissions before export.`,
      );
    }
    const source = selected.packagePath;
    const skill: BundleSkill = { name, directory: basename(source), files: [] };
    async function collect(directory: string, prefix: string, depth: number): Promise<void> {
      if (depth > 32) invalid('The skill package exceeds the directory depth limit.');
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = prefix + entry.name;
        validatePackagePath(path);
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
  if (chain.agent !== undefined) {
    const installedStatus = await inspectInstalledNativeAgent({
      projectPath,
      selection: chain.agent,
    });
    const installedPath = installedNativeAgentPath(projectPath, chain.agent);
    const remoteAgent = catalogResult?.agents.find(
      (candidate) =>
        candidate.sourceId === chain.agent?.sourceId &&
        candidate.revision === chain.agent?.revision &&
        candidate.repositoryPath === chain.agent?.repositoryPath &&
        candidate.agentPath === chain.agent?.agentPath &&
        candidate.fingerprint === chain.agent?.fingerprint &&
        candidate.status === 'available',
    );
    const agentPath =
      installedStatus === 'available' && installedPath !== null
        ? installedPath
        : remoteAgent?.path ?? null;
    if (agentPath === null) {
      throw new BundleError(
        'BUNDLE_SOURCE_UNAVAILABLE',
        `Selected native agent "${chain.agent.name}" is unavailable or changed and cannot be exported.`,
      );
    }

    let content: Buffer;
    try {
      content = await readFile(agentPath);
    } catch {
      throw new BundleError(
        'BUNDLE_SOURCE_UNAVAILABLE',
        `Selected native agent "${chain.agent.name}" could not be read for export.`,
      );
    }
    const fingerprint = createHash('sha256').update(content).digest('hex');
    if (fingerprint !== chain.agent.fingerprint) {
      throw new BundleError(
        'BUNDLE_SOURCE_UNAVAILABLE',
        `Selected native agent "${chain.agent.name}" changed during export. Retry after editing finishes.`,
      );
    }
    if (budget.bytes + content.length > MAX_BUNDLE_BYTES || budget.files + 1 > MAX_BUNDLE_FILES) {
      throw new BundleError('BUNDLE_TOO_LARGE', 'Bundles are limited to 20 MiB and 2,000 files.');
    }
    return parseBundle({
      format: 'skill-loom-chain',
      version: 2,
      chain: {
        name: chain.name,
        harness: chain.harness,
        sessionMode: chain.sessionMode,
        steps: chain.steps,
        inputs: chain.inputs.map(({ defaultValue: _defaultValue, ...input }) => input),
        agent: chain.agent,
      },
      skills,
      agents: [{
        name: chain.agent.name,
        harness: chain.agent.harness,
        agentPath: chain.agent.agentPath,
        fingerprint,
        content: content.toString('base64'),
      }],
    });
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
  const agents = bundle.version === 2 && bundle.chain.agent !== undefined
    ? await Promise.all(bundle.agents.map(async (agent) => {
        const destination = installedNativeAgentPath(projectPath, bundle.chain.agent!);
        return {
          name: agent.name,
          harness: agent.harness,
          agentPath: agent.agentPath,
          conflict: destination === null ? true : await exists(destination),
          bytes: decodeBundleFile(agent.content).length,
        };
      }))
    : [];
  return {
    bundle,
    skills: await Promise.all(bundle.skills.map(async (skill) => ({
      name: skill.name,
      conflict: entries.some((entry) => entry.enabled && entry.name === skill.name),
      directoryExists: await exists(join(projectSkillRootFor(bundle.chain.harness, projectPath), skill.directory)),
      files: skill.files.length,
      bytes: skill.files.reduce((sum, file) => sum + decodeBundleFile(file.content).length, 0),
    }))),
    agents,
  };
}

async function safeSkillRoot(projectPath: string): Promise<string> {
  const root = sharedProjectSkillRoot(projectPath);
  for (const path of [join(projectPath, SHARED_PROJECT_SKILLS_SEGMENTS[0]), root]) {
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

function uniquePackages<T extends { id: string; packagePath: string }>(entries: T[]): T[] {
  const packages = new Map<string, T>();
  for (const entry of entries) {
    const key = entry.packagePath ? resolve(entry.packagePath) : `unresolved:${entry.id}`;
    if (!packages.has(key)) packages.set(key, entry);
  }
  return [...packages.values()];
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
  const createdAgents: Array<{ path: string; fingerprint: string }> = [];
  try {
    if (preview.bundle.skills.some((skill) => !reuse.has(skill.name))) {
      const root = await safeSkillRoot(projectPath);
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
          await writeFile(join(destination, file.path), decodeBundleFile(file.content), {
            flag: 'wx',
            mode: file.executable ? 0o755 : 0o644,
          });
        }
      }
    }
    if (preview.bundle.version === 2) {
      for (const agent of preview.bundle.agents) {
        const installed = await installNativeAgentContentIntoProject({
          projectPath,
          name: agent.name,
          harness: agent.harness,
          agentPath: agent.agentPath,
          fingerprint: agent.fingerprint,
          content: decodeBundleFile(agent.content),
        });
        createdAgents.push({
          path: installed.destinationPath,
          fingerprint: installed.fingerprint,
        });
      }
    }
    return await chains.importChain(projectPath, bundleChain(preview.bundle));
  } catch (error) {
    await Promise.all(created.map((path) => rm(path, { recursive: true, force: true })));
    await Promise.all(createdAgents.map(({ path, fingerprint }) =>
      removeNativeAgentIfUnchanged(path, fingerprint)));
    if (error instanceof NativeAgentCopyError) {
      throw new BundleError(
        error.code === 'NATIVE_AGENT_CONFLICT' ? 'BUNDLE_CONFLICT' : 'BUNDLE_SOURCE_UNAVAILABLE',
        error.message,
      );
    }
    throw error;
  }
}
