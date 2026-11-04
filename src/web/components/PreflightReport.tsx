import { useId } from 'react';
import type {
  PreflightCatalogWarning,
  PreflightCheck,
  PreflightCheckStatus,
  PreflightReport as PreflightReportData,
} from '../api/preflight';

/**
 * Structured preflight findings.
 *
 * Blocking findings are always rendered individually with their remediation;
 * they are never collapsed into a summary count. Warnings and
 * acknowledgement-required findings are grouped separately, and every required
 * acknowledgement is an explicit checkbox. The component only presents server
 * data: it never starts a run or mutates the chain.
 */

export interface PreflightReportProps {
  report: PreflightReportData;
  acknowledgedKeys: ReadonlySet<string>;
  onToggleAcknowledgement: (key: string, acknowledged: boolean) => void;
}

const STATUS_LABELS: Record<PreflightCheckStatus, string> = {
  block: 'Blocking',
  warn: 'Warning',
  acknowledge: 'Acknowledgement required',
  pass: 'Passed',
};

const STATUS_ICONS: Record<PreflightCheckStatus, string> = {
  block: '✕',
  warn: '▲',
  acknowledge: '○',
  pass: '✓',
};

/** Human wording for a stable acknowledgement key. */
export function acknowledgementLabel(key: string): string {
  if (key === 'warnings') {
    return 'I reviewed the warnings and understand they do not block this run.';
  }
  if (key.startsWith('authentication:')) {
    return 'I acknowledge that local authentication could not be verified automatically.';
  }
  if (key.startsWith('trust:')) {
    return 'I acknowledge the manual trust fallback and confirm the folder is trusted.';
  }
  return `I acknowledge: ${key}`;
}

function acknowledgementHint(key: string): string {
  if (key === 'warnings') {
    return 'Warnings never block a run, but Start stays disabled until this box is checked.';
  }
  if (key.startsWith('authentication:')) {
    return 'The harness may still be authenticated through a mechanism preflight cannot inspect.';
  }
  if (key.startsWith('trust:')) {
    return 'Accept the folder-trust dialog, or run the exact manual command shown in the trust panel.';
  }
  return 'Acknowledge this finding explicitly before Start is enabled.';
}

function remediationFor(check: PreflightCheck): string | null {
  if (check.remediation !== null && check.remediation.trim() !== '') {
    return check.remediation;
  }
  if (check.status === 'block') {
    return 'Fix this finding in the chain or project, then run preflight again.';
  }
  return null;
}

function FindingItem({ check }: { check: PreflightCheck }) {
  const remediation = remediationFor(check);

  return (
    <li
      className={`preflight-finding preflight-finding--${check.status}`}
      data-testid="preflight-finding"
      data-check-id={check.id}
      data-check-key={check.key}
      data-status={check.status}
      data-severity={check.severity}
    >
      <p className="preflight-finding__badge">
        <span aria-hidden="true">{STATUS_ICONS[check.status]}</span>{' '}
        {STATUS_LABELS[check.status]}
        {check.stepIndex === undefined ? null : (
          <span className="preflight-finding__step">
            {' '}
            · Step {check.stepIndex + 1}
          </span>
        )}
      </p>
      <p className="preflight-finding__message">{check.message}</p>
      {remediation === null ? null : (
        <p className="preflight-finding__remediation" data-testid="preflight-remediation">
          <strong>Remediation:</strong> {remediation}
        </p>
      )}
    </li>
  );
}

function CatalogWarningItem({ warning }: { warning: PreflightCatalogWarning }) {
  return (
    <li
      className="preflight-finding preflight-finding--warn"
      data-testid="preflight-catalog-warning"
    >
      <p className="preflight-finding__badge">
        <span aria-hidden="true">▲</span> Catalog warning
      </p>
      <p className="preflight-finding__message">{warning.message}</p>
      <p className="preflight-finding__meta">
        {warning.code}
        {warning.path === '' ? '' : ` · ${warning.path}`}
      </p>
      <p className="preflight-finding__remediation">
        <strong>Remediation:</strong> Review the catalog warning above; valid skills are still
        used. Fix the source and run preflight again to clear it.
      </p>
    </li>
  );
}

