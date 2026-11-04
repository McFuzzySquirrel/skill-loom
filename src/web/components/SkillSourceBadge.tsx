import type { SkillSource } from '../api/catalog';

/** User-facing names for the six documented sources. */
export const SOURCE_LABELS: Record<SkillSource, string> = {
  project: 'Project',
  personal: 'Personal',
  custom: 'Custom',
  plugin: 'Plugin',
  builtin: 'Builtin',
  'loom-extra': 'Loom extra',
};

export interface SkillSourceBadgeProps {
  source: SkillSource;
}

/**
 * Source badge rendered on every row and group heading.
 *
 * Duplicate skill names are never collapsed, so this badge plus the canonical
 * path is what tells two same-named entries apart.
 */
export function SkillSourceBadge({ source }: SkillSourceBadgeProps) {
  return (
    <span className={`source-badge source-badge--${source}`} data-source-badge={source}>
      {SOURCE_LABELS[source]}
    </span>
  );
}
