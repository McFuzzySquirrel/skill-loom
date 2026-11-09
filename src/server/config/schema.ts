import { z } from 'zod';
import type { RemoteCatalogLimits } from '../../shared/remote-catalog.js';
export type { RemoteCatalogLimits } from '../../shared/remote-catalog.js';

/**
 * Current on-disk global configuration version.
 *
 * The version is a literal so an older Skill Loom cannot silently reinterpret a
 * document whose shape it does not understand. A deliberate migration is the
 * only way to move this value forward.
 */
export const CONFIG_VERSION = 2;

export const CONFIG_FILE_NAME = 'config.json';

/** Harness identifiers supported by the v1 adapter registry. */
export const HARNESS_IDS = ['opencode', 'copilot'] as const;
export const HarnessIdSchema = z.enum(HARNESS_IDS);
export type HarnessId = z.infer<typeof HarnessIdSchema>;

const NonEmptyStringSchema = z.string().trim().min(1);

/**
 * Explicit executable overrides. A missing entry means "resolve from PATH".
 * Values are command names or absolute executable paths, never shell strings.
 */
export const HarnessCommandsSchema = z.strictObject({
  opencode: NonEmptyStringSchema.optional(),
  copilot: NonEmptyStringSchema.optional(),
});
export type HarnessCommands = z.infer<typeof HarnessCommandsSchema>;

/**
 * A recent project entry. The id is derived by the server from the canonical
 * path when the project is registered; the config store only persists it.
 */
export const RecentProjectSchema = z.strictObject({
  id: NonEmptyStringSchema,
  canonicalPath: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  lastOpenedAt: z.iso.datetime({ offset: true }),
  managedWorkspace: z.literal(true).optional(),
});
export type RecentProject = z.infer<typeof RecentProjectSchema>;

export const TestWorkspaceRecordSchema = z.strictObject({
  id: z.uuid(),
  projectId: NonEmptyStringSchema,
  sourceProjectId: NonEmptyStringSchema.optional(),
  sourceChainId: NonEmptyStringSchema.optional(),
  sourceDraftId: NonEmptyStringSchema.optional(),
  chainId: NonEmptyStringSchema,
  createdAt: z.iso.datetime({ offset: true }),
}).superRefine((record, context) => {
  const projectSource = record.sourceProjectId !== undefined && record.sourceChainId !== undefined;
  const draftSource = record.sourceDraftId !== undefined;
  if (projectSource === draftSource) {
    context.addIssue({
      code: 'custom',
      message: 'A test workspace must have exactly one valid source chain or draft.',
    });
  }
  if ((record.sourceProjectId === undefined) !== (record.sourceChainId === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'A project source requires both project and chain ids.',
    });
  }
});
export type TestWorkspaceRecord = z.infer<typeof TestWorkspaceRecordSchema>;

export const DiscoveryWorkspaceRecordSchema = z.strictObject({
  id: z.uuid(),
  projectId: NonEmptyStringSchema,
  chainId: NonEmptyStringSchema,
  harness: HarnessIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  handoffFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  autoImport: z.boolean(),
  runId: NonEmptyStringSchema.optional(),
  resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  importedDraftId: NonEmptyStringSchema.optional(),
});
export type DiscoveryWorkspaceRecord = z.infer<typeof DiscoveryWorkspaceRecordSchema>;

const GitRemoteSchema = z.string().trim().min(1).max(2_048).refine((value) => {
  const scpRemote = /^git@[^/:\\\s]+:[^\\\s?#]+(?:\.git)?$/i;
  if (scpRemote.test(value)) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === 'https:' || parsed.protocol === 'ssh:') &&
    (parsed.username === '' || (parsed.protocol === 'ssh:' && parsed.username === 'git')) &&
    parsed.password === '' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    parsed.hostname !== ''
  );
}, 'Use an HTTPS or SSH Git remote without embedded credentials or query parameters.');

const GitRefSchema = z.string().trim().min(1).max(255).refine((value) =>
  /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
  !value.includes('..') &&
  !value.includes('//') &&
  !value.includes('@{') &&
  !value.endsWith('/') &&
  !value.endsWith('.') &&
  !value.split('/').some((part) => part.endsWith('.lock')),
'Use a branch, tag, or full commit hash.');

export const REMOTE_CATALOG_DEFAULT_LIMITS = {
  maxPackages: 100,
  maxAgents: 100,
  maxFiles: 2_000,
  maxPackageBytes: 20 * 1024 * 1024,
  maxSnapshotBytes: 20 * 1024 * 1024,
  maxStagingBytes: 128 * 1024 * 1024,
  maxStagingEntries: 10_000,
  maxCommandOutputBytes: 2 * 1024 * 1024,
  cloneTimeoutMs: 120_000,
  commandTimeoutMs: 15_000,
} as const;

export const REMOTE_CATALOG_HARD_LIMITS = {
  maxPackages: 10_000,
  maxAgents: 10_000,
  maxFiles: 200_000,
  maxPackageBytes: 256 * 1024 * 1024,
  maxSnapshotBytes: 1024 * 1024 * 1024,
  maxStagingBytes: 4 * 1024 * 1024 * 1024,
  maxStagingEntries: 500_000,
  maxCommandOutputBytes: 64 * 1024 * 1024,
  cloneTimeoutMs: 30 * 60_000,
  commandTimeoutMs: 30 * 60_000,
} as const;

