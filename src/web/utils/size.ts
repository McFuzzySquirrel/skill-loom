export const BYTES_PER_MB = 1_000_000;

export function formatMegabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toLocaleString(undefined, { maximumFractionDigits: 6 })} MB`;
}
