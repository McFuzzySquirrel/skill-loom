import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rmdir, stat, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { connect as connectTls, createServer as createTlsServer, type TLSSocket } from 'node:tls';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import packageManifest from '../../package.json' with { type: 'json' };
import {
  getRemoteCatalogSettings,
  listRemoteSkillSources,
  refreshRemoteSkillSource,
  registerRemoteSkillSource,
  RemoteSourceError,
  setRemoteCatalogLimits,
  setRemoteSourceLimits,
  unregisterRemoteSkillSource,
} from './catalog/remote.js';
import { CatalogError, SKILL_SOURCES } from './catalog/types.js';
import { CatalogCopyError } from './catalog/copy.js';
import {
  CatalogInstallError,
  installSkillIntoProject,
  reviewSkillInstall,
} from './catalog/install.js';
import {
  CAPABILITY_MAX_FILTER_VALUES,
  CAPABILITY_MAX_FILTER_VALUE_LENGTH,
} from './catalog/capability-index.js';
import { ProjectCatalogPageError, ProjectCatalogPages } from './catalog/project-pages.js';
import { HarnessError } from './harness/types.js';
import { atomicWriteJson, ConfigError, type ConfigStore } from './config/store.js';
import { DraftPayloadSchema } from './chains/drafts.js';
import { HARNESS_IDS } from './config/schema.js';
import { BundleError, exportBundle, MAX_BUNDLE_REQUEST_BYTES } from './chains/bundle.js';
import { CHAIN_VERSION, ChainError, validateChain, type Chain } from './chains/model.js';
import { chainRevision, ChainServiceError } from './chains/service.js';
import { ChainStoreError } from './chains/store.js';
import { FolderPathError } from './projects/paths.js';
import { isProjectId, ProjectRegistryError } from './projects/registry.js';
import { createLoomServices, type LoomServices } from './services.js';
import { importReviewedBundle, reviewBundleImport } from './bundles/reviewed-import.js';
import { preflightRequestBodySchema } from './preflight/request.js';
import { testWorkspaceCreateSchema } from './runs/test-workspace-request.js';
import { TestWorkspaceError } from './runs/test-workspaces.js';
import { inspectTestWorkspace } from './runs/workspace-inspect.js';
import { evaluateTestWorkspace, workspaceEvaluationSchema } from './runs/workspace-evaluate.js';
import { runRevision, RunOrchestratorError, type RunStreamMessage, type RunView } from './runs/orchestrator.js';
import { RunStoreError } from './runs/store.js';
import { RunOwnerError, type RunOwner } from './runs/owner.js';
import { RunError } from './runs/model.js';
import { AutomaticRunnerError } from './runs/automatic.js';
import { SupervisedRunnerError } from './runs/supervised.js';
import { RunPromptError } from './runs/prompts.js';
import { createDiscoveryWorkspaceService, DiscoveryWorkspaceError } from './runs/discovery-workspaces.js';
import { DiscoveryHandoffError, prepareDiscoveryHandoff } from './catalog/discovery-handoff.js';
import { ReviewedStartError, reviewedStartSchema, reviewRunStart } from './runs/reviewed-start.js';
import { withWorkspaceLifecycleLock } from './runs/workspace-lock.js';
import { ProjectClaimError } from '../shared/project-claim.js';
import { ProjectCoordinationError, reviewProjectCoordination } from '../shared/project-coordination.js';
import { coordinationActionSchema, executeCoordinationAction, ProjectCoordinationActionError } from './projects/coordination.js';
import { ProjectRunRecordsError, scanProjectRunRecords } from '../shared/project-run-records.js';
import { createWindowsControlCertificates, readWindowsControlMetadata, verifyWindowsProfile, WindowsControlSecurityError } from './windows-control.js';
import {
  TerminalTransportError,
  type TerminalAttachment,
  type TerminalManager,
  type TerminalSubscriber,
} from './terminal/pty.js';

const VERSION = 1;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = MAX_BUNDLE_REQUEST_BYTES + 64 * 1024;
const MAX_STREAM_BUFFER_BYTES = 1024 * 1024;
const metadataSchema = z.strictObject({
  version: z.literal(VERSION),
  applicationVersion: z.string().min(1).max(64),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  socket: z.string().max(512),
  tls: z.strictObject({
    serverCertificate: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(8192),
    clientCertificate: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(8192),
    clientPfx: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(16384),
  }).optional(),
});
const requestSchema = z.strictObject({
  version: z.number().int(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  operation: z.string().min(1).max(64),
  input: z.unknown(),
});
const sourceId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const skillDestinationName = z.string().regex(/^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,62}[a-z0-9])$/);
const skillInstallCandidateSchema = z.strictObject({
  id: z.string().min(1).max(512),
  source: z.enum(SKILL_SOURCES),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceId: sourceId.optional(),
  revision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  repositoryPath: z.string().min(1).max(4096).optional(),
});
const skillInstallReviewSchema = z.strictObject({
  projectId: z.string().min(1).max(255),
  harness: z.enum(HARNESS_IDS),
  candidate: skillInstallCandidateSchema,
  destinationName: skillDestinationName.optional(),
});

function withRevision(chain: Chain) {
  return { chain, revision: chainRevision(chain) };
}

export class ControlError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ControlError';
  }
}

export class ControlStartupCleanupError extends AggregateError {}

type Metadata = z.infer<typeof metadataSchema>;
type ControlResponse =
  | { protocolVersion: number; ok: true; result: unknown }
  | { protocolVersion: number; ok: false; error: { code: string; message: string; details?: Record<string, unknown> | undefined } };

type ControlEvent = { protocolVersion: number; ok: true; event: Omit<RunStreamMessage, 'chunk'> };

function failure(error: unknown): ControlResponse {
  if (error instanceof ControlError || error instanceof ConfigError || error instanceof RemoteSourceError ||
      error instanceof ChainError || error instanceof ChainStoreError || error instanceof ChainServiceError ||
      error instanceof FolderPathError || error instanceof ProjectRegistryError || error instanceof BundleError ||
      error instanceof TestWorkspaceError || error instanceof RunOrchestratorError || error instanceof RunStoreError ||
      error instanceof RunOwnerError || error instanceof CatalogError || error instanceof ProjectCatalogPageError || error instanceof HarnessError ||
      error instanceof CatalogCopyError || error instanceof CatalogInstallError ||
      error instanceof RunError || error instanceof AutomaticRunnerError ||
      error instanceof SupervisedRunnerError || error instanceof RunPromptError ||
      error instanceof TerminalTransportError || error instanceof DiscoveryWorkspaceError ||
      error instanceof DiscoveryHandoffError || error instanceof ReviewedStartError ||
      error instanceof ProjectClaimError || error instanceof ProjectCoordinationError || error instanceof ProjectCoordinationActionError ||
      error instanceof ProjectRunRecordsError || error instanceof WindowsControlSecurityError) {
    if (error instanceof BundleError) {
      return { protocolVersion: VERSION, ok: false, error: { code: error.code, message: error.message } };
    }
    return { protocolVersion: VERSION, ok: false, error: {
      code: error.code, message: error.message,
      ...('details' in error ? { details: error.details } : {}),
    } };
  }
  return { protocolVersion: VERSION, ok: false, error: {
    code: 'CONTROL_INTERNAL_ERROR', message: 'The local control operation failed.',
  } };
}

function requireControlPlatform(): void {
  if (process.platform !== 'win32' && process.getuid === undefined) {
    throw new ControlError('CONTROL_UNSUPPORTED', 'The local control service is not yet supported on this platform.');
  }
}

async function assertPrivateDirectory(directory: string, allowReadable: boolean): Promise<void> {
  if (process.platform === 'win32') {
    await verifyWindowsProfile(directory);
    return;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() ||
      (info.mode & (allowReadable ? 0o022 : 0o077)) !== 0 || await realpath(directory) !== directory) {
    throw new ControlError('CONTROL_UNSAFE', 'The local control directory is not safely owned and protected.');
  }
}

