import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BundlePreview, BundleSkill, ChainBundle } from '../../shared/bundles.js';
import { projectSkillRootFor } from '../catalog/copy.js';
import { SHARED_PROJECT_SKILLS_SEGMENTS, sharedProjectSkillRoot } from '../catalog/project-paths.js';
import { resolveSkillCatalogEntry } from '../catalog/skill-resolution.js';
import { snapshotPackageFingerprint, snapshotReviewFingerprint } from '../catalog/snapshot-fingerprint.js';
import { readGitExecutablePaths } from './git-file-modes.js';
import {
  installNativeAgentContentIntoProject,
  inspectInstalledNativeAgent,
  installedNativeAgentPath,
  NativeAgentCopyError,
  removeNativeAgentIfUnchanged,
} from '../catalog/agent-copy.js';
import type { CatalogService } from '../catalog/merge.js';
import { CATALOG_WARNING_CODES, REMOTE_SNAPSHOT_CONTENT, type SkillEntry } from '../catalog/types.js';
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
import { writeBundleSkillFiles } from '../../portable/install-skill.js';
import { discardInstalledModeIndex, installedExecutableFlag, readInstalledModeIndex, type InstalledModeReceipt } from '../../portable/installed-modes.js';
import { packageFingerprint, treeFingerprint } from '../../portable/runtime.js';
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
    const skillStep = chain.steps.find(
      (step) => step.kind !== 'instruction' && step.skillName === name,
    );
    if (skillStep === undefined || skillStep.kind === 'instruction') {
      invalid(`Skill "${name}" is not represented by a skill step.`);
    }
    const resolution = resolveSkillCatalogEntry(entries, {
      skillName: name,
      ...(skillStep.skillBinding === undefined
        ? {}
        : { skillBinding: skillStep.skillBinding }),
    });
    if (resolution.status === 'ambiguous') {
      const message =
        resolution.scope === 'project'
          ? `Skill "${name}" has multiple project packages. Keep one project copy or rename the duplicates before export.`
          : resolution.scope === 'snapshot'
            ? `The selected remote snapshot for skill "${name}" matches multiple packages. Refresh the source or choose another catalog entry.`
            : `Skill "${name}" has multiple non-project packages and no project copy to prefer. Keep one available package before export.`;
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', message);
    }
    const selected = resolution.status === 'resolved' ? resolution.entry : undefined;
    if (!selected) {
      const warnings = catalogResult?.warnings ?? [];
      const discoveryNote = warnings.length === 0
        ? ''
        : ` Discovery reported ${String(warnings.length)} warning(s); review the catalog warnings before concluding the skill is missing.`;
      const message = resolution.status === 'binding-unavailable'
        ? `The selected remote snapshot for skill "${name}" is unavailable. Refresh its source or choose another catalog entry.${discoveryNote}`
        : resolution.status === 'disabled'
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
    let directory = basename(source);
    if (selected.source === 'remote' && !/[\\/]/.test(name)) {
      try {
        validatePackagePath(name);
        directory = name;
      } catch (error) {
        if (!(error instanceof BundleError)) throw error;
      }
    }
    const skill: BundleSkill = { name, directory, files: [] };
    const snapshotContent = selected[REMOTE_SNAPSHOT_CONTENT];
    const installedModes = await readInstalledModeIndex(source);
    if (process.platform === 'win32' && selected.source === 'remote' && snapshotContent?.executablePaths === undefined) {
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The remote package modes cannot be verified on Windows. Refresh the source and retry.');
    }
    const remainingExecutables = snapshotContent?.executablePaths === undefined
      ? undefined
      : new Set(snapshotContent.executablePaths);
    async function collect(directory: string, prefix: string, depth: number): Promise<void> {
      if (depth > 32) invalid('The skill package exceeds the directory depth limit.');
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (prefix === '' && entry.name === '.loom' && installedModes !== null) continue;
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
            const executable = (info.mode & 0o111) !== 0;
            const recordedExecutable = remainingExecutables?.delete(path);
            if (recordedExecutable !== undefined && process.platform !== 'win32' && recordedExecutable !== executable) {
              invalid('A remote package changed during export. Refresh and review it again.');
            }
            skill.files.push({
              path,
              content: content.subarray(0, bytesRead).toString('base64'),
              executable: installedModes === null ? recordedExecutable ?? executable :
                installedExecutableFlag(installedModes, path, executable),
            });
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
      if (installedModes !== null && installedModes.files.length !== skill.files.length) {
        invalid('Installed files no longer match their executable-mode metadata. Restore the complete reviewed package.');
      }
      if (process.platform === 'win32' && snapshotContent === undefined && installedModes === null) {
        const executablePaths = await readGitExecutablePaths(source, skill.files.map((file) => file.path));
        for (const file of skill.files) file.executable = executablePaths.has(file.path);
      }
      if (snapshotContent !== undefined) {
        const files = skill.files.map((file) => ({
          path: file.path, executable: file.executable, content: Buffer.from(file.content, 'base64'),
        }));
        if ((remainingExecutables?.size ?? 0) !== 0 ||
            snapshotPackageFingerprint(files) !== snapshotContent.fingerprint ||
            snapshotReviewFingerprint(files) !== snapshotContent.reviewFingerprint) {
          invalid('A remote package changed during export. Refresh and review it again.');
        }
      }
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
        steps: bundleSteps(chain.steps),
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
      steps: bundleSteps(chain.steps),
      inputs: chain.inputs.map(({ defaultValue: _defaultValue, ...input }) => input),
    },
    skills,
  });
}

