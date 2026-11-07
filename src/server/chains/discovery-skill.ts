import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function scenarioDiscoverySkillPackagePath(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, '../../../skills/scenario-discovery'),
    resolve(moduleDirectory, '../../../.github/skills/scenario-discovery'),
    resolve(moduleDirectory, '../../../../.github/skills/scenario-discovery'),
  ];
  const packagePath = candidates.find((candidate) =>
    existsSync(resolve(candidate, 'SKILL.md')) &&
    existsSync(resolve(candidate, 'scripts', 'build-bundle.mjs')),
  );
  if (packagePath === undefined) {
    throw new Error('The packaged scenario-discovery skill is not available.');
  }
  return packagePath;
}
