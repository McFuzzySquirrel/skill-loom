import { useEffect, useId, useRef, useState } from 'react';
import type {
  CatalogApi,
  CatalogHarness,
  CatalogWarning,
  NativeAgentCopyResult,
  NativeAgentEntry,
  SkillEntry,
  SkillSource,
} from '../api/catalog';
import { catalogApi, CATALOG_HARNESSES, toApiClientError } from '../api/catalog';
import type { ApiClientError } from '../api/client';
import { HARNESS_LABELS, useCatalog } from '../hooks/useCatalog';
import { InlineError } from './InlineError';
import { SkillDetail } from './SkillDetail';
import { SkillSourceBadge, SOURCE_LABELS } from './SkillSourceBadge';
import { ExtraDirectoriesDialog } from './ExtraDirectoriesDialog';
import { HelpPopover } from './HelpPopover';
import { useStatusAnnouncer } from './StatusRegion';

export interface SkillCatalogProps {
  projectId: string;
  /** Project route omits Add as step; the chain builder passes a handler. */
  context?: 'project' | 'builder';
  initiallyExpanded?: boolean;
  initialHarness?: CatalogHarness;
  onAddAsStep?: (skill: SkillEntry) => void;
  onAddNativeAgent?: (agent: NativeAgentEntry, copy: NativeAgentCopyResult) => void;
  onSelectNativeAgent?: (agent: NativeAgentEntry) => void;
  remoteOnly?: boolean;
  /**
   * Reports every discovered entry after a successful load so a sibling editor
   * can offer the same skill names without issuing a second catalog request.
   */
  onCatalogChange?: (entries: SkillEntry[]) => void;
  api?: CatalogApi;
}

function harnessDescription(harness: CatalogHarness): string {
  return harness === 'opencode'
    ? 'Scans shared project .agents/skills and legacy .opencode/skills directories, personal OpenCode skills, and Loom extra directories.'
    : 'Runs the Copilot CLI command "copilot skill list --json" in this project and merges the reported sources.';
}

/**
 * Skill catalog panel (CAT-FR-05).
 *
 * Entries are grouped by source, with each Loom extra directory shown in its
 * own collapsed group. Duplicate names stay separate, search filters on name
 * and description after a 150 ms debounce, and warnings render above results
 * instead of replacing them. The panel never invents a summary and never
 * renders harness text as HTML.
 */
