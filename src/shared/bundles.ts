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

export interface BundleNativeAgent {
  name: string;
  harness: Chain['harness'];
  agentPath: string;
  fingerprint: string;
  content: string;
}

export interface ChainBundleV1 {
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

export interface ChainBundleV2 {
  format: 'skill-loom-chain';
  version: 2;
  chain: {
    name: string;
    harness: Chain['harness'];
    sessionMode: Chain['sessionMode'];
    steps: ChainStep[];
    inputs: ChainInput[];
    agent?: Chain['agent'];
  };
  skills: BundleSkill[];
  agents: BundleNativeAgent[];
}

export type ChainBundle = ChainBundleV1 | ChainBundleV2;

export interface BundlePreview {
  bundle: ChainBundle;
  skills: Array<{
    name: string;
    conflict: boolean;
    directoryExists: boolean;
    files: number;
    bytes: number;
  }>;
  agents: Array<{
    name: string;
    harness: Chain['harness'];
    agentPath: string;
    conflict: boolean;
    bytes: number;
  }>;
}

export interface BundleReuseEvidence {
  name: string;
  path: string;
  fingerprint: string;
  bundledFingerprint: string;
  differs: boolean;
  inventory: Array<
    | { path: string; kind: 'directory' }
    | { path: string; kind: 'file'; bytes: number; executable: boolean; fingerprint: string }
  >;
}

export interface ReviewedBundlePreview extends BundlePreview {
  projectDevice: string;
  projectInode: string;
  reuseEvidence: BundleReuseEvidence[];
  reviewDigest: string;
}
