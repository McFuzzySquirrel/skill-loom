import type { Chain, ChainInput, ChainStep } from '../server/chains/model.js';

export interface BundleFile {
  path: string;
  content: string;
  executable: boolean;
}

export interface BundleSkill {
  name: string;
  directory: string;
  files: BundleFile[];
}

export interface ChainBundle {
  format: 'skill-loom-chain';
  version: 1;
  chain: {
    name: string;
    harness: Chain['harness'];
    sessionMode: Chain['sessionMode'];
    steps: ChainStep[];
    inputs: ChainInput[];
  };
  skills: BundleSkill[];
}

export interface BundlePreview {
  bundle: ChainBundle;
  skills: Array<{
    name: string;
    conflict: boolean;
    directoryExists: boolean;
    files: number;
    bytes: number;
  }>;
}