async function readMetadata(root: string): Promise<Metadata | null> {
  if (process.platform === 'win32') {
    try {
      const info = await lstat(join(root, 'control.json'));
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
        throw new ControlError('CONTROL_UNSAFE', 'The local control metadata is not safely protected.');
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const text = await readWindowsControlMetadata(root);
    if (text === null) return null;
    let raw: unknown;
    try { raw = JSON.parse(text) as unknown; } catch {
      throw new ControlError('CONTROL_UNSAFE', 'The local control metadata is invalid.');
    }
    const parsed = metadataSchema.safeParse(raw);
    if (!parsed.success) throw new ControlError('CONTROL_VERSION_UNSUPPORTED', 'The local control metadata is invalid or uses an unsupported protocol.');
    if (parsed.data.tls === undefined || !/^tls:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(parsed.data.socket) ||
        Number(parsed.data.socket.split(':').at(-1)) > 65535) {
      throw new ControlError('CONTROL_UNSAFE', 'The local control endpoint is unsafe.');
    }
    try {
      new X509Certificate(Buffer.from(parsed.data.tls.serverCertificate, 'base64'));
      new X509Certificate(Buffer.from(parsed.data.tls.clientCertificate, 'base64'));
    } catch {
      throw new ControlError('CONTROL_UNSAFE', 'The local control credentials are invalid.');
    }
    return parsed.data;
  }
  let handle;
  try {
    handle = await open(join(root, 'control.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new ControlError('CONTROL_UNSAFE', 'The local control metadata could not be opened safely.');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 4096) {
      throw new ControlError('CONTROL_UNSAFE', 'The local control metadata is not safely protected.');
    }
    let raw: unknown;
    try {
      const buffer = Buffer.alloc(4097);
      let bytes = 0;
      while (bytes < buffer.length) {
        const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
        if (result.bytesRead === 0) break;
        bytes += result.bytesRead;
      }
      if (bytes > 4096) throw new Error('metadata too large');
      raw = JSON.parse(buffer.subarray(0, bytes).toString('utf8')) as unknown;
    } catch {
      throw new ControlError('CONTROL_UNSAFE', 'The local control metadata is invalid.');
    }
    const parsed = metadataSchema.safeParse(raw);
    if (!parsed.success) throw new ControlError('CONTROL_VERSION_UNSUPPORTED', 'The local control metadata is invalid or uses an unsupported protocol.');
    const socketDirectory = dirname(parsed.data.socket);
    if (parsed.data.tls !== undefined || !basename(socketDirectory).startsWith('loom-control-') || basename(parsed.data.socket) !== 'control.sock' ||
        !parsed.data.socket.startsWith('/')) {
      throw new ControlError('CONTROL_UNSAFE', 'The local control endpoint is unsafe.');
    }
    return parsed.data;
  } finally {
    await handle.close();
  }
}

function connectControl(metadata: Metadata): Socket {
  if (metadata.tls === undefined) return createConnection(metadata.socket);
  const credentials = metadata.tls;
  const serverCertificate = new X509Certificate(Buffer.from(credentials.serverCertificate, 'base64'));
  let socket: TLSSocket;
  try {
    socket = connectTls({
      host: '127.0.0.1',
      port: Number(metadata.socket.split(':').at(-1)),
      servername: 'localhost',
      ca: serverCertificate.toString(),
      pfx: Buffer.from(credentials.clientPfx, 'base64'),
      passphrase: '',
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      ALPNProtocols: ['loom-control-v1'],
      checkServerIdentity: (_hostname, peer) => {
        if (!peer.raw.equals(serverCertificate.raw)) {
          return new ControlError('CONTROL_AUTH_FAILED', 'Local control server authentication failed.');
        }
        return undefined;
      },
    });
  } catch {
    throw new ControlError('CONTROL_UNSAFE', 'The local control TLS credentials are invalid or unsupported.');
  }
  socket.once('secureConnect', () => {
    if (socket.alpnProtocol !== 'loom-control-v1') {
      socket.destroy(new ControlError('CONTROL_VERSION_UNSUPPORTED', 'The local control TLS protocol is unsupported.'));
    }
  });
  return socket;
}

function connected(metadata: Metadata): 'connect' | 'secureConnect' {
  return metadata.tls === undefined ? 'connect' : 'secureConnect';
}

async function removeStaleEndpoint(metadata: Metadata): Promise<void> {
  if (metadata.tls !== undefined) {
    await new Promise<void>((done, reject) => {
      const socket = connectControl(metadata);
      socket.setTimeout(5_000, () => {
        socket.destroy();
        reject(new ControlError('CONTROL_ENDPOINT_IN_USE', 'The previous control endpoint did not respond.'));
      });
      socket.once('secureConnect', () => {
        socket.destroy();
        reject(new ControlError('CONTROL_ENDPOINT_IN_USE', 'Another process still owns the previous control endpoint.'));
      });
      socket.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNREFUSED') done();
        else reject(new ControlError('CONTROL_UNSAFE', 'The previous control endpoint could not be authenticated safely.'));
      });
    });
    // A TCP port is not a filesystem artifact. Never delete or shut down an
    // unknown listener. Production startup also holds exclusive profile ownership.
    return;
  }
  try {
    await assertPrivateDirectory(dirname(metadata.socket), false);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  const reachable = await new Promise<boolean>((resolveReachable, reject) => {
    const socket = createConnection(metadata.socket);
    socket.setTimeout(1_000, () => { socket.destroy(); reject(new ControlError('CONTROL_ENDPOINT_IN_USE', 'The previous control endpoint did not respond.')); });
    socket.once('connect', () => { socket.destroy(); resolveReachable(true); });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolveReachable(false);
      else reject(new ControlError('CONTROL_UNSAFE', 'The previous control endpoint could not be checked safely.'));
    });
  });
  if (reachable) throw new ControlError('CONTROL_ENDPOINT_IN_USE', 'Another process still owns the previous control endpoint.');
  try {
    const info = await lstat(metadata.socket);
    if (!info.isSocket() || info.uid !== process.getuid?.()) {
      throw new ControlError('CONTROL_UNSAFE', 'The stale control endpoint is unsafe.');
    }
    await unlink(metadata.socket);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  try {
    await rmdir(dirname(metadata.socket));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw new ControlError('CONTROL_UNSAFE', 'The stale control directory could not be removed safely.');
    }
  }
}