export async function previewBundle(
  raw: unknown,
  projectPath: string,
  catalog: CatalogService,
  requireCompleteDiscovery = false,
): Promise<BundlePreview> {
  return (await inspectBundleDestination(raw, projectPath, catalog, requireCompleteDiscovery)).preview;
}

export async function inspectBundleDestination(
  raw: unknown,
  projectPath: string,
  catalog: CatalogService,
  requireCompleteDiscovery = false,
): Promise<{ preview: BundlePreview; entries: SkillEntry[] }> {
  const bundle = parseBundle(raw);
  const discovery = bundle.skills.length === 0 ? undefined :
    await catalog.getCatalog({ projectPath, harness: bundle.chain.harness });
  if (requireCompleteDiscovery && discovery !== undefined) {
    const incomplete = discovery.warnings.filter((warning) =>
      warning.code !== CATALOG_WARNING_CODES.DISCOVERY_SLOW &&
      warning.code !== CATALOG_WARNING_CODES.REMOTE_SOURCE_UNAVAILABLE &&
      (warning.source === undefined || warning.source === 'project'));
    if (incomplete.length > 0) {
      const codes = [...new Set(incomplete.map((warning) => warning.code))].sort().join(', ');
      throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', `Project skill discovery is incomplete (${codes}); resolve the warnings before reviewing an import.`);
    }
  }
  const entries = discovery?.groups.flatMap((group) => group.entries) ?? [];
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
  const preview: BundlePreview = {
    bundle,
    skills: await Promise.all(bundle.skills.map(async (skill) => ({
      name: skill.name,
      conflict: entries.some(
        (entry) => entry.enabled && entry.source === 'project' && entry.name === skill.name,
      ),
      directoryExists: await exists(join(projectSkillRootFor(bundle.chain.harness, projectPath), skill.directory)),
      files: skill.files.length,
      bytes: skill.files.reduce((sum, file) => sum + decodeBundleFile(file.content).length, 0),
    }))),
    agents,
  };
  return { preview, entries };
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

function bundleSteps(steps: Chain['steps']): Chain['steps'] {
  return steps.map((step) =>
    step.kind === 'instruction'
      ? step
      : {
          id: step.id,
          ...(step.kind === undefined ? {} : { kind: step.kind }),
          skillName: step.skillName,
          instruction: step.instruction,
          ...(step.label === undefined ? {} : { label: step.label }),
        },
  );
}

export async function importBundle(
  raw: unknown,
  projectPath: string,
  catalog: CatalogService,
  chains: ChainService,
  reuseSkills: string[],
  requireCompleteDiscovery = false,
  verifyReuse?: () => Promise<void>,
): Promise<Chain> {
  const { preview, entries } = await inspectBundleDestination(raw, projectPath, catalog, requireCompleteDiscovery);
  const reuse = new Set(reuseSkills);
  if (reuse.size !== reuseSkills.length || [...reuse].some((name) =>
    !preview.skills.some((skill) => skill.name === name && skill.conflict))) {
    invalid('Only an existing skill shown in the preview can be reused.');
  }
  for (const skill of preview.skills) {
    if (!reuse.has(skill.name) && (skill.conflict || skill.directoryExists)) {
      throw new BundleError('BUNDLE_CONFLICT', `Skill "${skill.name}" already exists. Reuse the installed skill or cancel; import never overwrites packages.`);
    }
    if (process.platform === 'win32' && reuse.has(skill.name)) {
      const paths = new Set(entries.filter((entry) =>
        entry.enabled && entry.source === 'project' && entry.name === skill.name).map((entry) => entry.packagePath));
      const path = [...paths][0];
      if (paths.size !== 1 || path === undefined || await readInstalledModeIndex(path) === null) {
        throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'Windows package reuse requires intact installed-mode metadata. Install the reviewed bundle into a new package directory.');
      }
    }
  }
  const created: string[] = [];
  const createdModes: InstalledModeReceipt[] = [];
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
        const modes = await writeBundleSkillFiles(destination, skill.files, {
          directoryMode: 0o755, recordExecutableModes: process.platform === 'win32',
        });
        if (modes !== undefined) createdModes.push(modes);
        if (await treeFingerprint(destination) !== packageFingerprint(skill.files)) {
          throw new BundleError('BUNDLE_SOURCE_UNAVAILABLE', 'The newly installed skill differs from the reviewed bundle.');
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
    if (verifyReuse !== undefined) await verifyReuse();
    return await chains.importChain(projectPath, bundleChain(preview.bundle));
  } catch (error) {
    await Promise.all(created.map((path) => rm(path, { recursive: true, force: true })));
    await Promise.all(createdModes.map(discardInstalledModeIndex));
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
