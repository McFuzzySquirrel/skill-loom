export interface QuadletOptions {
  skillsDirectory?: string;
  projectDirectory?: string;
  caddyFile?: string;
  imageTag?: string;
  hostPort?: number;
  homeDirectory?: string;
}

export class PodmanHostError extends Error {
  code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}

export interface PodmanHostPlan {
  image: string;
  imageTag: string;
  skillsDirectory: string;
  projectDirectory: string;
  hostPort: number | null;
  unitDirectory: string;
  stateDirectory: string;
  files: Record<string, string>;
  buildArgs: string[];
  startUnits: string[];
  allUnits: string[];
}

export interface PodmanHostDependencies {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  uid?: number;
  homeDirectory?: string;
  repositoryRoot?: string;
  stdout?: { write(text: string): boolean };
  stderr?: { write(text: string): boolean };
  spawnSync?: (
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      encoding: 'utf8';
      stdio: 'pipe' | 'inherit';
      windowsHide: boolean;
    },
  ) => {
    status: number | null;
    stdout?: string | null;
    stderr?: string | null;
    error?: Error;
  };
}

export function createQuadletFiles(options?: QuadletOptions): Record<string, string>;
export function createPodmanHostPlan(options?: {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  repositoryRoot?: string;
  imageTag?: string;
}): PodmanHostPlan;
export function runPodmanHost(
  args?: string[],
  dependencies?: PodmanHostDependencies,
): Promise<number>;
