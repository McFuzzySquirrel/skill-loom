import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  REMOTE_CATALOG_LIMIT_KEYS,
  type RemoteCatalogLimitOverrides,
  type RemoteCatalogLimits as Limits,
} from '../../shared/remote-catalog';
import {
  toApiClientError,
  type CatalogApi,
  type RemoteCatalogSettings,
  type RemoteSkillSource,
} from '../api/catalog';
import type { ApiClientError } from '../api/client';
import { useRouter } from '../router';
import { BYTES_PER_MB, formatMegabytes } from '../utils/size';
import { InlineError } from './InlineError';
import { useStatusAnnouncer } from './StatusRegion';

const LABELS: Record<keyof Limits, string> = {
  maxPackages: 'Skill packages per snapshot',
  maxAgents: 'Native agents per snapshot',
  maxFiles: 'Files per snapshot',
  maxPackageBytes: 'Size per skill package or agent (MB)',
  maxSnapshotBytes: 'Total decoded snapshot size (MB)',
  maxStagingBytes: 'Git staging size (MB)',
  maxStagingEntries: 'Git staging entries',
  maxCommandOutputBytes: 'Git command output size (MB)',
  cloneTimeoutMs: 'Clone timeout in milliseconds',
  commandTimeoutMs: 'Git command timeout in milliseconds',
};

type Values = Record<keyof Limits, string>;

function unitScale(name: keyof Limits): number {
  return name.endsWith('Bytes') ? BYTES_PER_MB : 1;
}

function strings(limits: Limits): Values {
  return {
    maxPackages: String(limits.maxPackages),
    maxAgents: String(limits.maxAgents),
    maxFiles: String(limits.maxFiles),
    maxPackageBytes: String(limits.maxPackageBytes / BYTES_PER_MB),
    maxSnapshotBytes: String(limits.maxSnapshotBytes / BYTES_PER_MB),
    maxStagingBytes: String(limits.maxStagingBytes / BYTES_PER_MB),
    maxStagingEntries: String(limits.maxStagingEntries),
    maxCommandOutputBytes: String(limits.maxCommandOutputBytes / BYTES_PER_MB),
    cloneTimeoutMs: String(limits.cloneTimeoutMs),
    commandTimeoutMs: String(limits.commandTimeoutMs),
  };
}

function LimitField(props: {
  name: keyof Limits;
  value: string;
  maximum: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const scale = unitScale(props.name);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{LABELS[props.name]}</label>
      <input
        className="input"
        id={id}
        type="number"
        min={1 / scale}
        max={props.maximum / scale}
        step={1 / scale}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
        required
      />
      <span className="field__hint">
        Maximum: {scale === 1 ? props.maximum.toLocaleString() : formatMegabytes(props.maximum)}
      </span>
    </div>
  );
}

