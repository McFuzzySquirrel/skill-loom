import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { InlineError } from '../components/InlineError';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { Link, useRouter } from '../router';
import {
  catalogApi,
  DRAFT_CATALOG_ID,
  type CatalogResponse,
  type SkillDetail,
} from '../api/catalog';
import { projectsApi, type RecentProject } from '../api/projects';
import {
  testWorkspacesApi,
  type DiscoveryProposalPreview,
  type TestWorkspace,
  type TestWorkspacesApi,
} from '../api/testWorkspaces';
import { toApiClientError } from '../api/projects';
import type { ApiClientError } from '../api/client';

export interface TestWorkspacesPageProps {
  api?: TestWorkspacesApi;
}

export function TestWorkspacesPage({
  api = testWorkspacesApi,
}: TestWorkspacesPageProps) {
  const { announce } = useStatusAnnouncer();
  const { navigate } = useRouter();
  const [workspaces, setWorkspaces] = useState<TestWorkspace[]>([]);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [harness, setHarness] = useState<'opencode' | 'copilot'>('opencode');
  const [sourceProjectId, setSourceProjectId] = useState('');
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<ApiClientError | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillDetails, setSkillDetails] = useState<Record<string, SkillDetail>>({});
  const [detailBusyId, setDetailBusyId] = useState<string | null>(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<ApiClientError | null>(null);
  const [proposalWorkspaceId, setProposalWorkspaceId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DiscoveryProposalPreview | null>(null);
  const [proposalName, setProposalName] = useState('');
  const [proposalError, setProposalError] = useState<ApiClientError | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void projectsApi.listRecent({ signal: controller.signal }).then(setProjects).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const apiError = toApiClientError(reason, 'Registered projects could not be loaded.');
      setDiscoveryError(apiError);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!discoveryOpen) return;
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalog(null);
    setSelectedSkillIds([]);
    setSkillDetails({});
    announce(`Loading ${harness} skill catalogs for scenario discovery.`);
    void catalogApi.getCatalog(DRAFT_CATALOG_ID, {
      harness,
      ...(sourceProjectId === '' ? {} : { sourceProjectId }),
      signal: controller.signal,
    }).then((result) => {
      if (!controller.signal.aborted) {
        setCatalog(result);
        announce(`Loaded ${String(result.total)} candidate skills from ${String(result.groups.length)} catalog sources.`);
      }
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const apiError = toApiClientError(reason, 'The discovery catalog could not be loaded.');
      setCatalogError(apiError);
      announce(`The discovery catalog could not be loaded: ${apiError.message}`, 'assertive');
    }).finally(() => {
      if (!controller.signal.aborted) setCatalogLoading(false);
    });
    return () => controller.abort();
  }, [announce, discoveryOpen, harness, sourceProjectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspaces(await api.list());
    } catch (reason) {
      const apiError = toApiClientError(reason, 'Test workspaces could not be loaded.');
      setError(apiError);
      announce(`Test workspaces could not be loaded: ${apiError.message}`, 'assertive');
    } finally {
      setLoading(false);
    }
  }, [announce, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(async (workspace: TestWorkspace) => {
    setBusyId(workspace.id);
    setError(null);
    try {
      await api.remove(workspace.id);
      setWorkspaces((current) => current.filter((entry) => entry.id !== workspace.id));
      setPendingDeleteId(null);
      announce(
        workspace.purpose === 'discovery'
          ? 'Removed the disposable scenario-discovery workspace.'
          : `Removed the disposable test workspace for ${workspace.sourceDraftId === undefined
            ? `chain ${workspace.sourceChainId ?? 'unknown'}`
            : `draft ${workspace.sourceDraftId}`}.`,
      );
    } catch (reason) {
      const apiError = toApiClientError(reason, 'The test workspace could not be removed.');
      setError(apiError);
      announce(`Test workspace could not be removed: ${apiError.message}`, 'assertive');
    } finally {
      setBusyId(null);
    }
  }, [announce, api]);

  const inspectSkill = useCallback(async (skillId: string) => {
    setDetailBusyId(skillId);
    setCatalogError(null);
    try {
      const detail = await catalogApi.getSkillDetail(DRAFT_CATALOG_ID, skillId, {
        harness,
        ...(sourceProjectId === '' ? {} : { sourceProjectId }),
      });
      setSkillDetails((current) => ({ ...current, [skillId]: detail }));
      announce(`Reviewed the SKILL.md instructions for ${detail.name}.`);
    } catch (reason) {
      const apiError = toApiClientError(reason, 'The skill instructions could not be loaded.');
      setCatalogError(apiError);
      announce(`Skill instructions could not be loaded: ${apiError.message}`, 'assertive');
    } finally {
      setDetailBusyId(null);
    }
  }, [announce, harness, sourceProjectId]);

  const startDiscovery = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDiscoveryBusy(true);
    setDiscoveryError(null);
    try {
      const workspace = await api.createDiscovery({
        goal: goal.trim(),
        harness,
        skillIds: selectedSkillIds,
        ...(sourceProjectId === '' ? {} : { sourceProjectId }),
      });
      announce('Created a disposable scenario-discovery workspace. Opening its review chain.');
      navigate(
        `/projects/${encodeURIComponent(workspace.projectId)}/chains/${encodeURIComponent(workspace.chainId)}`,
      );
    } catch (reason) {
      const apiError = toApiClientError(reason, 'The scenario-discovery workspace could not be created.');
      setDiscoveryError(apiError);
      announce(`Scenario-discovery workspace could not be created: ${apiError.message}`, 'assertive');
    } finally {
      setDiscoveryBusy(false);
    }
  }, [announce, api, goal, harness, navigate, selectedSkillIds, sourceProjectId]);

  const reviewProposal = useCallback(async (workspace: TestWorkspace) => {
    setProposalWorkspaceId(workspace.id);
    setProposal(null);
    setProposalName('');
    setProposalError(null);
    setProposalBusy(true);
    try {
      const result = await api.getProposal(workspace.id);
      setProposal(result);
      setProposalName(result?.name ?? '');
      if (result === null) announce('No proposal bundle has been created in this workspace yet.');
    } catch (reason) {
      const apiError = toApiClientError(reason, 'The proposal could not be loaded.');
      setProposalError(apiError);
      announce(`Scenario proposal could not be loaded: ${apiError.message}`, 'assertive');
    } finally {
      setProposalBusy(false);
    }
  }, [announce, api]);

  const acceptProposal = useCallback(async () => {
    if (proposalWorkspaceId === null || proposal === null) return;
    setProposalBusy(true);
    setProposalError(null);
    try {
      const draft = await api.acceptProposal(
        proposalWorkspaceId,
        proposalName.trim() === '' ? undefined : proposalName.trim(),
      );
      announce(`Accepted the proposal as the global draft ${draft.name}.`);
      navigate(`/drafts/${encodeURIComponent(draft.id)}`);
    } catch (reason) {
      const apiError = toApiClientError(reason, 'The proposal could not be accepted.');
      setProposalError(apiError);
      announce(`Proposal could not be accepted: ${apiError.message}`, 'assertive');
    } finally {
      setProposalBusy(false);
    }
  }, [announce, api, navigate, proposal, proposalName, proposalWorkspaceId]);

  const selectedSkillsReviewed =
    selectedSkillIds.length > 0 &&
    selectedSkillIds.every((id) => skillDetails[id] !== undefined);

  const closeDiscovery = useCallback(() => {
    setDiscoveryOpen(false);
    setDiscoveryError(null);
  }, []);

  return (
    <section className="panel" aria-labelledby="test-workspaces-title" data-testid="test-workspaces-page">
      <header className="panel__header">
        <div>
          <h1 className="panel__title" id="test-workspaces-title">Disposable test workspaces</h1>
          <p className="lede">
            Test and discovery runs use separate managed project directories. They are retained
            for inspection until you remove them; a separate working directory is not an
            operating-system security sandbox.
          </p>
        </div>
        <Link className="button button--secondary" to="/chains">Chain library</Link>
      </header>

      <section className="panel" aria-labelledby="scenario-discovery-title">
        <div className="panel__header">
          <div>
            <h2 className="section-title" id="scenario-discovery-title">Discover workflows from a goal</h2>
            <p className="field__hint">
              Review skill instructions, then stage selected packages into an isolated temporary
              project. The discovery agent proposes workflows but never runs candidate skills.
            </p>
          </div>
          <button
            type="button"
            className="button button--secondary"
            aria-expanded={discoveryOpen}
            onClick={() => setDiscoveryOpen((open) => !open)}
          >
            {discoveryOpen ? 'Close discovery setup' : 'Start scenario discovery'}
          </button>
        </div>

        {discoveryOpen ? (
          <form onSubmit={(event) => void startDiscovery(event)} data-testid="scenario-discovery-form">
            <div className="field">
              <label className="field__label" htmlFor="discovery-goal">Goal or desired outcome</label>
              <textarea
                id="discovery-goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                maxLength={1_000}
                required
                aria-describedby="discovery-goal-hint"
              />
              <p className="field__hint" id="discovery-goal-hint">
                Use a goal, not secrets or credentials. The text is retained with this local workspace.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="discovery-harness">Harness</label>
              <select
                id="discovery-harness"
                value={harness}
                onChange={(event) => setHarness(event.target.value as 'opencode' | 'copilot')}
              >
                <option value="opencode">OpenCode</option>
                <option value="copilot">Copilot CLI</option>
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="discovery-source-project">
                Also include packages from a registered project (optional)
              </label>
              <select
                id="discovery-source-project"
                value={sourceProjectId}
                onChange={(event) => setSourceProjectId(event.target.value)}
              >
                <option value="">Global catalogs only</option>
                {projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.displayName} — {project.canonicalPath}
                  </option>
                ))}
              </select>
            </div>

            {catalogLoading ? <p className="state-note">Loading selected catalogs…</p> : null}
            {catalogError !== null ? (
              <InlineError
                title="Discovery catalog could not be loaded"
                message={catalogError.message}
                code={catalogError.code}
                httpStatus={catalogError.status}
              />
            ) : null}
            {!catalogLoading && catalog !== null ? (
              <fieldset className="field" aria-describedby="discovery-skill-hint">
                <legend className="field__label">Review and select candidate skills</legend>
                <p className="field__hint" id="discovery-skill-hint">
                  Open each skill's instructions before selecting it. Remote packages are the
                  retained local snapshots; selected packages are copied into this workspace.
                  Choose up to 20 packages.
                </p>
                {catalog.groups.length === 0 ? (
                  <p className="state-note">
                    No available skill packages were found. Add or refresh a source from{' '}
                    <Link to="/sources">Remote skill repositories</Link>, or open a project with local skills.
                  </p>
                ) : null}
                {catalog.groups.map((group) => (
                  <fieldset className="field" key={group.source}>
                    <legend className="field__label">
                      {group.source} ({String(group.count)})
                    </legend>
                    {group.entries.map((entry) => {
                      const detail = skillDetails[entry.id];
                      const selected = selectedSkillIds.includes(entry.id);
                      return (
                        <div className="skill-entry" key={entry.id}>
                          <label className="field__label">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={
                                !entry.enabled ||
                                detail === undefined ||
                                discoveryBusy ||
                                !selected && selectedSkillIds.length >= 20
                              }
                              onChange={(event) => setSelectedSkillIds((current) =>
                                event.target.checked
                                  ? [...current, entry.id]
                                  : current.filter((id) => id !== entry.id),
                              )}
                            />
                            {entry.name}
                            {!entry.enabled ? ' (disabled)' : ''}
                          </label>
                          {entry.description !== '' ? <p className="field__hint">{entry.description}</p> : null}
                          <p className="field__hint">
                            {entry.repository ?? entry.sourceDirectory ?? entry.source}
                            {entry.revision === undefined ? '' : ` · ${entry.revision}`}
                          </p>
                          {detail === undefined ? (
                            <button
                              type="button"
                              className="button button--secondary button--small"
                              onClick={() => void inspectSkill(entry.id)}
                              disabled={detailBusyId === entry.id || !entry.enabled}
                            >
                              {detailBusyId === entry.id ? 'Loading instructions…' : `Review ${entry.name} instructions`}
                            </button>
                          ) : (
                            <details open>
                              <summary>Reviewed instructions: {entry.name}</summary>
                              <pre className="skill-detail__content">{detail.content}</pre>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </fieldset>
                ))}
                <p className="field__hint">
                  {String(selectedSkillIds.length)} selected; every selected package must have its
                  SKILL.md reviewed before you can create the workspace.
                </p>
              </fieldset>
            ) : null}

            {discoveryError !== null ? (
              <InlineError
                title="Scenario setup failed"
                message={discoveryError.message}
                code={discoveryError.code}
                httpStatus={discoveryError.status}
              />
            ) : null}
            <div className="panel__actions">
              <button
                type="submit"
                className="button"
                disabled={
                  discoveryBusy ||
                  catalogLoading ||
                  goal.trim() === '' ||
                  !selectedSkillsReviewed
                }
              >
                {discoveryBusy ? 'Creating disposable workspace…' : 'Create discovery workspace'}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={closeDiscovery}
                disabled={discoveryBusy}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {error !== null ? (
        <InlineError
          title="Test workspace action failed"
          message={error.message}
          code={error.code}
          httpStatus={error.status}
          onRetry={() => void load()}
          retryLabel="Retry"
        />
      ) : null}

      {loading ? <p className="state-note">Loading test workspaces…</p> : null}
      {!loading && workspaces.length === 0 && error === null ? (
        <p className="state-note" data-testid="test-workspaces-empty">
          No retained test workspaces. Start a test from a saved chain or create a discovery workspace.
        </p>
      ) : null}

      {workspaces.length > 0 ? (
        <ul className="project-list" aria-label="Retained test workspaces">
          {workspaces.map((workspace) => (
            <li className="project-list__item" key={workspace.id}>
              <div>
                <h2 className="section-title">
                  {workspace.purpose === 'discovery' ? 'Scenario-discovery workspace' : 'Test workspace'}
                </h2>
                <p className="field__hint">
                  Created {new Date(workspace.createdAt).toLocaleString()}
                </p>
                <p><code>{workspace.path}</code></p>
                {workspace.purpose === 'discovery' ? (
                  <>
                    <p><strong>Goal:</strong> {workspace.discoveryGoal}</p>
                    <p className="field__hint">
                      Candidate packages: {workspace.discoverySkillNames?.join(', ') || 'none'}
                    </p>
                  </>
                ) : (
                  <p className="field__hint">
                    From {workspace.sourceDraftId === undefined ? 'chain' : 'draft'}{' '}
                    <code>{workspace.sourceDraftId ?? workspace.sourceChainId ?? 'unknown'}</code>
                  </p>
                )}
              </div>
              <div className="panel__actions">
                {workspace.purpose === 'discovery' ? (
                  <>
                    <Link
                      className="button button--secondary"
                      to={`/projects/${encodeURIComponent(workspace.projectId)}/chains/${encodeURIComponent(workspace.chainId)}`}
                    >
                      Open discovery chain
                    </Link>
                    <Link
                      className="button button--secondary"
                      to={`/projects/${encodeURIComponent(workspace.projectId)}/chains/${encodeURIComponent(workspace.chainId)}/run`}
                    >
                      Run discovery
                    </Link>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => void reviewProposal(workspace)}
                      disabled={proposalBusy}
                    >
                      Review proposal
                    </button>
                  </>
                ) : null}
                <Link
                  className="button button--secondary"
                  to={`/projects/${encodeURIComponent(workspace.projectId)}`}
                >
                  Inspect test project
                </Link>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() =>
                    setPendingDeleteId((current) =>
                      current === workspace.id ? null : workspace.id,
                    )
                  }
                  aria-expanded={pendingDeleteId === workspace.id}
                  disabled={busyId === workspace.id}
                >
                  Remove test workspace
                </button>
                {pendingDeleteId === workspace.id ? (
                  <div className="confirm-panel" role="group" aria-label="Confirm workspace removal">
                    <p>
                      Remove this test project and its run history? The original project and
                      reusable chain are not affected.
                    </p>
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => void remove(workspace)}
                      disabled={busyId === workspace.id}
                    >
                      {busyId === workspace.id ? 'Removing…' : 'Remove workspace'}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setPendingDeleteId(null)}
                      disabled={busyId === workspace.id}
                    >
                      Keep workspace
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {proposalWorkspaceId !== null ? (
        <section className="panel" aria-labelledby="proposal-review-title" data-testid="discovery-proposal-review">
          <div className="panel__header">
            <div>
              <h2 className="section-title" id="proposal-review-title">Review scenario proposal</h2>
              <p className="field__hint">
                Accepting creates an editable global draft with a frozen copy of these skill packages.
                Nothing is run by accepting.
              </p>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setProposalWorkspaceId(null);
                setProposal(null);
                setProposalError(null);
              }}
            >
              Close review
            </button>
          </div>
          {proposalBusy ? <p className="state-note">Loading proposal…</p> : null}
          {proposal === null && !proposalBusy && proposalError === null ? (
            <p className="state-note">No proposal bundle is available yet. Run the discovery chain and ask it to build the reviewed proposal.</p>
          ) : null}
          {proposalError !== null ? (
            <InlineError
              title="Proposal review failed"
              message={proposalError.message}
              code={proposalError.code}
              httpStatus={proposalError.status}
            />
          ) : null}
          {proposal !== null ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="proposal-name">Global draft name</label>
                <input
                  id="proposal-name"
                  value={proposalName}
                  onChange={(event) => setProposalName(event.target.value)}
                  maxLength={100}
                />
              </div>
              <p>{proposal.harness} · {proposal.sessionMode} mode</p>
              <h3 className="section-title">Proposed steps</h3>
              <ol>
                {proposal.steps.map((step) => (
                  <li key={step.id}>
                    <strong>{step.label ?? step.skillName ?? 'Instruction'}</strong>
                    <pre>{step.instruction}</pre>
                  </li>
                ))}
              </ol>
              <h3 className="section-title">Frozen package inventory</h3>
              {proposal.skills.length === 0 ? <p>This proposal has no skill packages.</p> : null}
              <ul>
                {proposal.skills.map((skill) => (
                  <li key={skill.name}>
                    <code>{skill.name}</code> — {skill.files} files, {skill.bytes} bytes
                  </li>
                ))}
              </ul>
              <div className="panel__actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void acceptProposal()}
                  disabled={proposalBusy || proposalName.trim() === ''}
                >
                  {proposalBusy ? 'Accepting proposal…' : 'Accept as editable global draft'}
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
