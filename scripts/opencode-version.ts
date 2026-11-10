export const MINIMUM_OPENCODE_VERSION = '2.2.5';

export function supportsOpenCodeVersion(version: string | null): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/.exec(version ?? '');
  if (!match) return false;
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  const minimum = MINIMUM_OPENCODE_VERSION.split('.').map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (parts[index]! > minimum[index]!) return true;
    if (parts[index]! < minimum[index]!) return false;
  }
  return true;
}