export function RemoteCatalogLimits({
  api,
  sources,
  onSourceUpdated,
  onDirtyChange,
}: {
  api: CatalogApi;
  sources: RemoteSkillSource[];
  onSourceUpdated: (source: RemoteSkillSource) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { announce } = useStatusAnnouncer();
  const { navigate, setNavigationGuard } = useRouter();
  const scopeId = useId();
  const leaveHeadingId = useId();
  const leaveHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [settings, setSettings] = useState<RemoteCatalogSettings | null>(null);
  const [scope, setScope] = useState('global');
  const [values, setValues] = useState<Values | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const selectedSource = sources.find((source) => source.id === scope);
  const baseline = useMemo(() => settings === null ? null : {
    ...settings.global,
    ...(scope === 'global' ? {} : selectedSource?.limits),
  }, [settings, scope, selectedSource]);
  const baselineKey = baseline === null ? '' : JSON.stringify(baseline);
  const baselineValues = baseline === null ? null : strings(baseline);
  const dirty = values !== null && baseline !== null &&
    REMOTE_CATALOG_LIMIT_KEYS.some((key) => values[key] !== baselineValues?.[key]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    void api.getRemoteCatalogLimits().then(setSettings).catch((failure: unknown) => {
      const problem = toApiClientError(failure, 'Catalog limits could not be loaded.');
      setError(problem);
      announce(`Catalog limits could not be loaded: ${problem.message}`, 'assertive');
    });
  }, [api, announce]);
  useEffect(() => {
    if (baseline !== null) setValues(strings(baseline));
  // The key changes only when effective limits change, not when a source list is refreshed.
  }, [baselineKey]);
  useEffect(() => {
    setNavigationGuard((to) => {
      if (!dirtyRef.current) return true;
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingNavigation(to);
      announce('Remote catalog limits have unsaved changes.');
      return false;
    });
    return () => setNavigationGuard(null);
  }, [announce, setNavigationGuard]);
  useEffect(() => {
    if (pendingNavigation !== null) leaveHeading.current?.focus();
  }, [pendingNavigation]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = 'Remote catalog limit changes have not been saved.';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  useEffect(() => {
    if (scope !== 'global' && selectedSource === undefined && !dirty) setScope('global');
  }, [scope, selectedSource, dirty]);

  const resetSource = async () => {
    setBusy(true);
    setError(null);
    try {
      onSourceUpdated(await api.setRemoteSourceLimits(scope, null));
      announce('This repository now uses the global catalog limits.');
    } catch (failure) {
      const problem = toApiClientError(failure, 'Catalog limits could not be reset.');
      setError(problem);
      announce(`Catalog limits could not be reset: ${problem.message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (settings === null || values === null) return;
    const next: RemoteCatalogLimitOverrides = {};
    for (const key of REMOTE_CATALOG_LIMIT_KEYS) {
      const scale = unitScale(key);
      const entered = Number(values[key]);
      const value = scale === 1 ? entered : Math.round(entered * scale);
      if (!Number.isSafeInteger(value) || value < 1 || value > settings.maximums[key]) {
        announce(`The ${LABELS[key]} limit is invalid.`, 'assertive');
        return;
      }
      if (scope === 'global' || value !== settings.global[key]) next[key] = value;
    }
    setBusy(true);
    setError(null);
    try {
      if (scope === 'global') {
        setSettings(await api.setRemoteCatalogLimits(next));
      } else {
        onSourceUpdated(await api.setRemoteSourceLimits(scope, Object.keys(next).length === 0 ? null : next));
      }
      announce('Remote catalog limits saved.');
    } catch (failure) {
      const problem = toApiClientError(failure, 'Catalog limits could not be saved.');
      setError(problem);
      announce(`Catalog limits could not be saved: ${problem.message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="remote-limits-title">
      {pendingNavigation === null ? null : (
        <section className="confirm-panel builder-leave-guard" role="group" aria-labelledby={leaveHeadingId}>
          <h3 id={leaveHeadingId} ref={leaveHeading} tabIndex={-1}>Discard unsaved catalog limits?</h3>
          <p>Leaving discards limits that have not been saved. Staying keeps your changes.</p>
          <div className="panel__actions">
            <button type="button" className="button button--danger button--small" onClick={() => {
              const target = pendingNavigation;
              setPendingNavigation(null);
              dirtyRef.current = false;
              navigate(target, { skipGuard: true });
            }}>Leave and discard changes</button>
            <button type="button" className="button button--secondary button--small" onClick={() => {
              setPendingNavigation(null);
              announce('Stayed on catalog limits. Unsaved changes were kept.');
              returnFocus.current?.focus();
            }}>Stay and keep editing</button>
          </div>
        </section>
      )}
      {error === null ? null : <InlineError title="Catalog limits" message={error.message} code={error.code} httpStatus={error.status} />}
      <details className="remote-catalog-limits">
        <summary id="remote-limits-title">
          <h2 className="section-title">Remote catalog limits</h2>
        </summary>
        <p className="field__hint">
          Limits apply to future refreshes, not existing snapshots. Increasing them uses more disk,
          memory, and network resources. Git staging is monitored while Git runs, not an OS quota.
          Bundle and discovery handoff limits are separate. Sizes use MB (1 MB = 1,000,000 bytes).
        </p>
        {settings === null || values === null || baseline === null ? <p>{error === null ? 'Loading catalog limits…' : 'Catalog limits are unavailable.'}</p> : (
          <form className="catalog-settings__form" onSubmit={(event) => void save(event)}>
            <div className="field">
              <label className="field__label" htmlFor={scopeId}>Limits for</label>
              <select id={scopeId} className="input" value={scope} onChange={(event) => setScope(event.target.value)} disabled={busy || dirty}>
                <option value="global">All repositories by default</option>
                {sources.map((source) => <option key={source.id} value={source.id}>{source.repository}</option>)}
              </select>
              {dirty ? <span className="field__hint">Save or discard changes before switching repositories.</span> : null}
            </div>
            {REMOTE_CATALOG_LIMIT_KEYS.map((key) => (
              <LimitField
                key={key}
                name={key}
                value={values[key]}
                maximum={settings.maximums[key]}
                disabled={busy}
                onChange={(value) => setValues((current) => current === null ? current : { ...current, [key]: value })}
              />
            ))}
            <div className="panel__actions">
              <button type="submit" className="button" disabled={busy || !dirty}>Save limits</button>
              <button type="button" className="button button--secondary" disabled={busy || !dirty} onClick={() => setValues(strings(baseline))}>Discard changes</button>
              {scope !== 'global' && selectedSource?.limits !== undefined ? (
                <button type="button" className="button button--secondary" disabled={busy || dirty} onClick={() => void resetSource()}>
                  Use global limits
                </button>
              ) : null}
            </div>
          </form>
        )}
      </details>
    </section>
  );
}