async function dispatch(
  configStore: ConfigStore,
  operation: string,
  input: unknown,
  services: LoomServices,
  catalogPages: ProjectCatalogPages,
  runOwner?: RunOwner,
  prepareStop?: () => Promise<void>,
  signal?: AbortSignal,
): Promise<unknown> {
  const parse = <T>(schema: z.ZodType<T>): T => {
    const result = schema.safeParse(input);
    if (!result.success) throw new ControlError('CONTROL_INVALID_REQUEST', 'The local control request is not valid.');
    return result.data;
  };
  const projectPath = async (projectId: string): Promise<string> => {
    const project = isProjectId(projectId)
      ? await services.projectRegistry.findRecentProject(projectId) : undefined;
    if (project === undefined) throw new ControlError('PROJECT_NOT_FOUND', 'The project is not registered.');
    return project.canonicalPath;
  };
  const listWithRevisions = (chains: Awaited<ReturnType<LoomServices['chainService']['list']>>) => ({
    ...chains,
    revisions: Object.fromEntries(chains.chains.map((chain) => [chain.id, chainRevision(chain)])),
  });
  const actionSchema = z.strictObject({
    runId: z.string().min(1).max(64),
    action: z.enum(['pause', 'resume', 'run-next', 'done', 'failed', 'skip', 'next', 'retry', 'continue', 'restart']),
    reason: z.string().max(2000).optional(),
    acknowledgements: preflightRequestBodySchema.shape.acknowledgements,
  });
  const actionEvidence = async (view: RunView, request: z.infer<typeof actionSchema>) => {
    const available = request.action === 'run-next' ? view.actions.runNext : view.actions[request.action];
    if (!available ||
        (['pause', 'resume', 'run-next'].includes(request.action) && view.run.mode !== 'automatic') ||
        (['done', 'failed'].includes(request.action) && view.run.mode !== 'supervised')) {
      throw new ControlError('RUN_ACTION_NOT_ALLOWED', 'This action is not available for the current run state.');
    }
    if (request.action === 'skip' && (request.reason === undefined || request.reason.trim() === '')) {
      throw new ControlError('CONTROL_INVALID_REQUEST', 'Skipping a step requires a reason.');
    }
    let destination: { path: string; device: string; inode: string } | null = null;
    let testWorkspaceId: string | null = null;
    let preflight = null;
    if (['next', 'run-next', 'resume', 'retry', 'continue', 'restart'].includes(request.action)) {
      const config = await configStore.get();
      if (view.run.chainSnapshot.agent !== undefined ||
          view.run.chainSnapshot.steps.some((step) => step.kind !== 'instruction') ||
          config.discoveryWorkspaces.some((workspace) => workspace.projectId === view.run.projectId)) {
        throw new ControlError('RUN_ACTION_NOT_ALLOWED', 'CLI execution actions currently support only non-discovery instruction-only runs.');
      }
      if (view.run.mode === 'automatic' &&
          (await services.preflightProvider.harnessRegistry()).get(view.run.chainSnapshot.harness).automaticAdvancement !== 'process-exit') {
        throw new ControlError('RUN_ACTION_NOT_ALLOWED', 'Automatic CLI execution requires a process-exit advancement signal.');
      }
      testWorkspaceId = config.testWorkspaces.find((workspace) => workspace.projectId === view.run.projectId)?.id ?? null;
      try {
        const canonical = await realpath(view.projectPath);
        const info = await stat(view.projectPath, { bigint: true });
        if (canonical !== view.projectPath || !info.isDirectory()) throw new Error('Invalid project.');
        destination = { path: canonical, device: String(info.dev), inode: String(info.ino) };
      } catch {
        throw new ControlError('RUN_STALE', 'The reviewed project is no longer available.');
      }
      preflight = await (await services.preflightProvider.preflightEngine()).run({
        chain: view.run.chainSnapshot, projectPath: view.projectPath, mode: view.run.mode,
        inputs: view.run.resolvedInputs,
        ...(request.acknowledgements === undefined ? {} : { acknowledgements: request.acknowledgements }),
      });
    }
    const evidence = {
      runId: request.runId, action: request.action, reason: request.reason ?? null,
      runRevision: runRevision(view.run),
      destination,
      testWorkspaceId,
      acknowledgements: request.acknowledgements ?? null,
      preflight,
    };
    return { evidence, reviewDigest: createHash('sha256').update(JSON.stringify(evidence)).digest('hex') };
  };
  switch (operation) {
    case 'status':
      parse(z.strictObject({}));
      return { state: 'running', applicationVersion: packageManifest.version };
    case 'discovery.handoff':
      return prepareDiscoveryHandoff(configStore, input);
    case 'service.stop':
      parse(z.strictObject({}));
      if (prepareStop === undefined) throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Stopping this service is not supported.');
      await prepareStop();
      return { state: 'stopping' };
    case 'project.list':
      parse(z.strictObject({}));
      return { projects: await services.projectRegistry.listRecentProjects() };
    case 'project.open': {
      const request = parse(z.strictObject({ path: z.string().min(1).max(4096) }));
      return { project: await services.projectRegistry.openProject(request.path) };
    }
    case 'project.coordination.review': {
      const request = parse(z.strictObject({ projectId: z.string().max(255) }));
      return {
        review: await reviewProjectCoordination(await projectPath(request.projectId)),
        executionCoordinated: false,
      };
    }
    case 'project.coordination.action': {
      const request = parse(z.strictObject({ projectId: z.string().max(255), request: coordinationActionSchema }));
      if (runOwner === undefined) throw new ControlError('CONTROL_UNAVAILABLE', 'Run ownership is unavailable.');
      return executeCoordinationAction(await projectPath(request.projectId), configStore.getConfigDir(), runOwner, request.request);
    }
    case 'draft.list':
      parse(z.strictObject({}));
      return listWithRevisions(await services.getDraftService().list(configStore.getConfigDir()));
    case 'draft.get': {
      const request = parse(z.strictObject({ draftId: sourceId }));
      return withRevision(await services.getDraftService().get(configStore.getConfigDir(), request.draftId));
    }
    case 'draft.create': {
      const draft = parse(DraftPayloadSchema);
      return withRevision(await services.getDraftService().create(configStore.getConfigDir(), draft));
    }
    case 'draft.update': {
      const request = parse(z.strictObject({ draftId: sourceId, expectedRevision: revision, draft: DraftPayloadSchema }));
      return withRevision(await services.getDraftService().update(
        configStore.getConfigDir(), request.draftId, request.draft, { expectedRevision: request.expectedRevision },
      ));
    }
    case 'draft.remove': {
      const request = parse(z.strictObject({ draftId: sourceId, expectedRevision: revision, confirmed: z.literal(true) }));
      await services.getDraftService().remove(configStore.getConfigDir(), request.draftId, { expectedRevision: request.expectedRevision });
      return { draftId: request.draftId, deleted: true };
    }
    case 'chain.project.list':
    case 'chain.project.get': {
      const request = parse(z.strictObject({
        projectId: z.string().max(255),
        ...(operation === 'chain.project.get' ? { chainId: sourceId } : {}),
      }));
      const path = await projectPath(request.projectId);
      if ('chainId' in request && typeof request.chainId === 'string') {
        return withRevision(await services.chainService.get(path, request.chainId));
      }
      return listWithRevisions(await services.chainService.list(path));
    }
    case 'chain.project.create': {
      const request = parse(z.strictObject({ projectId: z.string().max(255), draft: DraftPayloadSchema }));
      return withRevision(await services.chainService.create(await projectPath(request.projectId), request.draft));
    }
    case 'chain.project.update': {
      const request = parse(z.strictObject({
        projectId: z.string().max(255), chainId: sourceId, expectedRevision: revision, draft: DraftPayloadSchema,
      }));
      return withRevision(await services.chainService.update(
        await projectPath(request.projectId), request.chainId, request.draft, { expectedRevision: request.expectedRevision },
      ));
    }
    case 'chain.project.remove': {
      const request = parse(z.strictObject({
        projectId: z.string().max(255), chainId: sourceId, expectedRevision: revision, confirmed: z.literal(true),
      }));
      await services.chainService.remove(await projectPath(request.projectId), request.chainId, { expectedRevision: request.expectedRevision });
      return { chainId: request.chainId, deleted: true };
    }
    case 'draft.bundle': {
      const request = parse(z.strictObject({ draftId: sourceId }));
      const draft = await services.getDraftService().get(configStore.getConfigDir(), request.draftId);
      return { bundle: await exportBundle(draft, configStore.getConfigDir(), services.catalogService) };
    }
    case 'chain.project.bundle': {
      const request = parse(z.strictObject({ projectId: z.string().max(255), chainId: sourceId }));
      const path = await projectPath(request.projectId);
      const chain = await services.chainService.get(path, request.chainId);
      return { bundle: await exportBundle(chain, path, services.catalogService) };
    }
    case 'draft.validate': {
      const draft = parse(DraftPayloadSchema);
      const timestamp = new Date().toISOString();
      const validated = validateChain({
        version: CHAIN_VERSION, id: 'draft-validation',
        ...draft,
        inputs: draft.inputs ?? [],
        automaticPermissionOptIn: draft.automaticPermissionOptIn ?? false,
        createdAt: timestamp, updatedAt: timestamp,
      });
      return { valid: true, warnings: validated.warnings };
    }
    case 'bundle.review': {
      const request = parse(z.strictObject({ projectId: z.string().max(255), bundlePath: z.string().max(4096) }));
      const reviewed = await reviewBundleImport(services, request.projectId, request.bundlePath);
      return { evidence: reviewed.evidence, reviewDigest: reviewed.reviewDigest };
    }
    case 'bundle.import': {
      const request = parse(z.strictObject({
        projectId: z.string().max(255),
        bundlePath: z.string().max(4096),
        reviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
        confirmed: z.literal(true),
        reuseSkills: z.array(z.string().min(1).max(255)).max(100).optional(),
        differingReuseConfirmed: z.literal(true).optional(),
      }));
      return { chain: await importReviewedBundle(services, request) };
    }
    case 'run.preflight': {
      const { projectId, chainId, ...request } = parse(preflightRequestBodySchema.extend({
        projectId: z.string().max(255),
      }));
      const project = isProjectId(projectId) ? await services.projectRegistry.findRecentProject(projectId) : undefined;
      if (project === undefined) throw new ControlError('PROJECT_NOT_FOUND', 'The destination project is not registered.');
      const chain = await services.chainService.get(project.canonicalPath, chainId);
      const engine = await services.preflightProvider.preflightEngine();
      return engine.run({ chain, projectPath: project.canonicalPath, ...request });
    }
    case 'run.start.review': {
      const request = parse(reviewedStartSchema);
      const reviewed = await reviewRunStart(configStore, services, request);
      return { evidence: reviewed.evidence, reviewDigest: reviewed.reviewDigest };
    }
    case 'run.start': {
      const { reviewDigest, confirmed: _confirmed, liveTestConfirmed, automaticConfirmed, broadPermissionsConfirmed, ...request } = parse(
        reviewedStartSchema.extend({
          reviewDigest: revision,
          confirmed: z.literal(true),
          liveTestConfirmed: z.literal(true).optional(),
          automaticConfirmed: z.literal(true).optional(),
          broadPermissionsConfirmed: z.literal(true).optional(),
        }),
      );
      if (runOwner === undefined) throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Managed runs are not available.');
      return runOwner.withMutation(() => withWorkspaceLifecycleLock(request.projectId, async () => {
        const reviewed = await reviewRunStart(configStore, services, request);
        if (reviewed.reviewDigest !== reviewDigest) {
          throw new ControlError('RUN_STALE', 'The reviewed start evidence changed. Review it again.');
        }
        if (reviewed.evidence.testWorkspaceId !== null && liveTestConfirmed !== true) {
          throw new ControlError('RUN_LIVE_TEST_CONFIRMATION_REQUIRED', 'A managed test workspace requires separate live-test approval.');
        }
        if (reviewed.evidence.request.mode === 'automatic' && automaticConfirmed !== true) {
          throw new ControlError('RUN_AUTOMATIC_CONFIRMATION_REQUIRED', 'Automatic progression requires separate approval.');
        }
        if (reviewed.evidence.preflight.permissions?.required === true && broadPermissionsConfirmed !== true) {
          throw new ControlError('RUN_PERMISSIONS_CONFIRMATION_REQUIRED', 'The reported broad harness permissions require separate approval.');
        }
        const orchestrator = await runOwner.get();
        const run = await orchestrator.createRun({ ...request, mode: reviewed.evidence.request.mode, expectedStart: reviewed.expected });
        return orchestrator.getRunView(run.id);
      }));
    }
    case 'run.list': {
      const request = parse(z.strictObject({ projectId: z.string().max(255) }));
      const path = await projectPath(request.projectId);
      try {
        const info = await lstat(path);
        const loomPath = join(path, '.loom');
        const loom = await lstat(loomPath);
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path ||
            !loom.isDirectory() || loom.isSymbolicLink() || await realpath(loomPath) !== loomPath) {
          throw new ProjectRunRecordsError('The registered project directory is unsafe or unavailable.');
        }
      } catch (error) {
        if (error instanceof ProjectRunRecordsError) throw error;
        throw new ProjectRunRecordsError('The registered project directory is unsafe or unavailable.', { cause: error });
      }
      return { records: await scanProjectRunRecords(path) };
    }
    case 'run.active':
      parse(z.strictObject({}));
      if (runOwner === undefined) throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Managed runs are not available.');
      return (await runOwner.get()).getActiveRun();
    case 'run.show': {
      const request = parse(z.strictObject({ runId: z.string().min(1).max(64) }));
      if (runOwner === undefined) throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Managed runs are not available.');
      const view = await (await runOwner.get()).getRunView(request.runId);
      return { ...view, revision: runRevision(view.run) };
    }
    case 'run.action.review': {
      const request = parse(actionSchema);
      if (runOwner === undefined) throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Managed runs are not available.');
      const view = await (await runOwner.get()).getRunView(request.runId);
      return { view, ...(await actionEvidence(view, request)) };
    }
    case 'run.action': {
      const request = parse(actionSchema.extend({
        reviewDigest: revision, confirmed: z.literal(true),
        executionConfirmed: z.literal(true).optional(), replayConfirmed: z.literal(true).optional(),
        liveTestConfirmed: z.literal(true).optional(),
        automaticConfirmed: z.literal(true).optional(), broadPermissionsConfirmed: z.literal(true).optional(),
      }));
      if (runOwner === undefined) throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Managed runs are not available.');
      return runOwner.withMutation(async () => {
        const orchestrator = await runOwner.get();
        const before = await orchestrator.getRunView(request.runId);
        return withWorkspaceLifecycleLock(before.run.projectId, async () => {
          const view = await orchestrator.getRunView(request.runId);
          const reviewed = await actionEvidence(view, request);
          if (reviewed.reviewDigest !== request.reviewDigest) {
            throw new ControlError('RUN_STALE', 'The run or intended action changed. Review it again.');
          }
          if (reviewed.evidence.preflight !== null && request.executionConfirmed !== true) {
            throw new ControlError('RUN_EXECUTION_CONFIRMATION_REQUIRED', 'This action requires separate execution approval.');
          }
          if (reviewed.evidence.preflight !== null && view.run.mode === 'automatic' && request.automaticConfirmed !== true) {
            throw new ControlError('RUN_AUTOMATIC_CONFIRMATION_REQUIRED', 'Automatic progression requires separate approval.');
          }
          if (reviewed.evidence.preflight?.permissions?.required === true && request.broadPermissionsConfirmed !== true) {
            throw new ControlError('RUN_PERMISSIONS_CONFIRMATION_REQUIRED', 'The reported broad harness permissions require separate approval.');
          }
          if ((request.action === 'retry' || request.action === 'restart') && request.replayConfirmed !== true) {
            throw new ControlError('RUN_REPLAY_CONFIRMATION_REQUIRED', 'Retry or restart requires separate approval to replay work.');
          }
          if (reviewed.evidence.testWorkspaceId !== null && request.liveTestConfirmed !== true) {
            throw new ControlError('RUN_LIVE_TEST_CONFIRMATION_REQUIRED', 'A managed test workspace requires separate live-test approval.');
          }
          if (request.action === 'done') {
            const workspace = (await configStore.get()).discoveryWorkspaces.find((candidate) =>
              candidate.projectId === view.run.projectId && candidate.chainId === view.run.chainId);
            if (workspace !== undefined) {
              await createDiscoveryWorkspaceService({
                configStore, projectRegistry: services.projectRegistry, chainService: services.chainService,
              }).assertResultReviewed(workspace.id);
            }
          }
          const result = await orchestrator.applyAction(request.runId, {
            action: request.action,
            ...(request.reason === undefined ? {} : { reason: request.reason }),
            expectedRevision: reviewed.evidence.runRevision,
            ...(reviewed.evidence.destination === null ? {} : { expectedProject: reviewed.evidence.destination }),
            ...(reviewed.evidence.preflight === null ? {} : {
              expectedPreflight: {
                digest: createHash('sha256').update(JSON.stringify(reviewed.evidence.preflight)).digest('hex'),
                ...(request.acknowledgements === undefined ? {} : { acknowledgements: request.acknowledgements }),
              },
            }),
          });
          return { ...(await orchestrator.getRunView(result.run.id)), restartedFrom: result.restartedFrom };
        });
      });
    }
    case 'run.abort': {
      const request = parse(z.strictObject({
        runId: z.string().min(1).max(64), confirmed: z.literal(true),
        reason: z.string().max(2000).optional(),
      }));
      if (runOwner === undefined) throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Managed runs are not available.');
      return runOwner.withMutation(async () => {
        const orchestrator = await runOwner.get();
        const result = await orchestrator.applyAction(request.runId, {
          action: 'abort', ...(request.reason === undefined ? {} : { reason: request.reason }),
        });
        const view = await orchestrator.getRunView(result.run.id);
        return { ...view, restartedFrom: result.restartedFrom };
      });
    }
    case 'workspace.list':
      parse(z.strictObject({}));
      return { workspaces: await services.testWorkspaceService.list() };
    case 'workspace.create':
      return { workspace: await services.testWorkspaceService.create(parse(testWorkspaceCreateSchema)) };
    case 'workspace.inspect': {
      const request = parse(z.strictObject({
        workspaceId: z.uuid(),
        path: z.string().max(4096).default(''),
        offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }));
      return inspectTestWorkspace({ configStore, projectRegistry: services.projectRegistry }, request);
    }
    case 'workspace.evaluate':
      return evaluateTestWorkspace(
        { configStore, projectRegistry: services.projectRegistry }, parse(workspaceEvaluationSchema),
      );
    case 'workspace.remove': {
      const request = parse(z.strictObject({ workspaceId: z.uuid(), confirmed: z.literal(true) }));
      return services.testWorkspaceService.remove(request.workspaceId);
    }
    case 'catalog.source.list':
      parse(z.strictObject({}));
      return { sources: await listRemoteSkillSources(configStore) };
    case 'catalog.project.page': {
      const request = parse(z.strictObject({
        projectId: z.string().max(255),
        harness: z.enum(HARNESS_IDS),
        query: z.string().max(200).optional(),
        offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        warningsOffset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
        snapshotId: z.string().regex(/^[A-Za-z0-9_-]{32}$/).optional(),
        sources: z.array(z.enum(SKILL_SOURCES)).max(SKILL_SOURCES.length).optional(),
        enabled: z.boolean().optional(),
        tags: z.array(z.string().trim().min(1).max(CAPABILITY_MAX_FILTER_VALUE_LENGTH))
          .max(CAPABILITY_MAX_FILTER_VALUES).optional(),
        tools: z.array(z.string().trim().min(1).max(CAPABILITY_MAX_FILTER_VALUE_LENGTH))
          .max(CAPABILITY_MAX_FILTER_VALUES).optional(),
        inputs: z.array(z.string().trim().min(1).max(CAPABILITY_MAX_FILTER_VALUE_LENGTH))
          .max(CAPABILITY_MAX_FILTER_VALUES).optional(),
        outputs: z.array(z.string().trim().min(1).max(CAPABILITY_MAX_FILTER_VALUE_LENGTH))
          .max(CAPABILITY_MAX_FILTER_VALUES).optional(),
        hasTags: z.boolean().optional(),
        hasTools: z.boolean().optional(),
        hasInputs: z.boolean().optional(),
        hasOutputs: z.boolean().optional(),
      }));
      const project = isProjectId(request.projectId)
        ? await services.projectRegistry.findRecentProject(request.projectId) : undefined;
      if (project === undefined) throw new ControlError('PROJECT_NOT_FOUND', 'The project is not registered.');
      return catalogPages.page({ ...request, projectPath: project.canonicalPath });
    }
    case 'catalog.skill.review': {
      const request = parse(skillInstallReviewSchema);
      const path = await projectPath(request.projectId);
      return reviewSkillInstall(
        { catalogService: services.catalogService },
        { ...request, projectPath: path },
      );
    }
    case 'catalog.skill.install': {
      const request = parse(skillInstallReviewSchema.extend({
        reviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
        confirmed: z.literal(true),
      }));
      const path = await projectPath(request.projectId);
      return installSkillIntoProject(
        { catalogService: services.catalogService },
        { ...request, projectPath: path },
      );
    }
    case 'catalog.source.add': {
      const request = parse(z.strictObject({ repository: z.string().max(2048), ref: z.string().max(255).optional() }));
      return { source: await registerRemoteSkillSource(configStore, {
        repository: request.repository,
        ...(request.ref === undefined ? {} : { ref: request.ref }),
      }) };
    }
    case 'catalog.source.remove': {
      const request = parse(z.strictObject({ sourceId }));
      await unregisterRemoteSkillSource(configStore, request.sourceId);
      return { sourceId: request.sourceId, removed: true };
    }
    case 'catalog.source.refresh': {
      const request = parse(z.strictObject({
        sourceId, revision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
      }));
      const snapshot = await refreshRemoteSkillSource(configStore, request.sourceId, {
        ...(signal === undefined ? {} : { signal }),
        ...(request.revision === undefined ? {} : { revision: request.revision }),
      });
      return { sourceId: snapshot.sourceId, revision: snapshot.revision, skills: snapshot.packages.length, agents: snapshot.agents.length };
    }
    case 'catalog.limits.get':
      parse(z.strictObject({}));
      return getRemoteCatalogSettings(configStore);
    case 'catalog.limits.set': {
      const request = parse(z.strictObject({ limits: z.unknown() }));
      return setRemoteCatalogLimits(configStore, request.limits);
    }
    case 'catalog.limits.source': {
      const request = parse(z.strictObject({ sourceId, limits: z.unknown() }));
      return { source: await setRemoteSourceLimits(configStore, request.sourceId, request.limits) };
    }
    default:
      throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'The local control operation is not supported.');
  }
}

