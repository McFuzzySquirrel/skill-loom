import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAIN_VERSION, validateChain } from '../../src/server/chains/model.js';
import {
  scenarioCatalog,
  scenarioSkillPackagePath,
} from '../../src/server/chains/presets.js';
import { SCENARIO_AUDIENCES } from '../../src/shared/presets.js';

describe('scenario preset catalog', () => {
  it('covers twelve examples for all four audiences', () => {
    expect(scenarioCatalog.scenarios).toHaveLength(12);
    expect([...new Set(scenarioCatalog.scenarios.map((scenario) => scenario.audience))]).toEqual(
      [...SCENARIO_AUDIENCES],
    );
    expect(scenarioCatalog.message).toMatch(/inspiration/i);
    expect(scenarioCatalog.message).toMatch(/independently authored/i);
  });

  it('validates every variant as an ordinary shared chain', () => {
    for (const [scenarioIndex, scenario] of scenarioCatalog.scenarios.entries()) {
      expect(scenario.variants.length).toBeGreaterThan(0);
      for (const variant of scenario.variants) {
        expect(() =>
          validateChain({
            version: CHAIN_VERSION,
            id: `example-${String(scenarioIndex)}`,
            name: `${scenario.name} - ${variant.name}`,
            harness: 'opencode',
            sessionMode: 'shared',
            steps: variant.steps,
            inputs: variant.inputs,
            automaticPermissionOptIn: false,
            createdAt: '2026-11-05T00:00:00.000Z',
            updatedAt: '2026-11-05T00:00:00.000Z',
          }),
        ).not.toThrow();
      }
    }
  });

  it('attributes every required third-party skill to a licensed source', () => {
    const sources = new Map(
      scenarioCatalog.skills.map((skill) => [skill.name, skill]),
    );
    const requiredSkills = new Set(
      scenarioCatalog.scenarios.flatMap((scenario) =>
        scenario.variants.flatMap((variant) =>
          variant.steps.flatMap((step) =>
            step.kind === 'instruction' ? [] : [step.skillName],
          ),
        ),
      ),
    );

    expect(requiredSkills.size).toBeGreaterThan(0);
    for (const skillName of requiredSkills) {
      const source = sources.get(skillName);
      expect(source, `missing source attribution for ${skillName}`).toBeDefined();
      expect(source?.repositoryUrl).toMatch(/^https:\/\/github\.com\//);
      expect(source?.skillUrl).toMatch(/^https:\/\/skills\.sh\//);
      expect(source?.skillFileUrl).toMatch(/^https:\/\/github\.com\//);
      expect(source?.license).toMatch(/^(MIT|Apache-2\.0)$/);
      expect(source?.installationCommand).toContain(skillName);
      expect(source?.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(source?.skillFileUrl).toContain(`/blob/${source?.revision}/`);
      expect(source?.bundled).toBe(true);
    }
  });

  it('maps only catalogued skill names to bundled package directories', async () => {
    for (const source of scenarioCatalog.skills) {
      const packagePath = scenarioSkillPackagePath(source.name);
      expect(packagePath).toBeDefined();
      await access(join(packagePath!, 'SKILL.md'));
    }
    expect(scenarioSkillPackagePath('../../package.json')).toBeUndefined();
  });
});