const limitField = (maximum: number) => z.number().int().min(1).max(maximum);
const remoteLimitFields = {
  maxPackages: limitField(REMOTE_CATALOG_HARD_LIMITS.maxPackages),
  maxAgents: limitField(REMOTE_CATALOG_HARD_LIMITS.maxAgents),
  maxFiles: limitField(REMOTE_CATALOG_HARD_LIMITS.maxFiles),
  maxPackageBytes: limitField(REMOTE_CATALOG_HARD_LIMITS.maxPackageBytes),
  maxSnapshotBytes: limitField(REMOTE_CATALOG_HARD_LIMITS.maxSnapshotBytes),
  maxStagingBytes: limitField(REMOTE_CATALOG_HARD_LIMITS.maxStagingBytes),
  maxStagingEntries: limitField(REMOTE_CATALOG_HARD_LIMITS.maxStagingEntries),
  maxCommandOutputBytes: limitField(REMOTE_CATALOG_HARD_LIMITS.maxCommandOutputBytes),
  cloneTimeoutMs: limitField(REMOTE_CATALOG_HARD_LIMITS.cloneTimeoutMs),
  commandTimeoutMs: limitField(REMOTE_CATALOG_HARD_LIMITS.commandTimeoutMs),
};
export const RemoteCatalogLimitOverridesSchema = z.strictObject(remoteLimitFields).partial();
export const RemoteCatalogLimitsSchema = z.strictObject(remoteLimitFields) satisfies z.ZodType<RemoteCatalogLimits>;

const RemoteSkillSourceV1Schema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  repository: GitRemoteSchema,
  ref: GitRefSchema.optional(),
});
export const RemoteSkillSourceSchema = RemoteSkillSourceV1Schema.extend({
  limits: RemoteCatalogLimitOverridesSchema.optional(),
});
export type RemoteSkillSource = z.infer<typeof RemoteSkillSourceSchema>;

/**
 * Opaque UI preferences (theme, density, last route, and similar). The server
 * does not interpret these values; the web client owns their meaning.
 */
export const UiPreferencesSchema = z.record(z.string(), z.unknown());
export type UiPreferences = z.infer<typeof UiPreferencesSchema>;

/**
 * The whole global configuration document.
 *
 * `strictObject` is deliberate. Credential-like keys are not part of the
 * schema, so an `apiKey`, `token`, or `secret` field is structurally invalid
 * rather than an accidentally accepted passthrough value. Unknown top-level
 * keys also surface as a corrupt document instead of silently disappearing on
 * the next write.
 */
const commonConfigFields = {
  harnessCommands: HarnessCommandsSchema.default({}),
  extraSkillDirectories: z.array(NonEmptyStringSchema).default([]),
  sharedBundleDirectory: NonEmptyStringSchema.optional(),
  recentProjects: z.array(RecentProjectSchema).default([]),
  testWorkspaces: z.array(TestWorkspaceRecordSchema).default([]),
  discoveryWorkspaces: z.array(DiscoveryWorkspaceRecordSchema).default([]),
  uiPreferences: UiPreferencesSchema.default({}),
};
export const LoomConfigV1Schema = z.strictObject({
  version: z.literal(1),
  ...commonConfigFields,
  remoteSkillSources: z.array(RemoteSkillSourceV1Schema).default([]),
});
export const LoomConfigSchema = z.strictObject({
  version: z.literal(CONFIG_VERSION),
  harnessCommands: commonConfigFields.harnessCommands,
  extraSkillDirectories: commonConfigFields.extraSkillDirectories,
  remoteSkillSources: z.array(RemoteSkillSourceSchema).default([]),
  remoteCatalogLimits: RemoteCatalogLimitsSchema.default(REMOTE_CATALOG_DEFAULT_LIMITS),
  sharedBundleDirectory: commonConfigFields.sharedBundleDirectory,
  recentProjects: commonConfigFields.recentProjects,
  testWorkspaces: commonConfigFields.testWorkspaces,
  discoveryWorkspaces: commonConfigFields.discoveryWorkspaces,
  uiPreferences: commonConfigFields.uiPreferences,
});
export type LoomConfig = z.infer<typeof LoomConfigSchema>;

/**
 * A partial update. The store merges only the supplied top-level fields and
 * merges the two maps (`harnessCommands`, `uiPreferences`) key by key, so a
 * feature that owns one field never erases fields owned by another feature.
 */
export const ConfigUpdateSchema = z.strictObject({
  harnessCommands: HarnessCommandsSchema.optional(),
  extraSkillDirectories: z.array(NonEmptyStringSchema).optional(),
  remoteSkillSources: z.array(RemoteSkillSourceSchema).optional(),
  remoteCatalogLimits: RemoteCatalogLimitOverridesSchema.optional(),
  sharedBundleDirectory: NonEmptyStringSchema.nullable().optional(),
  recentProjects: z.array(RecentProjectSchema).optional(),
  testWorkspaces: z.array(TestWorkspaceRecordSchema).optional(),
  discoveryWorkspaces: z.array(DiscoveryWorkspaceRecordSchema).optional(),
  uiPreferences: UiPreferencesSchema.optional(),
});
export type ConfigUpdate = z.infer<typeof ConfigUpdateSchema>;

/** The documented defaults returned when the config file does not exist. */
export function createDefaultConfig(): LoomConfig {
  return LoomConfigSchema.parse({ version: CONFIG_VERSION });
}

/** Top-level configuration fields, used by tests and diagnostics. */
export const CONFIG_TOP_LEVEL_FIELDS = [
  'version',
  'harnessCommands',
  'extraSkillDirectories',
  'remoteSkillSources',
  'remoteCatalogLimits',
  'sharedBundleDirectory',
  'recentProjects',
  'testWorkspaces',
  'discoveryWorkspaces',
  'uiPreferences',
] as const;
