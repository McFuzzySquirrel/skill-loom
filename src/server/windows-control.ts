import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const certificateSchema = z.strictObject({
  certificate: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(8192),
  pfx: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(16384),
});
const resultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(true), content: z.string().max(32768).nullable() }),
  z.strictObject({ ok: z.literal(true), server: certificateSchema, client: certificateSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['WINDOWS_PROFILE_UNSAFE', 'WINDOWS_PROFILE_INVALID', 'WINDOWS_PROFILE_CHECK_FAILED']),
  }),
]);

export class WindowsControlSecurityError extends Error {
  readonly details: Record<string, unknown> = {};
  constructor(readonly code: string) {
    super('Windows control security verification failed. Use a protected current-user-private profile on a local NTFS/ReFS drive without reparse points. Install stable PowerShell 7 in Program Files\\PowerShell\\7, or use Windows PowerShell 5.1 with .NET 4.7.2+. LOOM_WINDOWS_POWERSHELL accepts auto, 7, or 5.1; helper failures never trigger fallback and existing ACLs are never repaired automatically.');
    this.name = 'WindowsControlSecurityError';
  }
}

export async function resolveWindowsPowerShell(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const host = env.LOOM_WINDOWS_POWERSHELL ?? 'auto';
  if (!['auto', '7', '5.1'].includes(host)) {
    throw new WindowsControlSecurityError('WINDOWS_POWERSHELL_INVALID');
  }
  if (host !== '5.1' && env.ProgramFiles !== undefined) {
    if (!/^[A-Za-z]:[\\/]/.test(env.ProgramFiles) || !win32.isAbsolute(env.ProgramFiles)) {
      throw new WindowsControlSecurityError('WINDOWS_POWERSHELL_INVALID');
    }
    const executable = win32.join(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe');
    try {
      const info = await lstat(executable);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new WindowsControlSecurityError('WINDOWS_POWERSHELL_INVALID');
      }
      return executable;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw new WindowsControlSecurityError('WINDOWS_POWERSHELL_INVALID');
      }
    }
  }
  if (host === '7') throw new WindowsControlSecurityError('WINDOWS_POWERSHELL_UNAVAILABLE');
  const systemRoot = env.SystemRoot ?? 'C:\\Windows';
  if (!/^[A-Za-z]:[\\/]/.test(systemRoot) || !win32.isAbsolute(systemRoot)) {
    throw new WindowsControlSecurityError('WINDOWS_PROFILE_INVALID');
  }
  return win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function invoke(operation: 'prepare' | 'check' | 'metadata' | 'lock' | 'certificates', path?: string) {
  if (process.platform !== 'win32') throw new WindowsControlSecurityError('WINDOWS_PROFILE_UNSUPPORTED');
  const executable = await resolveWindowsPowerShell();
  const script = fileURLToPath(new URL('./windows-control.ps1', import.meta.url));
  let canonicalPath: string | undefined;
  if (path !== undefined && operation !== 'prepare') {
    try { canonicalPath = await realpath(resolve(path)); } catch {
      throw new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED');
    }
  }
  const { output, failed } = await new Promise<{ output: string; failed: boolean }>((done, reject) => {
    const child = execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
      windowsHide: true, timeout: 45_000, maxBuffer: 128 * 1024, encoding: 'utf8',
    }, (error, stdout) => {
      // Only a validated helper envelope may leave the subprocess boundary.
      if (error !== null && stdout === '') reject(new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED'));
      else done({ output: stdout, failed: error !== null });
    });
    child.stdin?.on('error', () => {
      reject(new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED'));
    });
    child.stdin?.end(JSON.stringify({
      version: 1, operation,
      ...(path === undefined ? {} : { path: resolve(path) }),
      ...(canonicalPath === undefined ? {} : { canonicalPath }),
    }));
  });
  let raw: unknown;
  try { raw = JSON.parse(output.trim()) as unknown; } catch {
    throw new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED');
  }
  const result = resultSchema.safeParse(raw);
  if (!result.success) throw new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED');
  if (!result.data.ok) throw new WindowsControlSecurityError(result.data.code);
  if (failed) throw new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED');
  return result.data;
}

export async function verifyWindowsProfile(path: string, operation: 'prepare' | 'check' | 'lock' = 'check'): Promise<void> {
  const result = await invoke(operation, path);
  if ('content' in result || 'server' in result) throw new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED');
  if (operation === 'prepare') {
    // A drive alias can hide physical ancestors from DirectoryInfo.Parent.
    // Recheck the now-existing canonical location before any state is written.
    await invoke('check', path);
  }
}

export async function readWindowsControlMetadata(path: string): Promise<string | null> {
  const result = await invoke('metadata', path);
  if (!('content' in result)) throw new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED');
  return result.content;
}

export async function createWindowsControlCertificates() {
  const result = await invoke('certificates');
  if (!('server' in result)) throw new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED');
  for (const certificate of [result.server, result.client]) {
    const parsed = new X509Certificate(Buffer.from(certificate.certificate, 'base64'));
    if (!parsed.checkIssued(parsed) || !parsed.verify(parsed.publicKey)) {
      throw new WindowsControlSecurityError('WINDOWS_PROFILE_CHECK_FAILED');
    }
  }
  return { server: result.server, client: result.client };
}