export async function startControlServer(
  configStore: ConfigStore,
  options: {
    prepareStop?: () => Promise<void>;
    stop?: () => Promise<void>;
    isStopping?: () => boolean;
    isFailed?: () => boolean;
    isReady?: () => boolean;
    /** HTTP endpoint the owner serves, so the CLI can reuse it without guessing. */
    httpEndpoint?: { host: string; port: number };
    services?: LoomServices;
    runOwner?: RunOwner;
    terminalManager?: TerminalManager;
  } = {},
): Promise<{ close(): Promise<void> }> {
  requireControlPlatform();
  const requestedRoot = resolve(configStore.getConfigDir());
  const root = await realpath(requestedRoot);
  const services = options.services ?? createLoomServices({ configStore });
  const catalogPages = new ProjectCatalogPages(
    services.catalogService, Date.now, undefined, undefined, services.capabilitySearchService,
  );
  if (process.platform !== 'win32') await assertPrivateDirectory(root, true);
  const previous = await readMetadata(process.platform === 'win32' ? requestedRoot : root);
  if (previous !== null) await removeStaleEndpoint(previous);
  let runtime = process.platform === 'win32' ? undefined : await mkdtemp(join(await realpath(tmpdir()), 'loom-control-'));
  if (runtime !== undefined && Buffer.byteLength(join(runtime, 'control.sock')) > 100) {
    await rmdir(runtime);
    runtime = await mkdtemp(join(await realpath('/tmp'), 'loom-control-'));
  }
  try {
    if (runtime !== undefined) await assertPrivateDirectory(runtime, false);
  } catch (error) {
    try {
      if (runtime !== undefined) await rmdir(runtime);
    } catch (cleanupError) {
      throw new ControlStartupCleanupError([error, cleanupError], 'Control endpoint setup failed and its runtime directory could not be removed.');
    }
    throw error;
  }
  const certificates = process.platform === 'win32' ? await createWindowsControlCertificates() : undefined;
  const metadata: Metadata = {
    version: VERSION,
    applicationVersion: packageManifest.version,
    token: randomBytes(32).toString('base64url'),
    socket: runtime === undefined ? '' : join(runtime, 'control.sock'),
    ...(certificates === undefined ? {} : { tls: {
      serverCertificate: certificates.server.certificate,
      clientCertificate: certificates.client.certificate,
      clientPfx: certificates.client.pfx,
    } }),
  };
  const clients = new Set<Socket>();
  const eventStreams = new Set<Socket>();
  const active = new Set<Promise<void>>();
  let closing = false;
  const accept = (socket: Socket): void => {
    if (closing || clients.size >= 32) { socket.destroy(); return; }
    clients.add(socket);
    socket.once('close', () => clients.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(5_000, () => socket.destroy());
    let received = Buffer.alloc(0);
    let submitted = false;
    socket.on('data', (chunk: Buffer) => {
      if (submitted) return;
      if (received.length + chunk.length > MAX_REQUEST_BYTES) { socket.destroy(); return; }
      received = Buffer.concat([received, chunk]);
      const newline = received.indexOf(10);
      if (newline < 0) return;
      submitted = true;
      socket.setTimeout(0);
      const operation = (async () => {
        let response: ControlResponse;
        let parsedOperation: string | undefined;
        try {
          const parsed = requestSchema.safeParse(JSON.parse(received.subarray(0, newline).toString('utf8')) as unknown);
          if (!parsed.success) throw new ControlError('CONTROL_INVALID_REQUEST', 'The local control request is not valid.');
          if (!timingSafeEqual(Buffer.from(parsed.data.token), Buffer.from(metadata.token))) {
            throw new ControlError('CONTROL_AUTH_FAILED', 'Local control authentication failed.');
          }
          if (parsed.data.version !== VERSION) throw new ControlError('CONTROL_VERSION_UNSUPPORTED', 'The local control protocol version is unsupported.');
          if (options.isStopping?.() === true && parsed.data.operation !== 'status' &&
              parsed.data.operation !== 'service.stop') {
            throw new ControlError('CONTROL_STOPPING', 'The Skill Loom service is stopping.');
          }
          if (options.isReady?.() === false && parsed.data.operation !== 'status') {
            throw new ControlError('CONTROL_BUSY', 'The Skill Loom service is still starting.');
          }
          parsedOperation = parsed.data.operation;
          if (parsedOperation === 'service.stop' && options.stop === undefined) {
            throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Stopping this service is not supported.');
          }
          if (parsedOperation === 'run.events') {
            const request = z.strictObject({ runId: z.string().min(1).max(64) }).safeParse(parsed.data.input);
            if (!request.success) throw new ControlError('CONTROL_INVALID_REQUEST', 'The local control request is not valid.');
            if (options.runOwner === undefined) throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Managed runs are not available.');
            await streamRunEvents(socket, request.data.runId, options.runOwner, eventStreams);
            return;
          }
          if (parsedOperation === 'run.attach') {
            const request = z.strictObject({ runId: z.string().min(1).max(64) }).safeParse(parsed.data.input);
            if (!request.success) throw new ControlError('CONTROL_INVALID_REQUEST', 'The local control request is not valid.');
            if (options.runOwner === undefined || options.terminalManager === undefined) {
              throw new ControlError('CONTROL_UNKNOWN_OPERATION', 'Managed terminals are not available.');
            }
            await streamRunTerminal(socket, request.data.runId, options.runOwner, options.terminalManager, eventStreams);
            return;
          }
          const controller = new AbortController();
          const cancel = (): void => { controller.abort(); };
          if (parsedOperation === 'catalog.source.refresh') {
            socket.once('close', cancel);
            if (socket.destroyed) cancel();
          }
          let result: unknown;
          try {
            result = await dispatch(configStore, parsedOperation, parsed.data.input, services, catalogPages, options.runOwner, options.prepareStop, controller.signal);
          } finally {
            socket.removeListener('close', cancel);
          }
          const statusEndpoint = options.httpEndpoint ?? null;
          response = { protocolVersion: VERSION, ok: true, result:
            parsedOperation === 'status' && options.isStopping?.() === true
              ? { state: options.isFailed?.() === true ? 'failed' : 'stopping', applicationVersion: packageManifest.version, httpEndpoint: statusEndpoint }
              : parsedOperation === 'status' && options.isReady?.() === false
                ? { state: 'starting', applicationVersion: packageManifest.version, httpEndpoint: statusEndpoint }
                : parsedOperation === 'status' && typeof result === 'object' && result !== null
                  ? { ...result, httpEndpoint: statusEndpoint }
                  : result };
        } catch (error) {
          response = failure(error instanceof SyntaxError
            ? new ControlError('CONTROL_INVALID_REQUEST', 'The local control request is not valid.')
            : error);
        }
        let body = `${JSON.stringify(response)}\n`;
        if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
          body = `${JSON.stringify(failure(new ControlError('CONTROL_RESPONSE_TOO_LARGE', 'The local control response exceeds its size limit.')))}\n`;
        }
        if (!socket.destroyed) {
          await new Promise<void>((done) => {
            socket.once('close', done);
            socket.end(body, done);
          });
        }
        if (response.ok && parsedOperation === 'service.stop' && options.stop !== undefined) {
          setImmediate(() => void options.stop?.().catch(() => {
            console.error('Skill Loom failed to stop after a local control request.');
            process.exitCode = 1;
          }));
        }
      })();
      active.add(operation);
      void operation.then(
        () => active.delete(operation),
        () => {
          active.delete(operation);
          socket.destroy();
          console.error('A local control response could not be completed.');
        },
      );
    });
  };
  const server = certificates === undefined ? createServer(accept) : createTlsServer({
    pfx: Buffer.from(certificates.server.pfx, 'base64'),
    passphrase: '',
    ca: new X509Certificate(Buffer.from(certificates.client.certificate, 'base64')).toString(),
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3',
    handshakeTimeout: 5_000,
    ALPNProtocols: ['loom-control-v1'],
  }, (socket: TLSSocket) => {
    if (!socket.authorized || socket.alpnProtocol !== 'loom-control-v1' ||
        !socket.getPeerCertificate().raw?.equals(Buffer.from(certificates.client.certificate, 'base64'))) {
      socket.destroy();
      return;
    }
    accept(socket);
  });
  // Bound unauthenticated TLS handshakes as well as accepted application clients.
  server.maxConnections = 32;
  const connections = new Set<Socket>();
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      const listening = (): void => {
        server.removeListener('error', reject);
        const address = server.address();
        if (certificates !== undefined && address !== null && typeof address !== 'string') {
          metadata.socket = `tls://127.0.0.1:${address.port}`;
        }
        resolveListen();
      };
      if (certificates === undefined) server.listen(metadata.socket, listening);
      else server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, listening);
    });
    await atomicWriteJson(join(root, 'control.json'), metadata);
  } catch (error) {
    try {
      if (server.listening) {
        const stopped = new Promise<void>((done, reject) => server.close((closeError) => closeError ? reject(closeError) : done()));
        for (const socket of connections) socket.destroy();
        await Promise.all(active);
        await stopped;
      }
      if (runtime !== undefined) await rmdir(runtime);
    } catch (cleanupError) {
      throw new ControlStartupCleanupError([error, cleanupError], 'Control endpoint startup failed and cleanup did not complete.');
    }
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  return {
    close() {
      if (closePromise !== undefined) return closePromise;
      closing = true;
      closePromise = (async () => {
        const stopped = new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
        for (const socket of eventStreams) socket.destroy();
        for (const socket of clients) if (socket.timeout !== 0) socket.destroy();
        await Promise.all(active);
        for (const socket of connections) socket.destroy();
        await stopped;
        const current = await readMetadata(root);
        if (current?.token === metadata.token) await unlink(join(root, 'control.json'));
        if (runtime !== undefined) await rmdir(runtime);
      })();
      return closePromise;
    },
  };
}

