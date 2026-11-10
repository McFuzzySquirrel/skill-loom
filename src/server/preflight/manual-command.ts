import type { HarnessTrustCommand } from '../harness/types.js';

/** Render for display only; the application always spawns an argument array. */
export function renderManualCommand(
  command: HarnessTrustCommand,
  platform: NodeJS.Platform = process.platform,
): string {
  const values = [command.executable, ...command.args];
  if (platform === 'win32') {
    return `& ${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(' ')}`;
  }
  return values.map((value) =>
    /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
      ? value
      : `'${value.replaceAll("'", `'\\''`)}'`,
  ).join(' ');
}
