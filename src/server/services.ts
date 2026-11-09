import { createCatalogService, type CatalogService } from './catalog/merge.js';
import { createGlobalDraftService } from './chains/drafts.js';
import { createChainService, type ChainService } from './chains/service.js';
import type { ConfigStore } from './config/store.js';
import { createPreflightProvider, type PreflightProvider, type PreflightProviderOptions } from './preflight/provider.js';
import { createProjectRegistry, type GitInitRunner, type ProjectRegistry } from './projects/registry.js';
import { createTestWorkspaceService, type TestWorkspaceService } from './runs/test-workspaces.js';

export interface LoomServices {
  configStore: ConfigStore;
  projectRegistry: ProjectRegistry;
  catalogService: CatalogService;
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
  const catalogService = options.catalogService ?? createCatalogService({ configStore: options.configStore });
  const projectRegistry = createProjectRegistry({
    configStore: options.configStore,
    ...(options.gitInit === undefined ? {} : { gitInit: options.gitInit }),
  });
  const chainService = options.chainService ?? createChainService();
  let draftService: ChainService | undefined;
  const getDraftService = () => draftService ??= createGlobalDraftService(options.configStore.getConfigDir());
  return {
    configStore: options.configStore,
    projectRegistry,
    catalogService,
    chainService,
    getDraftService,
    preflightProvider: createPreflightProvider({ ...options, catalogService }),
    testWorkspaceService: createTestWorkspaceService({
      configStore: options.configStore, projectRegistry, catalogService, chainService, getDraftService,
    }),
  };
}
