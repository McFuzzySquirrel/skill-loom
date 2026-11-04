import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClientError } from '../api/client';
import { isAbortError } from '../api/client';
import {
  preflightApi,
  type PreflightApi,
  type PreflightCheck,
  type PreflightHarness,
  type PreflightReport,
  type PreflightRunMode,
} from '../api/preflight';
import { toApiClientError } from '../api/projects';

/**
 * Shared preflight request state.
 *
 * Preflight is deliberately user-initiated: this hook never runs on mount, on a
 * timer, or as a consequence of a terminal transition. It keeps the last report,
 * the exact request signature that produced it, and the user's explicit
 * acknowledgement keys. Start gating is derived from those values so a stale
 * report can never enable Start after the inputs or mode changed.
 */

export type PreflightStatus = 'idle' | 'running' | 'ready' | 'error';

export interface UsePreflightOptions {
  projectId: string;
  chainId: string;
  harness: PreflightHarness | null;
  mode: PreflightRunMode;
  inputs: Record<string, string>;
  /** Chain revision, so a permission opt-in invalidates an older report. */
  revision?: string;
  /** Test seam; the app always uses the same-origin typed client. */
  api?: PreflightApi;
}

export interface UsePreflightResult {
  status: PreflightStatus;
  report: PreflightReport | null;
  error: ApiClientError | null;
  acknowledgedKeys: ReadonlySet<string>;
  requiredAcknowledgements: string[];
  missingAcknowledgements: string[];
  hardBlocks: PreflightCheck[];
  warningChecks: PreflightCheck[];
  isCurrent: boolean;
  canStart: boolean;
  run: () => Promise<PreflightReport | null>;
  toggleAcknowledgement: (key: string, acknowledged: boolean) => void;
}

/** Stable signature for the values that change what preflight checks. */
export function preflightSignature(
  mode: PreflightRunMode,
  inputs: Record<string, string>,
  revision = '',
): string {
  const keys = Object.keys(inputs).sort();
  return JSON.stringify({
    mode,
    revision,
    inputs: keys.map((key) => [key, inputs[key] ?? '']),
  });
}

export function usePreflight(options: UsePreflightOptions): UsePreflightResult {
  const { projectId, chainId, harness, mode, inputs, revision, api = preflightApi } = options;

  const [status, setStatus] = useState<PreflightStatus>('idle');
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [reportSignature, setReportSignature] = useState<string | null>(null);
  const [acknowledgedKeys, setAcknowledgedKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const run = useCallback(async (): Promise<PreflightReport | null> => {
    if (harness === null) {
      return null;
    }

    const signature = preflightSignature(mode, inputs, revision ?? '');
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('running');
    setError(null);

    try {
      const nextReport = await api.runPreflight(
        projectId,
        {
          chainId,
          harness,
          mode,
          inputs: { ...inputs },
          acknowledgements: [...acknowledgedKeys],
        },
        { signal: controller.signal },
      );

      if (requestId !== requestIdRef.current) {
        return null;
      }

      setReport(nextReport);
      setReportSignature(signature);
      setStatus('ready');
      return nextReport;
    } catch (caught) {
      if (isAbortError(caught) || requestId !== requestIdRef.current) {
        return null;
      }
      setError(
        toApiClientError(caught, 'Preflight could not run because of an unexpected error.'),
      );
      setStatus('error');
      return null;
    }
  }, [
    acknowledgedKeys,
    api,
    chainId,
    harness,
    inputs,
    mode,
    projectId,
    revision,
  ]);

  const toggleAcknowledgement = useCallback((key: string, acknowledged: boolean) => {
    setAcknowledgedKeys((current) => {
      const next = new Set(current);
      if (acknowledged) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const requiredAcknowledgements = report?.acknowledgements.required ?? [];
  const missingAcknowledgements = requiredAcknowledgements.filter(
    (key) => !acknowledgedKeys.has(key),
  );
  const hardBlocks = report?.checks.filter((check) => check.status === 'block') ?? [];
  const warningChecks =
    report?.checks.filter(
      (check) => check.status === 'warn' || check.status === 'acknowledge',
    ) ?? [];
  const isCurrent =
    report !== null && reportSignature === preflightSignature(mode, inputs, revision ?? '');
  const canStart =
    isCurrent &&
    report !== null &&
    report.status !== 'blocked' &&
    missingAcknowledgements.length === 0;

  return {
    status,
    report,
    error,
    acknowledgedKeys,
    requiredAcknowledgements,
    missingAcknowledgements,
    hardBlocks,
    warningChecks,
    isCurrent,
    canStart,
    run,
    toggleAcknowledgement,
  };
}