export function PreflightReport({
  report,
  acknowledgedKeys,
  onToggleAcknowledgement,
}: PreflightReportProps) {
  const prefix = useId();
  const blocking = report.checks.filter((check) => check.status === 'block');
  const warningChecks = report.checks.filter(
    (check) => check.status === 'warn' || check.status === 'acknowledge',
  );
  const passed = report.checks.filter((check) => check.status === 'pass');
  const required = report.acknowledgements.required;
  const missing = required.filter((key) => !acknowledgedKeys.has(key));
  const warningCount = warningChecks.length + report.catalogWarnings.length;

  const summary = (() => {
    if (report.status === 'blocked') {
      return {
        tone: 'blocked',
        icon: '✕',
        text: `Blocked by ${String(blocking.length)} finding${
          blocking.length === 1 ? '' : 's'
        }. Start is disabled.`,
      };
    }
    if (missing.length > 0) {
      return {
        tone: 'warning',
        icon: '▲',
        text: `Preflight passed with ${String(warningCount)} warning${
          warningCount === 1 ? '' : 's'
        }. ${String(missing.length)} acknowledgement${
          missing.length === 1 ? '' : 's'
        } required before Start.`,
      };
    }
    return {
      tone: 'ok',
      icon: '✓',
      text:
        warningCount === 0
          ? 'Preflight passed with no blocking findings and no warnings.'
          : `Preflight passed with ${String(warningCount)} acknowledged warning${
              warningCount === 1 ? '' : 's'
            }.`,
    };
  })();

  return (
    <section
      className="preflight-report"
      aria-labelledby={`${prefix}-title`}
      data-testid="preflight-report"
      data-status={report.status}
    >
      <h2 className="section-title preflight-section-title" id={`${prefix}-title`}>
        Preflight results
      </h2>

      <p
        className={`preflight-summary preflight-summary--${summary.tone}`}
        data-testid="preflight-summary"
        data-tone={summary.tone}
      >
        <span aria-hidden="true">{summary.icon}</span> {summary.text}
      </p>

      <section
        className="preflight-group"
        aria-labelledby={`${prefix}-blocking-title`}
        data-testid="preflight-blocking"
        data-count={blocking.length}
      >
        <h3 className="preflight-group__title" id={`${prefix}-blocking-title`}>
          Blocking ({blocking.length})
        </h3>
        {blocking.length === 0 ? (
          <p className="state-note" data-testid="preflight-blocking-empty">
            <span aria-hidden="true">✓</span> No blocking findings.
          </p>
        ) : (
          <ul className="preflight-finding-list">
            {blocking.map((check) => (
              <FindingItem key={check.key} check={check} />
            ))}
          </ul>
        )}
      </section>

      <section
        className="preflight-group"
        aria-labelledby={`${prefix}-warnings-title`}
        data-testid="preflight-warnings"
        data-count={warningCount}
      >
        <h3 className="preflight-group__title" id={`${prefix}-warnings-title`}>
          Warnings ({warningCount})
        </h3>
        {warningCount === 0 ? (
          <p className="state-note" data-testid="preflight-warnings-empty">
            <span aria-hidden="true">✓</span> No warnings.
          </p>
        ) : (
          <ul className="preflight-finding-list">
            {warningChecks.map((check) => (
              <FindingItem key={check.key} check={check} />
            ))}
            {report.catalogWarnings.map((warning, index) => (
              <CatalogWarningItem
                key={`catalog-warning-${warning.code}-${String(index)}`}
                warning={warning}
              />
            ))}
          </ul>
        )}
      </section>

      <section
        className="preflight-acknowledgements"
        aria-labelledby={`${prefix}-ack-title`}
        data-testid="preflight-acknowledgements"
      >
        <h3 className="preflight-group__title" id={`${prefix}-ack-title`}>
          Required acknowledgements ({required.length})
        </h3>
        {required.length === 0 ? (
          <p className="state-note" data-testid="preflight-acknowledgements-empty">
            <span aria-hidden="true">✓</span> No acknowledgements are required.
          </p>
        ) : (
          <>
            <p className="field__hint">
              Every item below must be acknowledged before Start is enabled. Acknowledging a
              finding records your decision; it does not change the server report.
            </p>
            {required.map((key) => {
              const checkboxId = `${prefix}-ack-${key.replaceAll(/[^A-Za-z0-9_-]/g, '-')}`;
              return (
                <div className="checkbox-field preflight-acknowledgement" key={key}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={acknowledgedKeys.has(key)}
                    onChange={(event) =>
                      onToggleAcknowledgement(key, event.target.checked)
                    }
                    data-testid="preflight-acknowledgement"
                    data-ack-key={key}
                  />
                  <label htmlFor={checkboxId}>{acknowledgementLabel(key)}</label>
                  <p className="field__hint">{acknowledgementHint(key)}</p>
                </div>
              );
            })}
          </>
        )}
      </section>

      {passed.length === 0 ? null : (
        <details className="preflight-passed" data-testid="preflight-passed">
          <summary>Passed checks ({passed.length})</summary>
          <ul className="preflight-finding-list preflight-finding-list--passed">
            {passed.map((check) => (
              <li className="preflight-passed__item" key={check.key}>
                <span aria-hidden="true">✓</span> {check.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.skills.length === 0 ? null : (
        <section
          className="preflight-skills"
          aria-labelledby={`${prefix}-skills-title`}
          data-testid="preflight-skill-resolution"
        >
          <h3 className="preflight-group__title" id={`${prefix}-skills-title`}>
            Skill resolution
          </h3>
          <ul className="preflight-skill-list">
            {report.skills.map((skill) => (
              <li className="preflight-skill" key={skill.stepId} data-resolved={skill.resolved}>
                <span aria-hidden="true">{skill.resolved ? '✓' : '✕'}</span> Step{' '}
                {skill.stepIndex + 1} · {skill.stepLabel} →{' '}
                <code>{skill.skillName}</code>{' '}
                {skill.resolved ? 'resolved' : 'not resolved'}
                {skill.path === null ? null : (
                  <span className="preflight-skill__path"> · {skill.path}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="field__hint">
            Skills are model-invoked context. Slan guarantees prompt order, but a harness may
            decline to load a named skill.
          </p>
        </section>
      )}
    </section>
  );
}
