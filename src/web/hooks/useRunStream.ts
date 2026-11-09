import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError, isAbortError, type ApiClientError as ApiClientErrorType } from '../api/client';
import {
  decodeRunStreamMessage,
  runEventsPath,
  runsApi,
  type Run,
  type RunActionName,
  type RunActionResultView,
  type RunRecoveryOptions,
  type RunStreamServerMessage,
  type RunView,
  type RunsApi,
} from '../api/runs';
import { toApiClientError } from '../api/projects';
import { useStatusAnnouncer, type AnnouncementTone } from '../components/StatusRegion';

/**
 * Shared run snapshot and event-stream state.
 *
 * The hook fetches the run record first, then attaches the run WebSocket. A
 * reconnect repeats that order: snapshot first, then live deltas. It never
 * sends an action from mount, a timer, or a terminal transition, and terminal
 * bytes never pass through this hook or the aria-live region.
 */

export type RunStreamPhase = 'loading' | 'ready' | 'error';
export type RunConnectionState = 'connecting' | 'live' | 'offline';

export interface UseRunStreamOptions {
  runId: string;
  /** Test seam; the app always uses the same-origin typed client. */
  api?: RunsApi;
  /** Delay before reconnecting after a dropped event socket. */
  reconnectDelayMs?: number;
}

export interface UseRunStreamResult {
  phase: RunStreamPhase;
  view: RunView | null;
  error: ApiClientErrorType | null;
  connection: RunConnectionState;
  busyAction: RunActionName | null;
  actionError: ApiClientErrorType | null;
  reload: () => void;
  applyAction: (
    action: RunActionName,
    reason?: string,
  ) => Promise<RunActionResultView | null>;
  dismissActionError: () => void;
}

const FINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'aborted',
  'failed',
  'interrupted',
]);

const STEP_LABELS: Record<string, string> = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
  interrupted: 'interrupted',
};

function deriveRecovery(run: Run): RunRecoveryOptions | null {
  if (run.status !== 'interrupted') {
    return null;
  }
  const step = run.steps[run.currentStepIndex];
  const hasPending =
    step?.status === 'pending' ||
    run.steps.some((entry, index) => index > run.currentStepIndex && entry.status === 'pending');
  return {
    retry: step?.status === 'interrupted',
    continue: hasPending,
    restart: true,
  };
}

function viewFromActionResult(
  result: RunActionResultView,
  previous: RunView | null,
): RunView {
  return {
    run: result.run,
    projectPath: previous?.projectPath ?? '',
    terminalId: result.terminalId,
    actions: result.actions,
    recovery: result.recovery ?? deriveRecovery(result.run),
  };
}

function transitionSignature(view: RunView): string {
  const run = view.run;
  const step = run.steps[run.currentStepIndex];
  return [
    run.status,
    String(run.currentStepIndex),
    step?.status ?? 'none',
    step?.id ?? 'none',
  ].join('|');
}

function describeTransition(view: RunView): { message: string; tone: AnnouncementTone } | null {
  const run = view.run;
  const index = run.currentStepIndex;
  const total = run.steps.length;
  const step = run.steps[index];
  const stepLabel = step?.label ?? step?.skillName ?? (step?.kind === 'instruction' ? 'Instruction' : `Step ${String(index + 1)}`);
  const position = `Step ${String(index + 1)} of ${String(total)}`;

  if (run.status === 'completed') {
    return { message: 'The run completed.', tone: 'polite' };
  }
  if (run.status === 'aborted') {
    return { message: 'The run was aborted. No step was replayed.', tone: 'polite' };
  }
  if (run.status === 'interrupted') {
    return {
      message: 'The run was interrupted. Choose retry, continue, or restart. Nothing replays automatically.',
      tone: 'assertive',
    };
  }
  if (run.status === 'failed' || step?.status === 'failed') {
    return {
      message: `${position} (${stepLabel}) failed. Retry, skip, or abort.`,
      tone: 'assertive',
    };
  }
  if (run.status === 'paused') {
    return { message: `The run is paused at ${position.toLowerCase()}.`, tone: 'polite' };
  }
  if (run.status === 'awaiting-user') {
    return {
      message: `${position} (${stepLabel}) is awaiting your confirmation.`,
      tone: 'polite',
    };
  }
  if (step?.status === 'done') {
    return { message: `${position} (${stepLabel}) is done.`, tone: 'polite' };
  }
  if (step?.status === 'skipped') {
    return { message: `${position} (${stepLabel}) was skipped.`, tone: 'polite' };
  }
  if (step?.status === 'interrupted') {
    return {
      message: `${position} (${stepLabel}) was interrupted.`,
      tone: 'polite',
    };
  }
  if (run.status === 'running' || step?.status === 'running') {
    return { message: `${position} (${stepLabel}) started.`, tone: 'polite' };
  }
  if (run.status === 'starting') {
    return { message: 'The run is starting.', tone: 'polite' };
  }
  return null;
}

