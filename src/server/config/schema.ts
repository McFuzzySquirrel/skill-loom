import { z } from 'zod';

/**
 * Current on-disk global configuration version.
 *
 * The version is a literal so an older Slan cannot silently reinterpret a
 * document whose shape it does not understand. A deliberate migration is the
 * only way to move this value forward.
 */
export const CONFIG_VERSION = 1;

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
});
export type RecentProject = z.infer<typeof RecentProjectSchema>;

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
export const SlanConfigSchema = z.strictObject({
  version: z.literal(CONFIG_VERSION),
  harnessCommands: HarnessCommandsSchema.default({}),
  extraSkillDirectories: z.array(NonEmptyStringSchema).default([]),
  recentProjects: z.array(RecentProjectSchema).default([]),
  uiPreferences: UiPreferencesSchema.default({}),
});
export type SlanConfig = z.infer<typeof SlanConfigSchema>;

/**
 * A partial update. The store merges only the supplied top-level fields and
 * merges the two maps (`harnessCommands`, `uiPreferences`) key by key, so a
 * feature that owns one field never erases fields owned by another feature.
 */
export const ConfigUpdateSchema = z.strictObject({
  harnessCommands: HarnessCommandsSchema.optional(),
  extraSkillDirectories: z.array(NonEmptyStringSchema).optional(),
  recentProjects: z.array(RecentProjectSchema).optional(),
  uiPreferences: UiPreferencesSchema.optional(),
});
export type ConfigUpdate = z.infer<typeof ConfigUpdateSchema>;

/** The documented defaults returned when the config file does not exist. */
export function createDefaultConfig(): SlanConfig {
  return SlanConfigSchema.parse({ version: CONFIG_VERSION });
}

/** Top-level configuration fields, used by tests and diagnostics. */
export const CONFIG_TOP_LEVEL_FIELDS = [
  'version',
  'harnessCommands',
  'extraSkillDirectories',
  'recentProjects',
  'uiPreferences',
] as const;
