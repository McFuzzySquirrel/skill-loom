import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface WorkspaceInfo {
  projectId: string;
  projectName?: string;
  chainId?: string;
  chainName?: string;
  runId?: string;
}

interface WorkspaceContextValue {
  info: WorkspaceInfo | null;
  setInfo: (info: WorkspaceInfo | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const value = useMemo(() => ({ info, setInfo }), [info]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const workspace = useContext(WorkspaceContext);
  if (workspace === null) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider.');
  }
  return workspace;
}
