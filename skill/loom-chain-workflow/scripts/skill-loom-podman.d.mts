export function createPodmanCliArgs(
  args: readonly string[],
  allocateTty: boolean,
  connection?: string,
): string[];

export type SelectedSkillIdentity = { id: string; fingerprint: string };

export function validateSkillTransfer(
  manifest: unknown,
  expectedSelections?: readonly SelectedSkillIdentity[],
): Array<{
  id?: string;
  fingerprint?: string;
  name: string;
  directory: string;
  files: Array<{ path: string; content: Buffer; executable: boolean }>;
}>;

export function installTransferredSkills(
  projectPath: string,
  manifest: unknown,
  expectedSelections?: readonly SelectedSkillIdentity[],
): Promise<{ installed: Array<{ name: string; destinationPath: string }> }>;

export function runPodmanCli(
  args?: readonly string[],
  dependencies?: Record<string, unknown>,
): Promise<number>;
