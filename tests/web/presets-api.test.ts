import { describe, expect, it } from 'vitest';
import { createScenarioCatalogApi, decodeScenarioCatalog } from '../../src/web/api/presets.js';
import { scenarioCatalog } from '../../src/server/chains/presets.js';

describe('scenario catalog API client', () => {
  it('loads and decodes the read-only example catalog', async () => {
    let requestedUrl = '';
    let requestedMethod = '';
    const api = createScenarioCatalogApi(async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? '';
      return new Response(JSON.stringify(scenarioCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const catalog = await api.list();

    expect(requestedUrl).toBe('/api/chain-presets');
    expect(requestedMethod).toBe('GET');
    expect(catalog.scenarios).toHaveLength(12);
  });

  it('copies a bundled skill only through the explicit project API', async () => {
    let requestedUrl = '';
    let requestedMethod = '';
    let requestedBody = '';
    const api = createScenarioCatalogApi(async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? '';
      requestedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({
        name: 'minimax-xlsx',
        harness: 'opencode',
        destinationPath: '/project/.agents/skills/minimax-xlsx',
        revision: '60aaae52bb2af8162732751a4332f62a5fef518b',
        catalogSkillId: 'opencode-project-skill',
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await api.copySkill('project id', 'minimax-xlsx', 'opencode');

    expect(requestedUrl).toBe(
      '/api/projects/project%20id/catalog/scenario-skills/minimax-xlsx/copy',
    );
    expect(requestedMethod).toBe('POST');
    expect(JSON.parse(requestedBody)).toEqual({ harness: 'opencode' });
    expect(result.revision).toBe('60aaae52bb2af8162732751a4332f62a5fef518b');
  });

  it('rejects variants whose required skill has no source attribution', () => {
    const missingSkill = 'minimax-xlsx';
    const uncredited = {
      ...scenarioCatalog,
      skills: scenarioCatalog.skills.filter((skill) => skill.name !== missingSkill),
    };

    expect(() => decodeScenarioCatalog(uncredited)).toThrow(/attribution/i);
  });

  it('rejects sources with an unreviewed license', () => {
    const [first, ...rest] = scenarioCatalog.skills;
    expect(first).toBeDefined();
    const unlicensed = {
      ...scenarioCatalog,
      skills: [{ ...first!, license: 'Proprietary' }, ...rest],
    };

    expect(() => decodeScenarioCatalog(unlicensed)).toThrow(/skill source/i);
  });
});
