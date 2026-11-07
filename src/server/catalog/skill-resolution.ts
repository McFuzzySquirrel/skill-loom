import { resolve } from 'node:path';
import type { SkillSnapshotBinding } from '../../shared/chain.js';
import type { SkillEntry } from './types.js';

export type SkillPackageResolution =
  | { status: 'resolved'; entry: SkillEntry; matches: SkillEntry[] }
  | { status: 'missing'; matches: SkillEntry[] }
  | { status: 'disabled'; matches: SkillEntry[] }
  | { status: 'binding-unavailable'; matches: SkillEntry[] }
  | {
      status: 'ambiguous';
      matches: SkillEntry[];
      candidates: SkillEntry[];
      scope: 'project' | 'non-project' | 'snapshot';
    };

export function resolveSkillCatalogEntry(
  entries: readonly SkillEntry[],
  selection: { skillName: string; skillBinding?: SkillSnapshotBinding | undefined },
): SkillPackageResolution {
  const exact = entries.filter((entry) => entry.name === selection.skillName);
  const matches = exact.length > 0
    ? exact
    : entries.filter(
        (entry) =>
          entry.name.toLocaleLowerCase('en-US') ===
          selection.skillName.toLocaleLowerCase('en-US'),
      );
  const available = matches.filter((entry) => entry.enabled !== false);

  if (selection.skillBinding !== undefined) {
    const snapshotMatches = matches.filter(
      (entry) =>
        entry.source === 'remote' &&
        entry.sourceId === selection.skillBinding?.sourceId &&
        entry.revision === selection.skillBinding?.revision &&
        entry.repositoryPath === selection.skillBinding?.repositoryPath,
    );
    const candidates = uniquePackages(
      snapshotMatches.filter((entry) => entry.enabled !== false),
    );
    if (candidates.length === 1) {
      return { status: 'resolved', entry: candidates[0]!, matches };
    }
    if (candidates.length > 1) {
      return { status: 'ambiguous', matches, candidates, scope: 'snapshot' };
    }
    if (snapshotMatches.length > 0) {
      return { status: 'disabled', matches };
    }
    return { status: 'binding-unavailable', matches };
  }

  if (available.length === 0) {
    return { status: matches.length === 0 ? 'missing' : 'disabled', matches };
  }

  const projectPackages = uniquePackages(
    available.filter((entry) => entry.source === 'project'),
  );
  if (projectPackages.length > 1) {
    return {
      status: 'ambiguous',
      matches,
      candidates: projectPackages,
      scope: 'project',
    };
  }
  if (projectPackages.length === 1) {
    return { status: 'resolved', entry: projectPackages[0]!, matches };
  }

  const otherPackages = uniquePackages(
    available.filter((entry) => entry.source !== 'project'),
  );
  if (otherPackages.length > 1) {
    return {
      status: 'ambiguous',
      matches,
      candidates: otherPackages,
      scope: 'non-project',
    };
  }
  if (otherPackages.length === 1) {
    return { status: 'resolved', entry: otherPackages[0]!, matches };
  }

  return { status: 'missing', matches };
}

function uniquePackages(entries: readonly SkillEntry[]): SkillEntry[] {
  const packages = new Map<string, SkillEntry>();
  for (const entry of entries) {
    const key = entry.packagePath
      ? resolve(entry.packagePath)
      : `unresolved:${entry.id}`;
    if (!packages.has(key)) {
      packages.set(key, entry);
    }
  }
  return [...packages.values()];
}