export function useRunStream({
  runId,
  api = runsApi,
  reconnectDelayMs = 1_000,
}: UseRunStreamOptions): UseRunStreamResult {
  const { announce } = useStatusAnnouncer();
  const [phase, setPhase] = useState<RunStreamPhase>('loading');
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState<ApiClientErrorType | null>(null);
  const [connection, setConnection] = useState<RunConnectionState>('connecting');
  const [busyAction, setBusyAction] = useState<RunActionName | null>(null);
  const [actionError, setActionError] = useState<ApiClientErrorType | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const viewRef = useRef<RunView | null>(null);
  const signatureRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const commitView = useCallback(
    (next: RunView) => {
      viewRef.current = next;
      if (!mountedRef.current) {
        return;
      }
      setView(next);

      const signature = transitionSignature(next);
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        const transition = describeTransition(next);
        if (transition !== null) {
          announce(transition.message, transition.tone);
        }
      }
    },
    [announce],
  );

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    const abortController = new AbortController();
    mountedRef.current = true;

    const clearReconnect = (): void => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const loadSnapshot = async (showLoading: boolean): Promise<boolean> => {
      if (showLoading) {
        setPhase('loading');
        setError(null);
      }

      try {
        const next = await api.getRun(runId, { signal: abortController.signal });
        if (disposed) {
          return false;
        }
        commitView(next);
        setPhase('ready');
        setError(null);
        return true;
      } catch (caught) {
        if (disposed || isAbortError(caught)) {
          return false;
        }
        const apiError = toApiClientError(
          caught,
          'The run could not be loaded because of an unexpected error.',
        );
        setError(apiError);
        setPhase('error');
        return false;
      }
    };

    const connect = (): void => {
      if (disposed) {
        return;
      }

      const url = new URL(runEventsPath(runId), window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(url.toString());
      socket = nextSocket;
      setConnection('connecting');

      nextSocket.addEventListener('open', () => {
        if (!disposed) {
          setConnection('live');
        }
      });

      nextSocket.addEventListener('message', (event) => {
        if (disposed || typeof event.data !== 'string') {
          return;
        }

        let message: RunStreamServerMessage | null;
        try {
          message = decodeRunStreamMessage(JSON.parse(event.data) as unknown);
        } catch {
          return;
        }
        if (message === null) {
          return;
        }

        if (message.type === 'error') {
          setActionError(
            new ApiClientError(message.message, {
              code: message.code,
              status: 0,
            }),
          );
          return;
        }

        const previous = viewRef.current;
        if (previous === null) {
          return;
        }

        if (message.type === 'snapshot') {
          commitView({
            run: message.run,
            projectPath: previous.projectPath,
            terminalId: message.terminalId,
            actions: message.actions,
            recovery: message.recovery ?? deriveRecovery(message.run),
          });
          return;
        }

        commitView({
          run: message.run,
          projectPath: previous.projectPath,
          terminalId: message.terminalId,
          actions: message.actions,
          recovery: previous.recovery ?? deriveRecovery(message.run),
        });
      });

      nextSocket.addEventListener('close', () => {
        if (disposed) {
          return;
        }
        setConnection('offline');
        const current = viewRef.current;
        if (current !== null && FINAL_RUN_STATUSES.has(current.run.status)) {
          return;
        }

        // Snapshot first, then deltas. Reconnect never sends an action.
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          void loadSnapshot(false).then((loaded) => {
            if (!disposed && loaded) {
              connect();
            }
          });
        }, reconnectDelayMs);
      });

      nextSocket.addEventListener('error', () => {
        // The close handler owns reconnection so a failed upgrade does not
        // schedule two sockets.
      });
    };

    void loadSnapshot(viewRef.current?.run.id !== runId).then((loaded) => {
      if (disposed || !loaded) {
        return;
      }
      // A finished run has no further deltas; do not open a socket that the
      // server would immediately reject. A live run still connects.
      const current = viewRef.current;
      if (current !== null && FINAL_RUN_STATUSES.has(current.run.status)) {
        setConnection('offline');
        return;
      }
      connect();
    });

    return () => {
      disposed = true;
      abortController.abort();
      clearReconnect();
      socket?.close();
      socket = null;
    };
  }, [api, commitView, reconnectDelayMs, reloadKey, runId]);

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  const applyAction = useCallback(
    async (action: RunActionName, reason?: string): Promise<RunActionResultView | null> => {
      if (busyRef.current) {
        return null;
      }
      busyRef.current = true;
      setBusyAction(action);
      setActionError(null);

      try {
        const result = await api.applyAction(runId, action, reason);
        if (mountedRef.current) {
          const wasFinal = viewRef.current !== null &&
            FINAL_RUN_STATUSES.has(viewRef.current.run.status);
          commitView(viewFromActionResult(result, viewRef.current));
          if (wasFinal && result.run.id === runId && !FINAL_RUN_STATUSES.has(result.run.status)) {
            setReloadKey((current) => current + 1);
          }
        }
        return result;
      } catch (caught) {
        const apiError = toApiClientError(
          caught,
          'The run action could not be applied because of an unexpected error.',
        );
        if (mountedRef.current) {
          setActionError(apiError);
          announce(`Run action failed: ${apiError.message}`, 'assertive');
        }
        return null;
      } finally {
        busyRef.current = false;
        if (mountedRef.current) {
          setBusyAction(null);
        }
      }
    },
    [announce, api, commitView, runId],
  );

  const dismissActionError = useCallback(() => {
    setActionError(null);
  }, []);

  return {
    phase,
    view,
    error,
    connection,
    busyAction,
    actionError,
    reload,
    applyAction,
    dismissActionError,
  };
}

/** Exported for the run view's status labels and tests. */
export { STEP_LABELS, deriveRecovery, FINAL_RUN_STATUSES };
