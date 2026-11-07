import { join } from 'node:path';
import { createChainService, type ChainService } from './service.js';
import { createChainStore } from './store.js';

export const GLOBAL_DRAFTS_DIRECTORY_NAME = 'drafts';

export function globalDraftsDirectoryFor(configDirectory: string): string {
  return join(configDirectory, GLOBAL_DRAFTS_DIRECTORY_NAME);
}

/**
 * Project-independent editable chains. Drafts are stored separately from
 * reusable global templates and from project-local chains.
 */
export function createGlobalDraftService(configDirectory: string): ChainService {
  const chainsDirectory = globalDraftsDirectoryFor(configDirectory);
  return createChainService({
    createStore: () => createChainStore({ chainsDirectory }),
  });
}
