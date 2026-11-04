import { useEffect, useId, useRef, useState } from 'react';
import type { CatalogApi, CatalogHarness, CatalogWarning, SkillEntry } from '../api/catalog';
import { CATALOG_HARNESSES } from '../api/catalog';
import { HARNESS_LABELS, useCatalog } from '../hooks/useCatalog';
import { InlineError } from './InlineError';
import { SkillDetail } from './SkillDetail';
import { SkillSourceBadge, SOURCE_LABELS } from './SkillSourceBadge';
import { ExtraDirectoriesDialog } from './ExtraDirectoriesDialog';

export interface SkillCatalogProps {
  projectId: string;
  /** Project route omits Add as step; the chain builder passes a handler. */
  context?: 'project' | 'builder';
  initialHarness?: CatalogHarness;
  onAddAsStep?: (skill: SkillEntry) => void;
  /**
   * Reports every discovered entry after a successful load so a sibling editor
   * can offer the same skill names without issuing a second catalog request.
   */
  onCatalogChange?: (entries: SkillEntry[]) => void;
  api?: CatalogApi;
}

function harnessDescription(harness: CatalogHarness): string {
  return harness === 'opencode'
    ? 'Scans the project .opencode/skills directory, the personal OpenCode skills directory, and Loom extra directories.'
    : 'Runs the Copilot CLI command "copilot skill list --json" in this project and merges the reported sources.';
}

/**
 * Skill catalog panel (CAT-FR-05).
 *
 * Entries are grouped by server-reported source, duplicate names stay separate,
 * search filters on name and description after a 150 ms debounce, and warnings
 * render above results instead of replacing them. The panel never invents a
 * summary and never renders harness text as HTML.
 */
