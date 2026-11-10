/** Resource budgets for refreshing a single remote Git catalog. */
export interface RemoteCatalogLimits {
  maxPackages: number;
  maxAgents: number;
  maxFiles: number;
  maxPackageBytes: number;
  maxSnapshotBytes: number;
  maxStagingBytes: number;
  maxStagingEntries: number;
  maxCommandOutputBytes: number;
  cloneTimeoutMs: number;
  commandTimeoutMs: number;
}

export type RemoteCatalogLimitOverrides = Partial<RemoteCatalogLimits>;

export const REMOTE_CATALOG_LIMIT_KEYS = [
  'maxPackages',
  'maxAgents',
  'maxFiles',
  'maxPackageBytes',
  'maxSnapshotBytes',
  'maxStagingBytes',
  'maxStagingEntries',
  'maxCommandOutputBytes',
  'cloneTimeoutMs',
  'commandTimeoutMs',
] as const satisfies readonly (keyof RemoteCatalogLimits)[];
