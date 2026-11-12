import {
  capabilityIndexEnabled,
  catalogCapabilityFallback,
  collectCapabilityPackages,
  collectRemoteCapabilityPackages,
  createCapabilitySearchService,
  defaultCapabilitySourceRoots,
  type CapabilitySearchService,
} from './catalog/capability-index.js';
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
  const catalogService = options.catalogService ?? createCatalogService({ configStore: options.configStore });
  const capabilitySearchService = createCapabilitySearchService({
    enabled: capabilityIndexEnabled(options.preflightEnv),
    index: { get directory() { return options.configStore.getConfigDir(); } },
    sources: async ({ projectPath, harness }) => {
      // Copilot discovery is CLI-authoritative; the indexed path is enabled for
      // OpenCode local, bundled, and verified remote packages only.
      if (harness !== 'opencode') return { roots: [], packages: [], warnings: [] };
      const config = await options.configStore.get();
      const local = await collectCapabilityPackages(defaultCapabilitySourceRoots({
        projectPath,
        harness,
        extraDirectories: config.extraSkillDirectories,
        ...(options.preflightHomeDirectory === undefined
          ? {}
          : { homeDirectory: options.preflightHomeDirectory }),
      }));
      const remote = await collectRemoteCapabilityPackages({
        configDirectory: options.configStore.getConfigDir(),
        sources: config.remoteSkillSources,
        harness,
      });
      return {
        roots: local.roots,
        packages: [...local.packages, ...remote.packages],
        warnings: [...local.warnings, ...remote.warnings],
      };
    },
    fallback: catalogCapabilityFallback(catalogService),
  });
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
    capabilitySearchService,
    chainService,
    getDraftService,
    preflightProvider: createPreflightProvider({ ...options, catalogService }),
    testWorkspaceService: createTestWorkspaceService({
      configStore: options.configStore, projectRegistry, catalogService, chainService, getDraftService,
    }),
  };
}
