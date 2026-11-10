import { afterEach, describe, expect, it, vi } from 'vitest';

const pty = vi.hoisted(() => ({
  kill: vi.fn(),
  onData: vi.fn(() => ({ dispose() {} })),
  onExit: vi.fn(() => ({ dispose() {} })),
}));

vi.mock('node-pty', () => ({
  spawn: () => ({ pid: 123, ...pty }),
}));

import { createTerminalManager, createTerminalSession } from '../../src/server/terminal/pty.js';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  pty.kill.mockReset();
});

describe('PTY platform cleanup', () => {
  it('uses the Windows termination API without forwarding POSIX signals', () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    const session = createTerminalSession({ executable: process.execPath, args: [] });

    session.kill('SIGTERM');
    session.kill('SIGKILL');

    expect(pty.kill.mock.calls).toEqual([[undefined], [undefined]]);
  });

  it('preserves POSIX signals and surfaces unexpected kill failures', () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    const session = createTerminalSession({ executable: process.execPath, args: [] });
    session.kill('SIGTERM');
    expect(pty.kill).toHaveBeenCalledWith('SIGTERM');

    pty.kill.mockImplementationOnce(() => { throw Object.assign(new Error('missing'), { code: 'ESRCH' }); });
    expect(() => session.kill('SIGKILL')).not.toThrow();
    pty.kill.mockImplementationOnce(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    expect(() => session.kill('SIGKILL')).toThrow('denied');
  });

  it('continues stopping other terminals when one termination fails', async () => {
    const manager = createTerminalManager();
    manager.createSession({ executable: process.execPath, args: [] });
    manager.createSession({ executable: process.execPath, args: [] });
    pty.kill.mockImplementationOnce(() => { throw new Error('denied'); });

    await expect(manager.shutdown(0)).rejects.toThrow('Terminal shutdown failed.');
    expect(pty.kill).toHaveBeenCalledTimes(4);
  });
});
