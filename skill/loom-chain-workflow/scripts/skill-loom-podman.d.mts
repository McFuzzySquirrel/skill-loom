export function createPodmanCliArgs(
  args: readonly string[],
  allocateTty: boolean,
  connection?: string,
): string[];

export function validateSkillTransfer(manifest: unknown): Array<{
  name: string;
  directory: string;
  files: Array<{ path: string; content: Buffer; executable: boolean }>;
}>;

export function installTransferredSkills(
  projectPath: string,
  manifest: unknown,
): Promise<{ installed: Array<{ name: string; destinationPath: string }> }>;

export function runPodmanCli(
  args?: readonly string[],
  dependencies?: Record<string, unknown>,
): Promise<number>;
