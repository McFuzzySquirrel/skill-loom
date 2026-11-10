import { ChildProcess, execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWindowsControlCertificates, resolveWindowsPowerShell } from '../../src/server/windows-control.js';

vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(),
  lstat: vi.fn(),
}));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  execFile: vi.fn(),
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const env = { ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows', PATH: 'C:\\untrusted' };
const modern = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const legacy = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

afterEach(() => {
  vi.mocked(lstat).mockReset();
  vi.mocked(execFile).mockReset();
  vi.unstubAllEnvs();
  Object.defineProperty(process, 'platform', platform);
});

describe('Windows PowerShell host selection', () => {
  it('prefers the fixed PowerShell 7 installation, not PATH', async () => {
    vi.mocked(lstat).mockResolvedValue(await regularFile());
    expect(await resolveWindowsPowerShell(env)).toBe(modern);
    expect(lstat).toHaveBeenCalledExactlyOnceWith(modern);
  });

  it('falls back only when PowerShell 7 is absent', async () => {
    vi.mocked(lstat).mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));
    expect(await resolveWindowsPowerShell(env)).toBe(legacy);
    expect(await resolveWindowsPowerShell({ SystemRoot: env.SystemRoot })).toBe(legacy);
    await expect(resolveWindowsPowerShell({ ...env, LOOM_WINDOWS_POWERSHELL: '7' }))
      .rejects.toMatchObject({ code: 'WINDOWS_POWERSHELL_UNAVAILABLE' });
  });

  it('allows explicit legacy selection without probing PowerShell 7', async () => {
    expect(await resolveWindowsPowerShell({ ...env, LOOM_WINDOWS_POWERSHELL: '5.1' })).toBe(legacy);
    expect(lstat).not.toHaveBeenCalled();
  });

  it('does not downgrade after access errors or an unsafe executable', async () => {
    const denied = Object.assign(new Error(), { code: 'EACCES' });
    vi.mocked(lstat).mockRejectedValue(denied);
    await expect(resolveWindowsPowerShell(env)).rejects.toMatchObject({ code: 'WINDOWS_POWERSHELL_INVALID' });
    vi.mocked(lstat).mockResolvedValue(await regularFile(true));
    await expect(resolveWindowsPowerShell(env)).rejects.toMatchObject({ code: 'WINDOWS_POWERSHELL_INVALID' });
  });

  it('rejects invalid selectors and relative or network installation roots', async () => {
    for (const overrides of [
      { LOOM_WINDOWS_POWERSHELL: 'pwsh' },
      { ProgramFiles: 'relative' },
      { ProgramFiles: '\\\\server\\share' },
      { LOOM_WINDOWS_POWERSHELL: '5.1', SystemRoot: 'relative' },
    ]) await expect(resolveWindowsPowerShell({ ...env, ...overrides })).rejects.toThrow();
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each(['', '{"ok":false,"code":"WINDOWS_PROFILE_UNSAFE"}'])(
    'does not try another host after a helper failure (%s)', async (output) => {
      Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
      vi.stubEnv('ProgramFiles', env.ProgramFiles);
      vi.stubEnv('SystemRoot', env.SystemRoot);
      vi.stubEnv('LOOM_WINDOWS_POWERSHELL', 'auto');
      vi.mocked(lstat).mockResolvedValue(await regularFile());
      vi.mocked(execFile).mockImplementation((...args) => {
        const callback = args[3];
        if (typeof callback !== 'function') throw new Error('Expected an execFile callback.');
        callback(new Error('Fixture helper failure.'), output, '');
        return new ChildProcess();
      });
      await expect(createWindowsControlCertificates()).rejects.toMatchObject({
        code: output === '' ? 'WINDOWS_PROFILE_CHECK_FAILED' : 'WINDOWS_PROFILE_UNSAFE',
      });
      expect(execFile).toHaveBeenCalledOnce();
      expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe(modern);
    },
  );
});

async function regularFile(link = false) {
  const { stat } = await import('node:fs/promises');
  const info = await stat(import.meta.filename);
  vi.spyOn(info, 'isSymbolicLink').mockReturnValue(link);
  return info;
}
