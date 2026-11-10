import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import { isProjectId } from '../projects/registry.js';
import { preflightRequestBodySchema } from '../preflight/request.js';
import { chainRevision } from '../chains/service.js';
import type { LoomServices } from '../services.js';
import type { ConfigStore } from '../config/store.js';

export const reviewedStartSchema = preflightRequestBodySchema.extend({
  projectId: z.string().max(255),
});

export class ReviewedStartError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ReviewedStartError';
  }
}

export function startEvidenceDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function reviewRunStart(
  configStore: ConfigStore,
  services: LoomServices,
  request: z.infer<typeof reviewedStartSchema>,
) {
  const project = isProjectId(request.projectId)
    ? await services.projectRegistry.findRecentProject(request.projectId) : undefined;
  if (project === undefined) throw new ReviewedStartError('PROJECT_NOT_FOUND', 'The project is not registered.');
  const config = await configStore.get();
  if (config.discoveryWorkspaces.some((workspace) => workspace.projectId === request.projectId)) {
    throw new ReviewedStartError('RUN_START_UNSUPPORTED', 'Discovery workspaces must be started through their dedicated supervised workflow.');
  }
  const workspace = config.testWorkspaces.find((item) => item.projectId === request.projectId);
  if (project.managedWorkspace === true && workspace === undefined) {
    throw new ReviewedStartError('RUN_START_UNSUPPORTED', 'This managed workspace cannot be started through the CLI.');
  }
  let projectInfo;
  try {
    if (await realpath(project.canonicalPath) !== project.canonicalPath) throw new Error('Project is not canonical.');
    projectInfo = await stat(project.canonicalPath, { bigint: true });
  } catch {
    throw new ReviewedStartError('RUN_PROJECT_UNAVAILABLE', 'The registered project is unavailable or no longer canonical.');
  }
  if (!projectInfo.isDirectory()) throw new ReviewedStartError('RUN_PROJECT_UNAVAILABLE', 'The registered project is not a directory.');
  const chain = await services.chainService.get(project.canonicalPath, request.chainId);
  if (chain.agent !== undefined || chain.steps.some((step) => step.kind !== 'instruction')) {
    throw new ReviewedStartError('RUN_START_UNSUPPORTED', 'CLI start currently supports only instruction-only chains without a selected native agent.');
  }
  const mode = request.mode ?? 'supervised';
  if (mode === 'automatic') {
    const adapter = (await services.preflightProvider.harnessRegistry()).get(chain.harness);
    if (adapter.automaticAdvancement !== 'process-exit') {
      throw new ReviewedStartError(
        'RUN_START_UNSUPPORTED',
        'Automatic CLI starts currently require a process-exit advancement signal; other signals remain unverified.',
      );
    }
  }
  const { projectId: _projectId, chainId: _chainId, ...options } = request;
  const report = await (await services.preflightProvider.preflightEngine()).run({
    chain, projectPath: project.canonicalPath, ...options, mode,
  });
  const evidence = {
    version: 1,
    projectId: request.projectId,
    projectPath: project.canonicalPath,
    projectDevice: String(projectInfo.dev),
    projectInode: String(projectInfo.ino),
    testWorkspaceId: workspace?.id ?? null,
    chain,
    request: { ...request, mode },
    preflight: report,
  };
  return {
    evidence,
    reviewDigest: startEvidenceDigest(evidence),
    expected: {
      chainRevision: chainRevision(chain),
      preflightDigest: startEvidenceDigest(report),
      projectPath: project.canonicalPath,
      projectDevice: String(projectInfo.dev),
      projectInode: String(projectInfo.ino),
    },
  };
}