async function streamRunEvents(
  socket: Socket,
  runId: string,
  owner: RunOwner,
  streams: Set<Socket>,
): Promise<void> {
  streams.add(socket);
  let closed = socket.destroyed;
  let ending = false;
  let unsubscribe: (() => void) | undefined;
  const detach = (): void => {
    const current = unsubscribe;
    unsubscribe = undefined;
    current?.();
  };
  const finished = new Promise<void>((done) => {
    socket.once('close', () => {
      closed = true;
      detach();
      streams.delete(socket);
      done();
    });
    if (closed) {
      streams.delete(socket);
      done();
    }
  });
  try {
    const orchestrator = await owner.get();
    if (closed) return;
    const attached = await orchestrator.subscribe(runId, (message) => {
      if (closed || ending || message.type === 'output') return;
      const { chunk: _chunk, ...event } = message.type === 'snapshot'
        ? { ...message, chunk: undefined }
        : message;
      const line = `${JSON.stringify({ protocolVersion: VERSION, ok: true, event } satisfies ControlEvent)}\n`;
      if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES || socket.writableLength + Buffer.byteLength(line) > MAX_STREAM_BUFFER_BYTES) {
        ending = true;
        socket.end(`${JSON.stringify(failure(new ControlError(
          'CONTROL_STREAM_BACKPRESSURE', 'The event stream exceeded its output buffer; reconnect to obtain a new snapshot.',
        )))}\n`);
        return;
      }
      socket.write(line);
    });
    if (closed) attached();
    else unsubscribe = attached;
    await finished;
  } finally {
    detach();
    streams.delete(socket);
  }
}

