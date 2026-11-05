import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError, isAbortError } from '../api/client';
import {
  chainBuilderPath,
  chainsApi,
  type ChainHarness,
  type ChainsApi,
} from '../api/chains';
import {
  scenarioCatalogApi,
  type ScenarioCatalogApi,
} from '../api/presets';
import { InlineError } from '../components/InlineError';
import { useStatusAnnouncer } from '../components/StatusRegion';
import { CHAIN_HARNESS_LABELS } from '../hooks/useChains';
import { useRecentProjects } from '../hooks/useRecentProjects';
import { Link, useRouter } from '../router';
import {
  SCENARIO_AUDIENCES,
  type Scenario,
  type ScenarioAudience,
  type ScenarioCatalog,
  type ScenarioSkillSource,
  type ScenarioVariant,
} from '../../shared/presets';
import { toApiClientError } from '../api/projects';

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiClientError }
  | { status: 'ready'; catalog: ScenarioCatalog };

const AUDIENCE_LABELS: Record<ScenarioAudience, string> = {
  business: 'Business user',
  student: 'Student',
  'app-developer': 'App developer',
  'game-developer': 'Game developer',
};

const AUDIENCE_FILTERS: Array<{ value: ScenarioAudience | 'all'; label: string }> = [
  { value: 'all', label: 'All scenarios' },
  ...SCENARIO_AUDIENCES.map((value) => ({
    value,
    label: AUDIENCE_LABELS[value],
  })),
];

export interface ScenarioCatalogPageProps {
  api?: ScenarioCatalogApi;
  chains?: ChainsApi;
}

function uniqueStepSkills(variant: ScenarioVariant): string[] {
  return [...new Set(
    variant.steps.flatMap((step) =>
      step.kind === 'instruction' ? [] : [step.skillName],
    ),
  )];
}

function scenarioMatches(
  scenario: Scenario,
  sources: ReadonlyMap<string, ScenarioSkillSource>,
  audience: ScenarioAudience | 'all',
  query: string,
): boolean {
  if (audience !== 'all' && scenario.audience !== audience) {
    return false;
  }
  const search = query.trim().toLocaleLowerCase();
  if (search === '') {
    return true;
  }
  const terms = [
    scenario.name,
    scenario.summary,
    AUDIENCE_LABELS[scenario.audience],
    ...scenario.variants.flatMap((variant) => [
      variant.name,
      variant.description,
      ...variant.notes,
      ...variant.steps.flatMap((step) => [
        step.label ?? '',
        step.instruction,
        ...(step.kind === 'instruction' ? [] : [step.skillName]),
      ]),
      ...uniqueStepSkills(variant).flatMap((name) => {
        const source = sources.get(name);
        return source === undefined ? [name] : [name, source.repository];
      }),
    ]),
  ];
  return terms.some((term) => term.toLocaleLowerCase().includes(search));
}

