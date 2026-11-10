/** Skill identity used when binding a chain step to a pinned skill. */
export type CatalogHarness = 'opencode' | 'copilot';

export const SKILL_SOURCES = [
  'project',
  'personal',
  'custom',
  'plugin',
  'builtin',
  'loom-extra',
  'remote',
] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

/** One discovered skill package. */
export interface SkillEntry {
  /** Stable server id; never derived from the skill name. */
  id: string;
  harness: CatalogHarness;
  source: SkillSource;
  name: string;
  description: string;
  /** Canonical absolute path to the package `SKILL.md`. */
  path: string;
  /** Canonical absolute path to the package directory. */
  packagePath: string;
  /** Canonical Loom-configured root for entries discovered from an extra directory. */
  sourceDirectory?: string;
  sourceId?: string;
  repository?: string;
  revision?: string;
  repositoryPath?: string;
  /** Copilot can report disabled entries; filesystem discovery is enabled. */
  enabled: boolean;
}