async function streamRunTerminal(
  socket: Socket,
  runId: string,
  owner: RunOwner,
  manager: TerminalManager,
  streams: Set<Socket>,
): Promise<void> {
  const orchestrator = await owner.get();
  const view = await orchestrator.getRunView(runId);
  if (view.terminalId === null) {
    throw new ControlError('TERMINAL_NOT_FOUND', 'This run has no live terminal to attach.');
  }
  streams.add(socket);
  let closed = socket.destroyed;
  let ending = false;
  let attachment: TerminalAttachment | undefined;
  let incoming = Buffer.alloc(0);
  const finished = new Promise<void>((done) => {
    socket.once('close', () => {
      closed = true;
      attachment?.detach();
      attachment = undefined;
      streams.delete(socket);
      done();
    });
    if (closed) {
      streams.delete(socket);
      done();
    }
  });
  const fail = (error: ControlError): void => {
    if (closed || ending) return;
    ending = true;
    socket.end(`${JSON.stringify(failure(error))}\n`);
  };
  const subscriber: TerminalSubscriber = {
    send(message) {
      if (closed || ending) return;
      const line = `${JSON.stringify({ protocolVersion: VERSION, ok: true, terminal: message })}\n`;
      if (socket.writableLength + Buffer.byteLength(line) > MAX_STREAM_BUFFER_BYTES) {
        fail(new ControlError('CONTROL_STREAM_BACKPRESSURE', 'The terminal consumer is too slow; reconnect to see the bounded tail.'));
        return;
      }
      socket.write(line);
    },
    close() {
      if (closed || ending) return;
      ending = true;
      socket.end();
    },
  };
  const inputSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('input'), data: z.string().max(64 * 1024) }),
    z.strictObject({ type: z.literal('resize'), cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) }),
    z.strictObject({ type: z.literal('detach') }),
  ]);
  const onData = (chunk: Buffer): void => {
    if (closed || ending) return;
    incoming = Buffer.concat([incoming, chunk]);
    while (true) {
      const newline = incoming.indexOf(10);
      if (newline < 0) break;
      if (newline > MAX_REQUEST_BYTES) {
        fail(new ControlError('CONTROL_REQUEST_TOO_LARGE', 'A terminal input frame exceeded its size limit.'));
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(incoming.subarray(0, newline).toString('utf8')) as unknown;
      } catch {
        fail(new ControlError('CONTROL_INVALID_REQUEST', 'The terminal input frame is not valid JSON.'));
        return;
      }
      incoming = incoming.subarray(newline + 1);
      const parsed = inputSchema.safeParse(decoded);
      if (!parsed.success || (parsed.data.type === 'input' && Buffer.byteLength(parsed.data.data, 'utf8') > 64 * 1024)) {
        fail(new ControlError('CONTROL_INVALID_REQUEST', 'The terminal input frame is not valid.'));
        return;
      }
      if (parsed.data.type === 'detach') {
        ending = true;
        socket.end(`${JSON.stringify({ protocolVersion: VERSION, ok: true, terminal: { type: 'detached' } })}\n`);
        return;
      }
      try {
        if (parsed.data.type === 'input') attachment?.session.write(parsed.data.data);
        else attachment?.session.resize(parsed.data.cols, parsed.data.rows);
      } catch (error) {
        if (error instanceof TerminalTransportError) {
          fail(new ControlError(error.code, error.message, error.details));
        } else {
          fail(new ControlError('TERMINAL_INTERNAL_ERROR', 'The terminal input could not be applied.'));
        }
        return;
      }
    }
    if (incoming.length > MAX_REQUEST_BYTES) {
      fail(new ControlError('CONTROL_REQUEST_TOO_LARGE', 'A terminal input frame exceeded its size limit.'));
    }
  };
  try {
    if (closed) return;
    attachment = manager.attach(view.terminalId, subscriber);
    if (closed) {
      attachment.detach();
      attachment = undefined;
      return;
    }
    socket.on('data', onData);
    await finished;
  } finally {
    socket.off('data', onData);
    attachment?.detach();
    streams.delete(socket);
  }
}