function ScenarioCard({
  scenario,
  skillSources,
  projectSelected,
  projectId,
  harness,
  copying,
  addingSkill,
  addedSkills,
  onCopy,
  onAddSkill,
}: {
  scenario: Scenario;
  skillSources: ReadonlyMap<string, ScenarioSkillSource>;
  projectSelected: boolean;
  projectId: string;
  harness: ChainHarness;
  copying: boolean;
  addingSkill: string | null;
  addedSkills: ReadonlySet<string>;
  onCopy: (scenario: Scenario, variant: ScenarioVariant) => void;
  onAddSkill: (name: string) => void;
}) {
  const [variantId, setVariantId] = useState(scenario.variants[0]?.id ?? '');
  const selectedVariant =
    scenario.variants.find((variant) => variant.id === variantId) ??
    scenario.variants[0]!;
  const variantHelpId = `${scenario.id}-variant-help`;

  return (
    <article
      className="scenario-card"
      data-testid="scenario-card"
      data-scenario-id={scenario.id}
      aria-labelledby={`${scenario.id}-title`}
    >
      <header className="scenario-card__header">
        <div>
          <p className="scenario-card__audience">{AUDIENCE_LABELS[scenario.audience]}</p>
          <h2 className="scenario-card__title" id={`${scenario.id}-title`}>
            {scenario.name}
          </h2>
        </div>
        <span className="scenario-card__count">
          {String(scenario.variants.length)} example
          {scenario.variants.length === 1 ? '' : 's'}
        </span>
      </header>

      <p className="scenario-card__summary">{scenario.summary}</p>

      <div className="field">
        <label className="field__label" htmlFor={`${scenario.id}-variant`}>
          Choose an example variant
        </label>
        <select
          className="input"
          id={`${scenario.id}-variant`}
          value={selectedVariant.id}
          onChange={(event) => setVariantId(event.target.value)}
          aria-describedby={variantHelpId}
          data-testid="scenario-variant"
        >
          {scenario.variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.name}
            </option>
          ))}
        </select>
        <p className="field__hint" id={variantHelpId}>
          {selectedVariant.description}
        </p>
      </div>

      <details className="scenario-card__details">
        <summary>View recipe, requirements, and sources</summary>
        <div className="scenario-card__content">
          <section aria-labelledby={`${scenario.id}-steps-title`}>
            <h3 id={`${scenario.id}-steps-title`}>Example step order</h3>
            <ol className="scenario-step-list">
              {selectedVariant.steps.map((step) => (
                <li key={step.id} className="scenario-step">
                  <strong>{step.label ?? step.skillName}</strong>
                  {step.kind === 'instruction' ? (
                    <span className="scenario-step__kind"> Instruction step</span>
                  ) : (
                    <span className="scenario-step__kind">
                      {' '}
                      · Skill: <code>{step.skillName}</code>
                    </span>
                  )}
                  <p>{step.instruction}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby={`${scenario.id}-inputs-title`}>
            <h3 id={`${scenario.id}-inputs-title`}>Inputs and example outputs</h3>
            <p>
              <strong>Inputs:</strong>{' '}
              {selectedVariant.inputs.map((input) => (
                <span key={input.name}>
                  <code>{`{{${input.name}}}`}</code> ({input.label})
                  {input.required ? ' · required' : ''}
                </span>
              ))}
            </p>
            <ul className="scenario-outputs">
              {selectedVariant.outputs.map((output) => (
                <li key={output}>{output}</li>
              ))}
            </ul>
          </section>

          {selectedVariant.notes.length > 0 ? (
            <section aria-labelledby={`${scenario.id}-notes-title`}>
              <h3 id={`${scenario.id}-notes-title`}>Limits and prerequisites</h3>
              <ul>
                {selectedVariant.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby={`${scenario.id}-skills-title`}>
            <h3 id={`${scenario.id}-skills-title`}>Third-party skill sources</h3>
            <p className="field__hint">
              Each skill below is independently authored outside Skill Loom. Review the
              linked upstream source, pinned revision, license, local prerequisites,
              and trustworthiness before use.
            </p>
            {uniqueStepSkills(selectedVariant).length === 0 ? (
              <p>This recipe uses standalone instruction steps and does not require skills.</p>
            ) : (
              <ul className="scenario-skill-list">
                {uniqueStepSkills(selectedVariant).map((name) => {
                  const source = skillSources.get(name);
                  if (source === undefined) {
                    return <li key={name}>{name} — upstream attribution is unavailable.</li>;
                  }
                  return (
                    <li key={name} data-testid="scenario-skill-source">
                      <strong><code>{source.name}</code></strong>
                      {' '}by{' '}
                      <a href={source.repositoryUrl} target="_blank" rel="noreferrer noopener">
                        {source.repository}
                      </a>
                      {' '}· {source.license} · about {source.popularity} at research time
                      <p className="scenario-skill-list__note">
                        Bundled snapshot: <code>{source.revision}</code>
                      </p>
                      <div className="scenario-skill-list__links">
                        <a href={source.skillUrl} target="_blank" rel="noreferrer noopener">
                          skills.sh listing
                        </a>
                        {' · '}
                        <a href={source.skillFileUrl} target="_blank" rel="noreferrer noopener">
                          upstream SKILL.md
                        </a>
                      </div>
                      <p className="scenario-skill-list__note">
                        {source.prerequisites.join(' ')}
                      </p>
                      <p className="scenario-skill-list__install">
                        Alternative upstream install command (not run by Skill Loom):{' '}
                        <code>{source.installationCommand}</code>
                      </p>
                      {source.bundled ? (
                        <div className="scenario-skill-list__action">
                          <button
                            type="button"
                            className="button button--secondary"
                            disabled={
                              !projectSelected ||
                              addingSkill !== null ||
                              addedSkills.has(`${projectId}:${harness}:${source.name}`)
                            }
                            onClick={() => onAddSkill(source.name)}
                            data-testid="scenario-add-skill"
                            data-skill-name={source.name}
                          >
                            {addedSkills.has(`${projectId}:${harness}:${source.name}`)
                              ? 'Added to project'
                              : addingSkill === source.name
                                ? 'Adding skill…'
                                : 'Add bundled skill to project'}
                          </button>
                          <p className="field__hint">
                            Copies this pinned package into the selected project for the
                            chosen harness. It does not run package scripts or contact the
                            upstream source.
                          </p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </details>

      <div className="scenario-card__actions">
        <button
          type="button"
          className="button"
          disabled={!projectSelected || copying}
          onClick={() => onCopy(scenario, selectedVariant)}
          data-testid="scenario-copy"
        >
          {copying ? 'Copying…' : 'Copy this example to the builder'}
        </button>
      </div>
    </article>
  );
}

export function ScenarioCatalogPage({
  api = scenarioCatalogApi,
  chains = chainsApi,
}: ScenarioCatalogPageProps) {
  const { navigate } = useRouter();
  const { announce } = useStatusAnnouncer();
  const { state: recentState } = useRecentProjects();
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' });
  const [audience, setAudience] = useState<ScenarioAudience | 'all'>('all');
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [harness, setHarness] = useState<ChainHarness>('opencode');
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<ApiClientError | null>(null);
  const [addingSkill, setAddingSkill] = useState<string | null>(null);
  const [addedSkills, setAddedSkills] = useState<Set<string>>(new Set());
  const [skillCopyError, setSkillCopyError] = useState<ApiClientError | null>(null);
  const [skillCopyNotice, setSkillCopyNotice] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const projects = recentState.status === 'ready' ? recentState.projects : [];

  const loadCatalog = useCallback(async () => {
    const requestId = generation.current + 1;
    generation.current = requestId;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setCatalogState({ status: 'loading' });

    try {
      const catalog = await api.list({ signal: controller.signal });
      if (generation.current === requestId) {
        setCatalogState({ status: 'ready', catalog });
      }
    } catch (error) {
      if (generation.current !== requestId || isAbortError(error)) {
        return;
      }
      setCatalogState({
        status: 'error',
        error: toApiClientError(error, 'The scenario catalog could not be loaded.'),
      });
    }
  }, [api]);

  useEffect(() => {
    void loadCatalog();
    return () => {
      generation.current += 1;
      abort.current?.abort();
    };
  }, [loadCatalog]);

  useEffect(() => {
    if (projects.some((project) => project.id === projectId)) {
      return;
    }
    setProjectId(projects[0]?.id ?? '');
  }, [projectId, projects]);

  const sourceMap = useMemo(
    () => new Map(
      (catalogState.status === 'ready' ? catalogState.catalog.skills : [])
        .map((source) => [source.name, source]),
    ),
    [catalogState],
  );

  const filteredScenarios = useMemo(
    () =>
      catalogState.status === 'ready'
        ? catalogState.catalog.scenarios.filter((scenario) =>
            scenarioMatches(scenario, sourceMap, audience, query),
          )
        : [],
    [audience, catalogState, query, sourceMap],
  );

  const copyScenario = async (scenario: Scenario, variant: ScenarioVariant) => {
    if (projectId === '') {
      return;
    }
    setCopyingId(scenario.id);
    setCopyError(null);
    try {
      const chain = await chains.createChain(projectId, {
        name: `${scenario.name} - ${variant.name}`,
        harness,
        sessionMode: 'shared',
        steps: variant.steps,
        inputs: variant.inputs.map((input) => {
          if (input.name !== 'project_path') {
            return input;
          }
          const projectPath = projects.find((project) => project.id === projectId)?.canonicalPath;
          return projectPath === undefined
            ? input
            : { ...input, defaultValue: projectPath };
        }),
        automaticPermissionOptIn: false,
      });
      announce(
        `Copied the ${variant.name} example as ${chain.name}. Review and adapt the chain before running it.`,
      );
      navigate(chainBuilderPath(projectId, chain.id));
    } catch (error) {
      const apiError = toApiClientError(error, 'The scenario example could not be copied.');
      setCopyError(apiError);
      announce(`The scenario example could not be copied: ${apiError.message}`, 'assertive');
      setCopyingId(null);
    }
  };

  const addSkillToProject = async (skillName: string) => {
    if (projectId === '') {
      return;
    }
    setAddingSkill(skillName);
    setSkillCopyError(null);
    setSkillCopyNotice(null);
    try {
      const result = await api.copySkill(projectId, skillName, harness);
      setAddedSkills((current) => new Set(current).add(
        `${projectId}:${harness}:${result.name}`,
      ));
      const notice = `Added ${result.name} to the selected project's ${harness} skills.`;
      setSkillCopyNotice(notice);
      announce(notice);
    } catch (error) {
      const apiError = toApiClientError(error, 'The bundled skill could not be added.');
      setSkillCopyError(apiError);
      announce(`The bundled skill could not be added: ${apiError.message}`, 'assertive');
    } finally {
      setAddingSkill(null);
    }
  };

  const projectReady = projectId !== '' && projects.some((project) => project.id === projectId);

  return (
    <section aria-labelledby="scenario-catalog-title" data-testid="scenario-catalog">
      <header className="projects-header">
        <h1
          className="panel__title"
          id="scenario-catalog-title"
          ref={heading}
          tabIndex={-1}
        >
          Scenario catalog
        </h1>
        <p className="lede">
          Starter chain examples for business users, students, app developers, and game
          developers. Explore the steps and adapt them to your work; there are many
          workflows beyond this collection.
        </p>
      </header>

      {catalogState.status === 'ready' ? (
        <aside className="placeholder scenario-disclaimer" data-testid="scenario-disclaimer">
          <span className="placeholder__badge">Examples, not prescriptions</span>
          <p>{catalogState.catalog.message}</p>
          <p>
            Skill Loom authors these example sequences; linked skills are independent
            third-party work, bundled as pinned snapshots, not integrations or
            endorsements. Source, revision, license, prerequisites, and an alternative
            upstream install command are shown for each required skill. Review them before
            use. Browsing or copying an example never installs a skill or contacts its
            publisher.
          </p>
          <p>
            Add an individual bundled skill only with its explicit project action. Skill
            Loom copies the package and attribution notice into the selected project's
            harness-specific skill directory; package scripts remain unexecuted.
          </p>
          <p>
            Skills are model-invoked context, not guaranteed actions. After copying,
            tailor the prompts in the builder and run preflight: an unavailable required
            skill blocks the run. The user guide links to the scenario guide for more
            information about sources, variants, and adapting the examples.
          </p>
        </aside>
      ) : null}

      <section className="panel scenario-controls" aria-labelledby="scenario-controls-title">
        <h2 className="section-title" id="scenario-controls-title">Explore examples</h2>
        <div className="scenario-controls__grid">
          <div className="field">
            <label className="field__label" htmlFor="scenario-audience">Audience</label>
            <select
              className="input"
              id="scenario-audience"
              value={audience}
              onChange={(event) => {
                const selected = AUDIENCE_FILTERS.find(
                  (filter) => filter.value === event.target.value,
                );
                if (selected !== undefined) {
                  setAudience(selected.value);
                }
              }}
              data-testid="scenario-audience"
            >
              {AUDIENCE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="scenario-search">Search examples</label>
            <input
              className="input"
              id="scenario-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try a skill, framework, or task"
              data-testid="scenario-search"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="scenario-project">Copy into project</label>
            {recentState.status === 'ready' && projects.length > 0 ? (
              <select
                className="input"
                id="scenario-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                data-testid="scenario-project"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.displayName}</option>
                ))}
              </select>
            ) : (
              <p className="field__hint" id="scenario-project">
                {recentState.status === 'loading'
                  ? 'Loading recent projects…'
                  : recentState.status === 'error'
                    ? 'Recent projects could not be loaded. Reload to try again.'
                    : 'Open a project before copying an example.'}
                {recentState.status === 'ready' && projects.length === 0 ? (
                  <> <Link to="/projects">Open or create a project</Link>.</>
                ) : null}
              </p>
            )}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="scenario-harness">Harness</label>
            <select
              className="input"
              id="scenario-harness"
              value={harness}
              onChange={(event) => {
                const selected = event.target.value;
                if (selected === 'opencode' || selected === 'copilot') {
                  setHarness(selected);
                }
              }}
              data-testid="scenario-harness"
            >
              <option value="opencode">{CHAIN_HARNESS_LABELS.opencode}</option>
              <option value="copilot">{CHAIN_HARNESS_LABELS.copilot}</option>
            </select>
            <p className="field__hint">
              Every step in the copied chain uses this harness. Adding an individual
              bundled skill also targets this harness; requirements are checked by
              preflight.
            </p>
          </div>
        </div>
      </section>

      {copyError !== null ? (
        <InlineError
          title="Example could not be copied"
          message={copyError.message}
          code={copyError.code}
          httpStatus={copyError.status}
        />
      ) : null}

      {skillCopyError !== null ? (
        <InlineError
          title="Bundled skill could not be added"
          message={skillCopyError.message}
          code={skillCopyError.code}
          httpStatus={skillCopyError.status}
        />
      ) : null}

      {skillCopyNotice !== null ? (
        <p className="state-note" role="status" data-testid="scenario-skill-copy-success">
          {skillCopyNotice}
        </p>
      ) : null}

      {catalogState.status === 'loading' ? (
        <p className="state-note" data-testid="scenario-loading">
          <span aria-hidden="true">◌</span> Loading scenario examples…
        </p>
      ) : null}

      {catalogState.status === 'error' ? (
        <InlineError
          title="Scenario catalog could not be loaded"
          message={catalogState.error.message}
          code={catalogState.error.code}
          httpStatus={catalogState.error.status}
          onRetry={() => void loadCatalog()}
        />
      ) : null}

      {catalogState.status === 'ready' && filteredScenarios.length === 0 ? (
        <div className="empty-state" data-testid="scenario-empty">
          <p>No examples match these filters.</p>
          <p>Try another audience or search term.</p>
        </div>
      ) : null}

      {catalogState.status === 'ready' && filteredScenarios.length > 0 ? (
        <div className="scenario-list" data-testid="scenario-list">
          <p className="scenario-result-count" aria-live="polite">
            {String(filteredScenarios.length)} example
            {filteredScenarios.length === 1 ? '' : 's'}
          </p>
          {filteredScenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              skillSources={sourceMap}
              projectSelected={projectReady}
              projectId={projectId}
              harness={harness}
              copying={copyingId === scenario.id}
              addingSkill={addingSkill}
              addedSkills={addedSkills}
              onCopy={(candidate, variant) => void copyScenario(candidate, variant)}
              onAddSkill={(name) => void addSkillToProject(name)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