export function SkillCatalog({
  projectId,
  context = 'project',
  initiallyExpanded = context === 'project',
  initialHarness = 'opencode',
  onAddAsStep,
  onAddNativeAgent,
  onSelectNativeAgent,
  onCatalogChange,
  remoteOnly = false,
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedExtraGroups, setExpandedExtraGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsed, setCollapsed] = useState(!initiallyExpanded);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copyingAgentId, setCopyingAgentId] = useState<string | null>(null);
  const [agentCopyError, setAgentCopyError] = useState<ApiClientError | null>(null);
  const { announce } = useStatusAnnouncer();
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
  const displayedGroups = data === null ? [] : displayGroups(data.groups);

  const addNativeAgent = async (agent: NativeAgentEntry) => {
    if (remoteOnly) {
      onSelectNativeAgent?.(agent);
      announce(`Selected ${agent.name} as the chain's native agent.`);
      return;
    }
    setCopyingAgentId(agent.id);
    setAgentCopyError(null);
    try {
      const copied = await (api ?? catalogApi).copyAgentToProject(projectId, agent.id, {
        harness,
      });
      announce(`Installed ${agent.name} for ${HARNESS_LABELS[harness]} at ${copied.destinationPath}.`);
      onAddNativeAgent?.(agent, copied);
      refresh();
    } catch (error) {
      const apiError = toApiClientError(error, 'The native agent could not be installed.');
      setAgentCopyError(apiError);
      announce(`Native agent installation failed: ${apiError.message}`);
    } finally {
      setCopyingAgentId(null);
    }
  };

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
          <div className="catalog__title-row">
          <h2 className="section-title catalog__title" id={titleId}>
            Skill catalog
          </h2>
          <HelpPopover topic="skills" />
          </div>
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
          {data.total === 1 ? '' : 's'} in {String(displayedGroups.length)} source
          {displayedGroups.length === 1 ? '' : 's'} · expand to search and inspect
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
            {data.total === 1 ? '' : 's'} in {String(displayedGroups.length)} source
            {displayedGroups.length === 1 ? '' : 's'} · scanned in {String(data.elapsedMs)} ms
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

          {data.agents.length > 0 ? (
            <section className="catalog-group" aria-labelledby={`${baseId}-agents-title`}>
              <h3 className="catalog-group__header" id={`${baseId}-agents-title`}>
                <span className="catalog-group__label">Remote native agents</span>
                <span className="catalog-group__count">
                  {String(data.agents.length)} agent{data.agents.length === 1 ? '' : 's'}
                </span>
              </h3>
              <ul className="catalog-group__list">
                {data.agents.map((agent) => (
                  <li className="skill-row" key={agent.id} data-testid="native-agent-row">
                    <div className="skill-row__toggle">
                      <span className="skill-row__name">{agent.name}</span>
                      <span className="status-tag">
                        {HARNESS_LABELS[agent.harness]} · {agent.status}
                      </span>
                      <span className="skill-row__description">
                        {agent.description || 'No description in native agent metadata.'}
                      </span>
                      <span className="skill-row__path"><code>{agent.repositoryPath}</code></span>
                      {agent.statusReason === null ? null : (
                        <span className="status-tag status-tag--warning">{agent.statusReason}</span>
                      )}
                      {remoteOnly ? (
                        onSelectNativeAgent !== undefined && agent.status === 'available' ? (
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            onClick={() => addNativeAgent(agent)}
                            data-testid={`select-agent-${agent.id}`}
                          >
                            Select native agent
                          </button>
                        ) : null
                      ) : context === 'project' ? (
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          disabled={agent.status !== 'available' || copyingAgentId !== null}
                          onClick={() => void addNativeAgent(agent)}
                        >
                          {copyingAgentId === agent.id ? 'Installing…' : 'Install native agent'}
                        </button>
                      ) : onAddNativeAgent !== undefined && agent.status === 'available' ? (
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          disabled={copyingAgentId !== null}
                          onClick={() => void addNativeAgent(agent)}
                        >
                          {copyingAgentId === agent.id ? 'Adding…' : 'Add agent to chain'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {agentCopyError === null ? null : (
                <p className="state-note">
                  Native agent installation failed: {agentCopyError.message}
                  {agentCopyError.code === undefined ? '' : ` (${agentCopyError.code})`}
                </p>
              )}
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

          {displayedGroups.map((group, index) => {
            const groupTitleId = `${baseId}-group-${index}`;
            const groupListId = `${baseId}-group-list-${index}`;
            const groupCollapsed =
              group.source === 'loom-extra'
                ? !expandedExtraGroups.has(group.key)
                : collapsedGroups.has(group.key);
            const groupLabel =
              group.label ??
              (group.sourceDirectory === undefined
                ? `${SOURCE_LABELS[group.source]} skills`
                : `${SOURCE_LABELS[group.source]} skills from ${group.sourceDirectory}`);
            return (
              <section
                className="catalog-group"
                key={group.key}
                aria-labelledby={groupTitleId}
                data-testid="catalog-group"
                data-source={group.source}
                {...(group.sourceDirectory === undefined
                  ? {}
                  : { 'data-source-directory': group.sourceDirectory })}
              >
                <h3 className="catalog-group__header" id={groupTitleId}>
                  <SkillSourceBadge source={group.source} />
                  <span className="catalog-group__label">
                    {groupLabel}
                  </span>
                  <span className="catalog-group__count">
                    {String(group.entries.length)} skill{group.entries.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    className="catalog-group__toggle"
                    aria-label={`${groupCollapsed ? 'Expand' : 'Collapse'} ${groupLabel}`}
                    aria-expanded={!groupCollapsed}
                    aria-controls={groupListId}
                    onClick={() => {
                      if (group.source === 'loom-extra') {
                        setExpandedExtraGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        });
                      } else {
                        setCollapsedGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        });
                      }
                    }}
                    data-testid={`catalog-group-toggle-${group.source}-${String(index)}`}
                  >
                    <span aria-hidden="true">{groupCollapsed ? '▸' : '▾'}</span>
                    {groupCollapsed ? 'Expand' : 'Collapse'}
                  </button>
                </h3>
                <ul
                  className="catalog-group__list"
                  id={groupListId}
                  hidden={groupCollapsed}
                >
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
                              : skill.source === 'remote' &&
                                  (skill.sourceId === undefined ||
                                    skill.revision === undefined ||
                                    skill.repositoryPath === undefined)
                                ? {
                                    addDisabledReason:
                                      'This remote snapshot has no complete identity. Refresh the catalog before adding it.',
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

interface DisplayGroup {
  key: string;
  source: SkillSource;
  sourceDirectory?: string;
  label?: string;
  entries: SkillEntry[];
}

function displayGroups(
  groups: Array<{ source: SkillSource; entries: SkillEntry[] }>,
): DisplayGroup[] {
  const result: DisplayGroup[] = [];
  for (const group of groups) {
    if (group.source === 'remote') {
      const bySnapshot = new Map<string, SkillEntry[]>();
      for (const entry of group.entries) {
        const key = `${entry.sourceId ?? ''}:${entry.revision ?? ''}`;
        const entries = bySnapshot.get(key) ?? [];
        entries.push(entry);
        bySnapshot.set(key, entries);
      }
      for (const [snapshotId, entries] of [...bySnapshot].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const first = entries[0];
        result.push({
          key: `remote:${snapshotId}`,
          source: 'remote',
          label: `Remote skills from ${first?.repository ?? first?.sourceId ?? 'repository'} at ${first?.revision?.slice(0, 12) ?? 'unknown commit'}`,
          entries,
        });
      }
      continue;
    }

    if (group.source !== 'loom-extra') {
      result.push({
        key: group.source,
        source: group.source,
        entries: group.entries,
      });
      continue;
    }

    const directories = new Map<string, SkillEntry[]>();
    for (const entry of group.entries) {
      const directory = entry.sourceDirectory ?? '';
      const entries = directories.get(directory) ?? [];
      entries.push(entry);
      directories.set(directory, entries);
    }
    for (const [sourceDirectory, entries] of [...directories].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      result.push({
        key: `loom-extra:${sourceDirectory}`,
        source: 'loom-extra',
        ...(sourceDirectory === '' ? {} : { sourceDirectory }),
        entries,
      });
    }
  }
  return result;
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