async function controlMetadata(configDirectory: string): Promise<Metadata> {
  requireControlPlatform();
  let root: string;
  try {
    root = await realpath(resolve(configDirectory));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new ControlError('CONTROL_UNAVAILABLE', 'No Skill Loom service owns this profile. Start the service first.');
    }
    throw error;
  }
  if (process.platform !== 'win32') await assertPrivateDirectory(root, true);
  const metadata = await readMetadata(process.platform === 'win32' ? resolve(configDirectory) : root);
  if (metadata === null) throw new ControlError('CONTROL_UNAVAILABLE', 'No Skill Loom service owns this profile. Start the service first.');
  if (metadata.applicationVersion !== packageManifest.version) {
    throw new ControlError('CONTROL_VERSION_UNSUPPORTED', 'The running Skill Loom service has a different application version.');
  }
  if (metadata.tls !== undefined) return metadata;
  try {
    await assertPrivateDirectory(dirname(metadata.socket), false);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new ControlError('CONTROL_UNAVAILABLE', 'The Skill Loom service is unavailable. Restart it and retry.');
    }
    throw error;
  }
  return metadata;
}

export async function callControl(configDirectory: string, operation: string, input: unknown): Promise<ControlResponse> {
  const metadata = await controlMetadata(configDirectory);
  const request = `${JSON.stringify({ version: VERSION, token: metadata.token, operation, input })}\n`;
  if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) throw new ControlError('CONTROL_REQUEST_TOO_LARGE', 'The local control request exceeds its size limit.');
  return new Promise<ControlResponse>((resolveResponse, reject) => {
    const socket = connectControl(metadata);
    const chunks: Buffer[] = [];
    let size = 0;
    let completed = false;
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new ControlError('CONTROL_UNAVAILABLE', 'The Skill Loom service did not accept the connection.'));
    });
    socket.once(connected(metadata), () => {
      socket.setTimeout(0);
      socket.write(request);
    });
    socket.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        socket.destroy();
        reject(new ControlError('CONTROL_RESPONSE_TOO_LARGE', 'The local control response exceeds its size limit.'));
        return;
      }
      chunks.push(chunk);
    });
    socket.once('end', () => {
      try {
        const raw: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
        const response = z.union([
          z.strictObject({ protocolVersion: z.literal(VERSION), ok: z.literal(true), result: z.unknown() }),
          z.strictObject({ protocolVersion: z.literal(VERSION), ok: z.literal(false), error: z.strictObject({
            code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional(),
          }) }),
        ]).parse(raw);
        completed = true;
        resolveResponse(response);
      } catch {
        reject(new ControlError('CONTROL_INVALID_RESPONSE', 'The local control response is invalid or incompatible.'));
      }
    });
    socket.once('error', () => reject(new ControlError('CONTROL_UNAVAILABLE', 'The Skill Loom service is unavailable. Restart it and retry.')));
    socket.once('close', () => {
      if (!completed) reject(new ControlError('CONTROL_UNAVAILABLE', 'The Skill Loom service closed the connection before replying.'));
    });
  });
}

export async function streamControlEvents(
  configDirectory: string,
  runId: string,
  onEvent: (event: unknown) => boolean,
  signal?: AbortSignal,
): Promise<void> {
  const metadata = await controlMetadata(configDirectory);
  const request = `${JSON.stringify({ version: VERSION, token: metadata.token, operation: 'run.events', input: { runId } })}\n`;
  if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) {
    throw new ControlError('CONTROL_REQUEST_TOO_LARGE', 'The local control request exceeds its size limit.');
  }
  return receiveControlEvents(metadata, request, runId, onEvent, signal);
}

