import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function resolveGlobalSkillsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory?: string,
): string {
  const configured = env.LOOM_SKILLS_DIR?.trim();
  const directory = configured === undefined || configured === ''
    ? join(homeDirectory ?? homedir(), '.agents', 'skills')
    : configured;
  if (directory.includes('\0')) {
    throw new TypeError('The global skills directory cannot contain a NUL byte.');
  }
  return resolve(directory);
}
