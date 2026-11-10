import type { CatalogService } from '../catalog/merge.js';
import type { ConfigStore } from '../config/store.js';
import { createHarnessRegistry, type HarnessRegistry } from '../harness/registry.js';
import type { HarnessAuthStrategy, LocalCommandRunner } from './auth.js';
import { createPreflightEngine, type PreflightEngine } from './engine.js';

export interface PreflightProviderOptions {
  configStore: ConfigStore;
  catalogService: CatalogService;
  harnessRegistry?: HarnessRegistry;
  preflightEngine?: PreflightEngine;
  preflightCommandRunner?: LocalCommandRunner;
  preflightReadFileText?: (path: string) => Promise<string>;
  preflightHomeDirectory?: string;
  preflightEnv?: NodeJS.ProcessEnv;
  preflightAuthStrategies?: readonly HarnessAuthStrategy[];
}

export interface PreflightProvider {
  harnessRegistry(): Promise<HarnessRegistry>;
  preflightEngine(): Promise<PreflightEngine>;
}

export function createPreflightProvider(options: PreflightProviderOptions): PreflightProvider {
  const harnessRegistry = async (): Promise<HarnessRegistry> => {
    if (options.harnessRegistry !== undefined) return options.harnessRegistry;
    const config = await options.configStore.get();
    return createHarnessRegistry({
      commands: config.harnessCommands,
      ...(options.preflightEnv === undefined ? {} : { env: options.preflightEnv }),
    });
  };
  return {
    harnessRegistry,
    async preflightEngine() {
      if (options.preflightEngine !== undefined) return options.preflightEngine;
      return createPreflightEngine({
        catalogService: options.catalogService,
        harnessRegistry: await harnessRegistry(),
        ...(options.preflightCommandRunner === undefined ? {} : { commandRunner: options.preflightCommandRunner }),
        ...(options.preflightReadFileText === undefined ? {} : { readFileText: options.preflightReadFileText }),
        ...(options.preflightHomeDirectory === undefined ? {} : { homeDirectory: options.preflightHomeDirectory }),
        ...(options.preflightAuthStrategies === undefined ? {} : { authStrategies: options.preflightAuthStrategies }),
        env: options.preflightEnv ?? process.env,
      });
    },
  };
}
