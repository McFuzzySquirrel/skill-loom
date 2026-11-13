import { join, resolve } from 'node:path';
import {
  capabilityIndexEnabled,
  catalogCapabilityFallback,
  collectCapabilityPackages,
  createCapabilitySearchService,
  defaultCapabilitySourceRoots,
  type CapabilitySearchService,
} from './catalog/capability-index.js';
import { createCatalogService, type CatalogService } from './catalog/merge.js';
import { resolveGlobalSkillsDirectory } from './catalog/global-skills.js';
import { createGlobalDraftService } from './chains/drafts.js';
import { createChainService, type ChainService } from './chains/service.js';
import {
  CHAIN_STORE_ERROR_CODES,
  CHAIN_STORE_WARNING_CODES,
  ChainStoreError,
  createChainStore,
  globalChainsDirectoryFor,
  type ChainStoreWarning,
} from './chains/store.js';
import type { ConfigStore } from './config/store.js';
import { createPreflightProvider, type PreflightProvider, type PreflightProviderOptions } from './preflight/provider.js';
import { createProjectRegistry, type GitInitRunner, type ProjectRegistry } from './projects/registry.js';
import { createTestWorkspaceService, type TestWorkspaceService } from './runs/test-workspaces.js';

export interface LoomServices {
  configStore: ConfigStore;
  projectRegistry: ProjectRegistry;
  catalogService: CatalogService;
  capabilitySearchService: CapabilitySearchService;
  chainService: ChainService;
  getDraftService(): ChainService;
  preflightProvider: PreflightProvider;
  testWorkspaceService: TestWorkspaceService;
}

export function createLoomServices(options: Omit<PreflightProviderOptions, 'catalogService'> & {
  configStore: ConfigStore;
  catalogService?: CatalogService;
  chainService?: ChainService;
  gitInit?: GitInitRunner;
}): LoomServices {
  const globalSkillsDirectory = () => resolveGlobalSkillsDirectory(
    options.preflightEnv,
    options.preflightHomeDirectory,
  );
  const catalogService = options.catalogService ?? createCatalogService({
    configStore: options.configStore,
    globalSkillsDirectory,
  });
  const capabilitySearchService = createCapabilitySearchService({
    enabled: capabilityIndexEnabled(options.preflightEnv),
    index: { get directory() { return options.configStore.getConfigDir(); } },
    sources: async ({ projectPath, harness }) => {
      const local = await collectCapabilityPackages(defaultCapabilitySourceRoots({
        projectPath,
        harness,
        globalSkillsDirectory: globalSkillsDirectory(),
      }));
      return local;
    },
    fallback: catalogCapabilityFallback(catalogService),
  });
  const projectRegistry = createProjectRegistry({
    configStore: options.configStore,
    ...(options.gitInit === undefined ? {} : { gitInit: options.gitInit }),
  });
  const getConfigDirectory = () => options.configStore.getConfigDir();
  const createGlobalChainStore = () => {
    const configDirectory = getConfigDirectory();
    return createChainStore({
      chainsDirectory: globalChainsDirectoryFor(configDirectory),
      configDirectory,
    });
  };
  const chainService = options.chainService ?? createMigratingChainService(
    createChainService({ createStore: createGlobalChainStore }),
    createGlobalChainStore,
    getConfigDirectory,
  );
  let draftService: ChainService | undefined;
  const getDraftService = () => draftService ??= createGlobalDraftService(options.configStore.getConfigDir());
  return {
    configStore: options.configStore,
    projectRegistry,
    catalogService,
    capabilitySearchService,
    chainService,
    getDraftService,
    preflightProvider: createPreflightProvider({ ...options, catalogService }),
    testWorkspaceService: createTestWorkspaceService({
      configStore: options.configStore, projectRegistry, catalogService, chainService, getDraftService,
    }),
  };
}

function createMigratingChainService(
  shared: ChainService,
  createSharedStore: () => ReturnType<typeof createChainStore>,
  getConfigDirectory: () => string,
): ChainService {
  const migrations = new Map<string, Promise<ChainStoreWarning[]>>();

  async function migrate(projectPath: string): Promise<ChainStoreWarning[]> {
    const key = resolve(projectPath);
    const existing = migrations.get(key);
    if (existing !== undefined) return existing;

    const migration = migrateProjectChains(projectPath, createSharedStore, getConfigDirectory());
    migrations.set(key, migration);
    try {
      const warnings = await migration;
      if (warnings.length > 0) migrations.delete(key);
      return warnings;
    } catch (error) {
      migrations.delete(key);
      throw error;
    }
  }

  return {
    async list(projectPath) {
      const warnings = await migrate(projectPath);
      const result = await shared.list(projectPath);
      return { ...result, warnings: [...warnings, ...result.warnings] };
    },
    async get(projectPath, chainId) {
      await migrate(projectPath);
      return shared.get(projectPath, chainId);
    },
    async create(projectPath, draft, options) {
      await migrate(projectPath);
      return shared.create(projectPath, draft, options);
    },
    async update(projectPath, chainId, draft, options) {
      await migrate(projectPath);
      return shared.update(projectPath, chainId, draft, options);
    },
    async duplicate(projectPath, chainId, options) {
      await migrate(projectPath);
      return shared.duplicate(projectPath, chainId, options);
    },
    async importChain(projectPath, source, options) {
      await migrate(projectPath);
      return shared.importChain(projectPath, source, options);
    },
    async remove(projectPath, chainId, options) {
      await migrate(projectPath);
      return shared.remove(projectPath, chainId, options);
    },
  };
}

async function migrateProjectChains(
  projectPath: string,
  createSharedStore: () => ReturnType<typeof createChainStore>,
  configDirectory: string,
): Promise<ChainStoreWarning[]> {
  const source = await createChainStore({ projectPath, configDirectory }).list();
  const destination = createSharedStore();
  const existing = await destination.list();
  const byId = new Map(existing.chains.map((chain) => [chain.id, chain]));
  const warnings = [...source.warnings];

  for (const chain of source.chains) {
    const current = byId.get(chain.id);
    if (current !== undefined) {
      if (JSON.stringify(current) !== JSON.stringify(chain)) {
        warnings.push({
          code: CHAIN_STORE_WARNING_CODES.FILE_IGNORED,
          message: 'A project chain shares an id with a different library chain and was left in place.',
          path: join(projectPath, '.loom', 'chains', `${chain.id}.json`),
          chainId: chain.id,
        });
      }
      continue;
    }

    try {
      await destination.create(chain);
      byId.set(chain.id, chain);
    } catch (error) {
      if (error instanceof ChainStoreError &&
          error.code === CHAIN_STORE_ERROR_CODES.ALREADY_EXISTS) {
        warnings.push({
          code: CHAIN_STORE_WARNING_CODES.FILE_IGNORED,
          message: 'A project chain could not be migrated because its id was claimed by another library chain.',
          path: join(projectPath, '.loom', 'chains', `${chain.id}.json`),
          chainId: chain.id,
        });
        continue;
      }
      throw error;
    }
  }
  return warnings;
}