export async function attachControlTerminal(
  configDirectory: string,
  runId: string,
  stdin: Readable,
  stdout: Pick<NodeJS.WriteStream, 'write' | 'isTTY'> & Partial<Pick<NodeJS.WriteStream, 'columns' | 'rows'>>,
): Promise<void> {
  if (!('isTTY' in stdin) || stdin.isTTY !== true || !('setRawMode' in stdin) ||
      typeof stdin.setRawMode !== 'function' || stdout.isTTY !== true) {
    throw new ControlError('TERMINAL_TTY_REQUIRED', 'Interactive terminal attachment requires a TTY on stdin and stdout.');
  }
  const input = stdin as Readable & { setRawMode(value: boolean): unknown; isRaw?: boolean };
  const metadata = await controlMetadata(configDirectory);
  const request = `${JSON.stringify({ version: VERSION, token: metadata.token, operation: 'run.attach', input: { runId } })}\n`;
  if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) {
    throw new ControlError('CONTROL_REQUEST_TOO_LARGE', 'The local control request exceeds its size limit.');
  }
  const terminalSchema = z.strictObject({
    protocolVersion: z.literal(VERSION), ok: z.literal(true),
    terminal: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('ready'), sessionId: z.string(), pid: z.number(), cols: z.number(), rows: z.number() }),
      z.strictObject({ type: z.literal('output'), data: z.string() }),
      z.strictObject({ type: z.literal('exit'), exitCode: z.number(), signal: z.number().optional() }),
      z.strictObject({ type: z.literal('detached') }),
    ]),
  });
  const errorSchema = z.strictObject({
    protocolVersion: z.literal(VERSION), ok: z.literal(false),
    error: z.strictObject({
      code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional(),
    }),
  });
  return new Promise<void>((resolveTerminal, reject) => {
    const socket = connectControl(metadata);
    const decoder = new StringDecoder('utf8');
    let buffer = Buffer.alloc(0);
    let finished = false;
    let ready = false;
    let raw = false;
    const wasRaw = input.isRaw === true;
    const wasFlowing = stdin.readableFlowing === true;
    const finish = (error?: ControlError): void => {
      if (finished) return;
      finished = true;
      stdin.off('data', onInput);
      stdin.off('end', inputClosed);
      stdin.off('error', inputError);
      if (!wasFlowing) stdin.pause();
      process.removeListener('SIGWINCH', resize);
      process.removeListener('SIGINT', interrupted);
      process.removeListener('SIGTERM', interrupted);
      if (raw) {
        try {
          input.setRawMode(wasRaw);
        } catch {
          error ??= new ControlError('TERMINAL_TTY_FAILED', 'The terminal mode could not be restored.');
        }
      }
      socket.destroy();
      if (error === undefined) resolveTerminal();
      else reject(error);
    };
    const send = (message: unknown): void => {
      if (finished || socket.destroyed) return;
      const line = `${JSON.stringify(message)}\n`;
      if (Buffer.byteLength(line) > MAX_REQUEST_BYTES || socket.writableLength + Buffer.byteLength(line) > MAX_STREAM_BUFFER_BYTES) {
        finish(new ControlError('CONTROL_STREAM_BACKPRESSURE', 'Terminal input exceeded its buffer; reconnect to continue.'));
        return;
      }
      socket.write(line);
    };
    const resize = (): void => {
      if (!ready) return;
      const cols = Math.max(1, Math.min(1000, stdout.columns ?? 120));
      const rows = Math.max(1, Math.min(1000, stdout.rows ?? 32));
      send({ type: 'resize', cols, rows });
    };
    const interrupted = (): void => finish(new ControlError('TERMINAL_INTERRUPTED', 'Terminal attachment was interrupted; the run remains active.'));
    const inputClosed = (): void => finish(new ControlError('TERMINAL_INPUT_CLOSED', 'Terminal input closed; the run remains active.'));
    const inputError = (): void => finish(new ControlError('TERMINAL_INPUT_FAILED', 'Terminal input failed; the run remains active.'));
    const onInput = (chunk: Buffer | string): void => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      const detach = bytes.indexOf(0x1d);
      const content = detach < 0 ? bytes : bytes.subarray(0, detach);
      for (let offset = 0; offset < content.length && !finished; offset += 8192) {
        const text = decoder.write(content.subarray(offset, offset + 8192));
        if (text !== '') send({ type: 'input', data: text });
      }
      if (detach >= 0) {
        const rest = decoder.end();
        if (rest !== '') send({ type: 'input', data: rest });
        stdin.off('data', onInput);
        send({ type: 'detach' });
      }
    };
    socket.setTimeout(5_000, () => finish(new ControlError('CONTROL_UNAVAILABLE', 'The Skill Loom service did not accept the connection.')));
    socket.once(connected(metadata), () => {
      socket.setTimeout(0);
      socket.write(request);
    });
    socket.on('data', (chunk: Buffer) => {
      if (finished) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const newline = buffer.indexOf(10);
        if (newline < 0) break;
        if (newline > MAX_RESPONSE_BYTES) {
          finish(new ControlError('CONTROL_RESPONSE_TOO_LARGE', 'The terminal frame exceeds its size limit.'));
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(buffer.subarray(0, newline).toString('utf8')) as unknown;
        } catch {
          finish(new ControlError('CONTROL_INVALID_RESPONSE', 'The terminal returned invalid JSON.'));
          return;
        }
        buffer = buffer.subarray(newline + 1);
        const failureResult = errorSchema.safeParse(value);
        if (failureResult.success) {
          finish(new ControlError(failureResult.data.error.code, failureResult.data.error.message, failureResult.data.error.details));
          return;
        }
        const parsed = terminalSchema.safeParse(value);
        if (!parsed.success || (!ready && parsed.data.terminal.type !== 'ready')) {
          finish(new ControlError('CONTROL_INVALID_RESPONSE', 'The terminal returned an invalid or out-of-order frame.'));
          return;
        }
        const message = parsed.data.terminal;
        if (message.type === 'ready') {
          if (ready) {
            finish(new ControlError('CONTROL_INVALID_RESPONSE', 'The terminal sent more than one ready frame.'));
            return;
          }
          ready = true;
          try {
            input.setRawMode(true);
            raw = true;
          } catch {
            finish(new ControlError('TERMINAL_TTY_FAILED', 'The terminal could not enter raw mode.'));
            return;
          }
          stdin.on('data', onInput);
          stdin.once('end', inputClosed);
          stdin.once('error', inputError);
          process.on('SIGWINCH', resize);
          process.once('SIGINT', interrupted);
          process.once('SIGTERM', interrupted);
          resize();
          stdin.resume();
        } else if (message.type === 'output') {
          try {
            if (!stdout.write(message.data)) {
              finish(new ControlError('CONTROL_STREAM_BACKPRESSURE', 'Terminal output could not keep up; reconnect to see the bounded tail.'));
              return;
            }
          } catch {
            finish(new ControlError('CONTROL_STREAM_OUTPUT_FAILED', 'The terminal output could not be written.'));
            return;
          }
        } else {
          finish();
          return;
        }
        if (finished) return;
      }
      if (buffer.length > MAX_RESPONSE_BYTES) {
        finish(new ControlError('CONTROL_RESPONSE_TOO_LARGE', 'The terminal frame exceeds its size limit.'));
      }
    });
    socket.once('error', () => finish(new ControlError('CONTROL_UNAVAILABLE', 'The Skill Loom service is unavailable. Restart it and retry.')));
    socket.once('close', () => {
      if (!finished) finish(new ControlError('CONTROL_UNAVAILABLE', 'The terminal disconnected; the run may still be active.'));
    });
  });
}

async function receiveControlEvents(
  metadata: Metadata,
  request: string,
  runId: string,
  onEvent: (event: unknown) => boolean,
  signal?: AbortSignal,
): Promise<void> {
  const eventSchema = z.strictObject({
    protocolVersion: z.literal(VERSION),
    ok: z.literal(true),
    event: z.looseObject({
      type: z.string().min(1), runId: z.string(), sequence: z.number().int().min(0),
      run: z.unknown(), terminalId: z.string().nullable(), actions: z.unknown(),
    }),
  });
  const errorSchema = z.strictObject({
    protocolVersion: z.literal(VERSION), ok: z.literal(false),
    error: z.strictObject({
      code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional(),
    }),
  });
  return new Promise<void>((resolveStream, reject) => {
    const socket = connectControl(metadata);
    let buffer = Buffer.alloc(0);
    let finished = false;
    let gotSnapshot = false;
    let lastSequence = -1;
    const finish = (error?: ControlError): void => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error === undefined) resolveStream();
      else reject(error);
    };
    const abort = (): void => finish();
    if (signal?.aborted === true) {
      finish();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    socket.setTimeout(5_000, () => finish(new ControlError('CONTROL_UNAVAILABLE', 'The Skill Loom service did not accept the connection.')));
    socket.once(connected(metadata), () => {
      socket.setTimeout(0);
      socket.write(request);
    });
    socket.on('data', (chunk: Buffer) => {
      if (finished) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const newline = buffer.indexOf(10);
        if (newline < 0) break;
        if (newline > MAX_RESPONSE_BYTES) {
          finish(new ControlError('CONTROL_RESPONSE_TOO_LARGE', 'The event exceeds its size limit.'));
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(buffer.subarray(0, newline).toString('utf8')) as unknown;
        } catch {
          finish(new ControlError('CONTROL_INVALID_RESPONSE', 'The event stream returned invalid JSON.'));
          return;
        }
        buffer = buffer.subarray(newline + 1);
        const error = errorSchema.safeParse(value);
        if (error.success) {
          finish(new ControlError(error.data.error.code, error.data.error.message, error.data.error.details));
          return;
        }
        const event = eventSchema.safeParse(value);
        if (!event.success || event.data.event.runId !== runId ||
            (!gotSnapshot && event.data.event.type !== 'snapshot') ||
            (gotSnapshot && (event.data.event.type === 'snapshot' || event.data.event.sequence <= lastSequence))) {
          finish(new ControlError('CONTROL_INVALID_RESPONSE', 'The event stream returned an invalid or out-of-order event.'));
          return;
        }
        gotSnapshot = true;
        lastSequence = event.data.event.sequence;
        try {
          if (!onEvent(event.data)) {
            finish(new ControlError('CONTROL_STREAM_BACKPRESSURE', 'The output consumer is too slow; reconnect for a new snapshot.'));
            return;
          }
        } catch {
          finish(new ControlError('CONTROL_STREAM_OUTPUT_FAILED', 'The event stream could not be written to its output consumer.'));
          return;
        }
        if (finished) return;
      }
      if (buffer.length > MAX_RESPONSE_BYTES) {
        finish(new ControlError('CONTROL_RESPONSE_TOO_LARGE', 'The event exceeds its size limit.'));
      }
    });
    socket.once('error', () => finish(new ControlError('CONTROL_UNAVAILABLE', 'The Skill Loom service is unavailable. Restart it and retry.')));
    socket.once('close', () => {
      if (!finished) finish(new ControlError('CONTROL_UNAVAILABLE', 'The event stream closed; reconnect for a new snapshot.'));
    });
  });
}
