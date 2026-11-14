export interface PodmanPlanOptions {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  homeDirectory?: string;
  cwd?: string;
  privateNetwork?: boolean;
}

export interface PodmanPlan {
  commands: string[][];
  configVolume: string;
  skillsDirectory: string;
  projectDirectory: string;
  port: number;
  privateNetwork: boolean;
  platform: string | undefined;
}

export function createPodmanPlan(options?: PodmanPlanOptions): PodmanPlan;
