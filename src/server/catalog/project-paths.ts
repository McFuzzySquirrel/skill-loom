import { join } from 'node:path';

export const SHARED_PROJECT_SKILLS_SEGMENTS = ['.agents', 'skills'] as const;

export function sharedProjectSkillRoot(projectPath: string): string {
  return join(projectPath, ...SHARED_PROJECT_SKILLS_SEGMENTS);
}
