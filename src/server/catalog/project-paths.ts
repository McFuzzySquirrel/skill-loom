import { join } from 'node:path';

export const SHARED_SKILLS_SEGMENTS = ['.agents', 'skills'] as const;
export const SHARED_PROJECT_SKILLS_SEGMENTS = SHARED_SKILLS_SEGMENTS;

export function sharedProjectSkillRoot(projectPath: string): string {
  return join(projectPath, ...SHARED_SKILLS_SEGMENTS);
}
