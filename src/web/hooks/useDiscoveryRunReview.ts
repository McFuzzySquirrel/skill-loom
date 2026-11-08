import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '../api/client';
import {
  discoveryWorkspaceApi,
  type DiscoveryWorkspace,
} from '../api/discovery';
import type { Run, RunActionResultView } from '../api/runs';
import { toApiClientError } from '../api/projects';

type WorkspaceLookup =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; workspace: DiscoveryWorkspace | null }
  | { key: string; status: 'error'; error: ApiClientError };

export function useDiscoveryRunReview(run: Run | null) {
  const key = run === null ? '' : `${run.id}:${run.projectId}:${run.chainId}`;
  const [lookup, setLookup] = useState<WorkspaceLookup>({ key: '', status: 'loading' });
  const [result, setResult] = useState<{ bundle: unknown; fingerprint: string } | null>(null);
  const [resultError, setResultError] = useState<ApiClientError | null>(null);
  const [contentsReviewed, setContentsReviewed] = useState(false);
  const [redistributionReviewed, setRedistributionReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const lookupAttempt = useRef(0);

  const loadWorkspace = useCallback(async () => {
    if (run === null) return;
    const requestKey = `${run.id}:${run.projectId}:${run.chainId}`;
    const attempt = ++lookupAttempt.current;
    setLookup({ key: requestKey, status: 'loading' });
    try {
      const workspaces = await discoveryWorkspaceApi.list();
      if (lookupAttempt.current !== attempt) return;
      setLookup({
        key: requestKey,
        status: 'ready',
        workspace: workspaces.find((candidate) =>
          candidate.projectId === run.projectId && candidate.chainId === run.chainId,
        ) ?? null,
      });
    } catch (error) {
      if (lookupAttempt.current !== attempt) return;
      setLookup({
        key: requestKey,
        status: 'error',
        error: toApiClientError(error, 'The discovery workspace association could not be checked.'),
      });
    }
  }, [run?.chainId, run?.id, run?.projectId]);

  useEffect(() => {
    setResult(null);
    setResultError(null);
    setContentsReviewed(false);
    setRedistributionReviewed(false);
    void loadWorkspace();
    return () => {
      lookupAttempt.current += 1;
    };
  }, [key, loadWorkspace]);

  const lookupLoading = run !== null && (lookup.key !== key || lookup.status === 'loading');
  const lookupError = lookup.key === key && lookup.status === 'error' ? lookup.error : null;
  const workspace = lookup.key === key && lookup.status === 'ready' ? lookup.workspace : null;
  const canMarkDone =
    !lookupLoading &&
    lookupError === null &&
    (workspace === null ||
      (result !== null && contentsReviewed && redistributionReviewed && !busy));
  const shouldShowPanel = lookupLoading || lookupError !== null || workspace !== null;

  const loadResult = useCallback(async () => {
    if (workspace === null) return;
    setBusy(true);
    setResultError(null);
    try {
      setResult(await discoveryWorkspaceApi.previewResult(workspace.id));
      setContentsReviewed(false);
      setRedistributionReviewed(false);
    } catch (error) {
      setResultError(toApiClientError(error, 'The discovery result could not be loaded for review.'));
      setResult(null);
      setContentsReviewed(false);
      setRedistributionReviewed(false);
    } finally {
      setBusy(false);
    }
  }, [workspace]);

  const reviewBeforeDone = useCallback(async (): Promise<boolean> => {
    if (lookupLoading || lookupError !== null) return false;
    if (workspace === null) return true;
    if (result === null || !contentsReviewed || !redistributionReviewed) {
      setResultError(new ApiClientError(
        'Load and review the complete result and redistribution rights before marking discovery Done.',
        { code: 'DISCOVERY_RESULT_REVIEW_REQUIRED', status: 0 },
      ));
      return false;
    }
    setBusy(true);
    setResultError(null);
    try {
      await discoveryWorkspaceApi.reviewResult(workspace.id, result.fingerprint);
      return true;
    } catch (error) {
      const apiError = toApiClientError(error, 'The discovery result could not be reviewed.');
      setResultError(apiError);
      if (
        apiError.code === 'DISCOVERY_RESULT_REVIEW_STALE' ||
        apiError.code === 'DISCOVERY_RESULT_INVALID' ||
        apiError.code === 'DISCOVERY_RESULT_UNAVAILABLE'
      ) {
        setResult(null);
        setContentsReviewed(false);
        setRedistributionReviewed(false);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    contentsReviewed,
    lookupError,
    lookupLoading,
    redistributionReviewed,
    result,
    workspace,
  ]);

  const importResult = useCallback(async () => {
    if (workspace === null) return;
    setBusy(true);
    setResultError(null);
    try {
      await discoveryWorkspaceApi.importResult(workspace.id);
      await loadWorkspace();
    } catch (error) {
      setResultError(toApiClientError(error, 'The approved result could not be imported.'));
    } finally {
      setBusy(false);
    }
  }, [loadWorkspace, workspace]);

  const handleActionResult = useCallback(async (actionResult: RunActionResultView) => {
    if (actionResult.run.status !== 'completed' || workspace === null) return;
    if (actionResult.discoveryImportError !== undefined) {
      setResultError(new ApiClientError(
        actionResult.discoveryImportError.message,
        { code: actionResult.discoveryImportError.code, status: 0 },
      ));
    }
    if (actionResult.discoveryDraftId !== undefined) {
      setLookup({
        key,
        status: 'ready',
        workspace: { ...workspace, importedDraftId: actionResult.discoveryDraftId },
      });
    }
    await loadWorkspace();
  }, [key, loadWorkspace, workspace]);

  const setContentsApproval = useCallback((approved: boolean) => {
    setContentsReviewed(approved);
    setResultError(null);
  }, []);
  const setRedistributionApproval = useCallback((approved: boolean) => {
    setRedistributionReviewed(approved);
    setResultError(null);
  }, []);

  return useMemo(() => ({
    workspace,
    lookupLoading,
    lookupError,
    retryWorkspaceLookup: loadWorkspace,
    result,
    resultError,
    contentsReviewed,
    redistributionReviewed,
    setContentsApproval,
    setRedistributionApproval,
    busy,
    canMarkDone,
    shouldShowPanel,
    loadResult,
    reviewBeforeDone,
    importResult,
    handleActionResult,
  }), [
    busy,
    canMarkDone,
    contentsReviewed,
    handleActionResult,
    importResult,
    loadResult,
    loadWorkspace,
    lookupError,
    lookupLoading,
    result,
    resultError,
    reviewBeforeDone,
    redistributionReviewed,
    setContentsApproval,
    setRedistributionApproval,
    shouldShowPanel,
    workspace,
  ]);
}

export type DiscoveryRunReviewState = ReturnType<typeof useDiscoveryRunReview>;
