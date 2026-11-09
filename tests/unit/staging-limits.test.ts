import { describe, expect, it } from 'vitest';
import { exceedsStagingLimits } from '../../src/server/catalog/staging-limits.js';

const limits = { maxStagingEntries: 10, maxStagingBytes: 5 };
const entry = (name: string, directory: boolean) => ({
  name,
  isDirectory: () => directory,
  isFile: () => !directory,
});
const failure = (code: string) => Object.assign(new Error(code), { code });
async function* entries(...values: ReturnType<typeof entry>[]) {
  yield* values;
}

describe('staging limit scan', () => {
  it('tolerates files and child directories removed by Git during the scan', async () => {
    const fs = {
      opendir: async (path: string) => {
        if (path === '/stage/gone') throw failure('ENOENT');
        return entries(entry('gone', true), entry('shallow.lock', false), entry('pack', false));
      },
      lstat: async (path: string) => {
        if (path.endsWith('shallow.lock')) throw failure('ENOENT');
        return { size: 5 };
      },
    };
    expect(await exceedsStagingLimits('/stage', limits, fs)).toBeNull();
    expect(await exceedsStagingLimits('/stage', { ...limits, maxStagingBytes: 4 }, fs))
      .toEqual({ dimension: 'maxStagingBytes', limit: 4 });
    expect(await exceedsStagingLimits('/stage', { ...limits, maxStagingBytes: 6 }, fs)).toBeNull();
    expect(await exceedsStagingLimits('/stage', { ...limits, maxStagingEntries: 2 }, fs))
      .toEqual({ dimension: 'maxStagingEntries', limit: 2 });
    expect(await exceedsStagingLimits('/stage', { ...limits, maxStagingEntries: 3 }, fs)).toBeNull();
    expect(await exceedsStagingLimits('/stage', { ...limits, maxStagingEntries: 4 }, fs)).toBeNull();
  });

  it('surfaces a missing root and other filesystem failures', async () => {
    const missingRoot = { opendir: async () => { throw failure('ENOENT'); }, lstat: async () => ({ size: 0 }) };
    await expect(exceedsStagingLimits('/stage', limits, missingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const unreadable = { opendir: async () => entries(entry('pack', false)), lstat: async () => { throw failure('EACCES'); } };
    await expect(exceedsStagingLimits('/stage', limits, unreadable)).rejects.toMatchObject({ code: 'EACCES' });
  });
});