export function SkillCatalog({
  projectId,
  context = 'project',
  initialHarness = 'opencode',
  onAddAsStep,
  onCatalogChange,
  api,
}: SkillCatalogProps) {
  const baseId = useId();
  const searchId = `${baseId}-search`;
  const harnessHintId = `${baseId}-harness-hint`;
  const warningsId = `${baseId}-warnings`;
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const { harness, setHarness, query, setQuery, clearSearch, state, refresh, harnessLabel } =
    useCatalog({
      projectId,
      initialHarness,
      ...(api === undefined ? {} : { api }),
    });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const restoreSettingsFocus = useRef(false);

  useEffect(() => {
    if (!settingsOpen && restoreSettingsFocus.current) {
      restoreSettingsFocus.current = false;
      settingsTrigger.current?.focus();
    }
  }, [settingsOpen]);

  const closeSettings = () => {
    restoreSettingsFocus.current = true;
    setSettingsOpen(false);
  };

  const data = state.data;

  useEffect(() => {
    if (onCatalogChange === undefined || state.status !== 'ready' || data === null) {
      return;
    }
    onCatalogChange(data.groups.flatMap((group) => group.entries));
  }, [data, onCatalogChange, state.status]);

  return (
    <section className="catalog" aria-labelledby={titleId} data-testid="skill-catalog">
      <div className="catalog__heading">
        <div>
          <h2 className="section-title catalog__title" id={titleId}>
            Skill catalog
          </h2>
          <p className="field__hint">
            Descriptions come from each SKILL.md frontmatter. Skill Loom never adds a model
            summary or recommendation.
          </p>
        </div>
        <div className="catalog__heading-actions">
          <button
            type="button"
            className="button button--secondary button--small"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => {
              setSettingsOpen(false);
              setCollapsed((current) => !current);
            }}
            data-testid="catalog-toggle"
          >
            <span aria-hidden="true">{collapsed ? '▸ ' : '▾ '}</span>
            {collapsed ? 'Show catalog' : 'Hide catalog'}
          </button>
          {collapsed ? null : (
            <button
              type="button"
              ref={settingsTrigger}
              className="button button--secondary button--small"
              onClick={() => setSettingsOpen(true)}
              data-testid="catalog-settings-open"
            >
              Manage extra skill directories
            </button>
          )}
        </div>
      </div>

      {collapsed && data !== null ? (
        <p className="catalog__summary" data-testid="catalog-collapsed-summary">
          <span aria-hidden="true">●</span> {String(data.total)} skill
          {data.total === 1 ? '' : 's'} in {String(data.groups.length)} source
          {data.groups.length === 1 ? '' : 's'} · expand to search and inspect
        </p>
      ) : null}

      <div id={bodyId} hidden={collapsed}>
      <div className="catalog__controls">
        <fieldset className="catalog__harness" aria-describedby={harnessHintId}>
          <legend className="field__label">Harness</legend>
          <div className="catalog__harness-options">
            {CATALOG_HARNESSES.map((value) => (
              <label className="catalog__harness-option" key={value}>
                <input
                  type="radio"
                  name={`${baseId}-harness`}
                  value={value}
                  checked={harness === value}
                  onChange={() => {
                    setExpandedId(null);
                    setHarness(value);
                  }}
                  data-testid={`catalog-harness-${value}`}
                />
                <span>{HARNESS_LABELS[value]}</span>
              </label>
            ))}
          </div>
          <p className="field__hint" id={harnessHintId}>
            {harnessDescription(harness)}
          </p>
        </fieldset>

        <div className="field catalog__search">
          <label className="field__label" htmlFor={searchId}>
            Search skills
          </label>
          <input
            className="input"
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name or description"
            autoComplete="off"
            data-testid="catalog-search"
          />
          <p className="field__hint">
            Filters name and description. Results update after a short pause.
          </p>
        </div>

        <div className="catalog__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={refresh}
            disabled={state.status === 'loading' || state.refreshing}
            data-testid="catalog-refresh"
          >
            {state.refreshing ? 'Refreshing…' : 'Refresh catalog'}
          </button>
        </div>
      </div>

      {state.status === 'loading' ? (
        <p className="state-note" data-testid="catalog-loading">
          <span aria-hidden="true">◌</span> Loading {harnessLabel} skills…
        </p>
      ) : null}

      {state.status === 'error' && state.error !== null ? (
        <div data-testid="catalog-error">
          <InlineError
            title="Skill catalog failed"
            message={state.error.message}
            code={state.error.code}
            httpStatus={state.error.status}
            onRetry={refresh}
          />
        </div>
      ) : null}

      {state.status === 'ready' && data !== null ? (
        <>
          {state.refreshing ? (
            <p className="state-note catalog__refreshing" data-testid="catalog-refreshing">
              <span aria-hidden="true">◌</span> Refreshing {harnessLabel} skills…
            </p>
          ) : null}

          <p className="catalog__summary" data-testid="catalog-summary">
            <span aria-hidden="true">●</span> {String(data.total)} skill
            {data.total === 1 ? '' : 's'} in {String(data.groups.length)} source
            {data.groups.length === 1 ? '' : 's'} · scanned in {String(data.elapsedMs)} ms
          </p>

          {data.warnings.length > 0 ? (
            <section
              className="catalog-warnings"
              aria-labelledby={warningsId}
              data-testid="catalog-warnings"
            >
              <h3 className="catalog-warnings__title" id={warningsId}>
                <span aria-hidden="true">▲</span> {String(data.warnings.length)} discovery
                warning{data.warnings.length === 1 ? '' : 's'} — results are still shown
              </h3>
              <ul className="catalog-warnings__list">
                {data.warnings.map((warning, index) => (
                  <WarningRow
                    warning={warning}
                    key={`${warning.code}-${warning.path ?? ''}-${String(index)}`}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {data.total === 0 ? (
            <div className="empty-state" data-testid="catalog-empty">
              {data.query === '' ? (
                <p>
                  No skills discovered for {harnessLabel} in this project. Add a SKILL.md
                  package or configure an extra skill directory.
                </p>
              ) : (
                <p>
                  No skills match &quot;{data.query}&quot; in the {harnessLabel} catalog.
                </p>
              )}
              {data.query === '' ? null : (
                <p>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={clearSearch}
                  >
                    Clear search
                  </button>
                </p>
              )}
            </div>
          ) : null}

          {data.groups.map((group) => {
            const groupTitleId = `${baseId}-group-${group.source}`;
            return (
              <section
                className="catalog-group"
                key={group.source}
                aria-labelledby={groupTitleId}
                data-testid="catalog-group"
                data-source={group.source}
              >
                <h3 className="catalog-group__header" id={groupTitleId}>
                  <SkillSourceBadge source={group.source} />
                  <span className="catalog-group__label">
                    {SOURCE_LABELS[group.source]} skills
                  </span>
                  <span className="catalog-group__count">
                    {String(group.count)} skill{group.count === 1 ? '' : 's'}
                  </span>
                </h3>
                <ul className="catalog-group__list">
                  {group.entries.map((skill) => {
                    const expanded = expandedId === skill.id;
                    const detailId = `${baseId}-detail-${skill.id}`;
                    const toggleId = `${baseId}-toggle-${skill.id}`;
                    return (
                      <li
                        className={`skill-row${expanded ? ' skill-row--expanded' : ''}`}
                        key={skill.id}
                        data-testid="skill-row"
                        data-skill-id={skill.id}
                        data-source={skill.source}
                        data-name={skill.name}
                      >
                        <button
                          type="button"
                          className="skill-row__toggle"
                          id={toggleId}
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={() =>
                            setExpandedId((current) =>
                              current === skill.id ? null : skill.id,
                            )
                          }
                        >
                          <span className="skill-row__indicator" aria-hidden="true">
                            {expanded ? '▾' : '▸'}
                          </span>
                          <span className="skill-row__name">{skill.name}</span>
                          <SkillSourceBadge source={skill.source} />
                          {!skill.enabled ? (
                            <span className="status-tag status-tag--warning">
                              <span aria-hidden="true">○</span> Disabled by harness
                            </span>
                          ) : null}
                          <span className="skill-row__description">
                            {skill.description === ''
                              ? 'No description in SKILL.md.'
                              : skill.description}
                          </span>
                          <span className="skill-row__path">
                            <code>{skill.path}</code>
                          </span>
                        </button>
                        {expanded ? (
                          <SkillDetail
                            projectId={projectId}
                            skill={skill}
                            detailId={detailId}
                            {...(context === 'builder' && onAddAsStep !== undefined
                              ? { onAddAsStep }
                              : {})}
                            {...(!skill.enabled
                              ? {
                                  addDisabledReason:
                                    'This skill is disabled by the harness, so it cannot be added as a step.',
                                }
                              : {})}
                            onSkillCopied={() => {
                              refresh();
                            }}
                            {...(api === undefined ? {} : { api })}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      ) : null}

      {settingsOpen ? (
        <ExtraDirectoriesDialog
          onClose={closeSettings}
          onDirectoriesChanged={() => {
            refresh();
          }}
          {...(api === undefined ? {} : { api })}
        />
      ) : null}
      </div>
    </section>
  );
}

function WarningRow({ warning }: { warning: CatalogWarning }) {
  return (
    <li className="catalog-warnings__item" data-testid="catalog-warning">
      <p className="catalog-warnings__message">{warning.message}</p>
      <p className="catalog-warnings__meta">
        <code>{warning.code}</code>
        {warning.source === undefined ? null : <> · source {SOURCE_LABELS[warning.source]}</>}
        {warning.path === undefined ? null : <> · <code>{warning.path}</code></>}
        {warning.command === undefined ? null : <> · command <code>{warning.command}</code></>}
        {warning.exitCode === undefined || warning.exitCode === null ? null : (
          <> · exit code {String(warning.exitCode)}</>
        )}
      </p>
      {warning.reason === undefined ? null : (
        <p className="catalog-warnings__meta">Reason: {warning.reason}</p>
      )}
      {warning.stderr === undefined ? null : (
        <pre className="catalog-warnings__stderr">{warning.stderr}</pre>
      )}
    </li>
  );
}
