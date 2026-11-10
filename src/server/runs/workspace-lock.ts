const locks = new Map<string, Promise<void>>();

export async function withWorkspaceLifecycleLock<T>(
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(projectId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(projectId) === current) locks.delete(projectId);
  }
}
