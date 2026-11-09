import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderManualCommand } from '../../src/server/preflight/manual-command.js';

describe('manual trust command rendering', () => {
  it('quotes POSIX shell arguments without interpreting metacharacters', () => {
    expect(renderManualCommand({
      harness: 'copilot',
      executable: '/opt/a tool/copilot',
      args: ['-C', "/tmp/user's $project"],
      cwd: '/tmp',
    }, 'linux')).toBe("'/opt/a tool/copilot' -C '/tmp/user'\\''s $project'");
  });

  it('quotes PowerShell arguments and uses the call operator', () => {
    expect(renderManualCommand({
      harness: 'copilot',
      executable: "C:\\Program Files\\user's\\copilot.exe",
      args: ['-C', 'C:\\work\\$project;name'],
      cwd: 'C:\\work',
    }, 'win32')).toBe("& 'C:\\Program Files\\user''s\\copilot.exe' '-C' 'C:\\work\\$project;name'");
  });

  it.runIf(process.platform === 'win32')('round-trips real PowerShell arguments without evaluation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom power shell-'));
    try {
      const script = join(root, "a'script.js");
      await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
      const expected = ["C:\\work\\user's $project;name", '-C'];
      const command = renderManualCommand({
        harness: 'copilot',
        executable: process.execPath,
        args: [script, ...expected],
        cwd: root,
      }, 'win32');
      const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000);
});
