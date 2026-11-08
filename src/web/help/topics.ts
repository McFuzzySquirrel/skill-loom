export interface HelpTopic {
  title: string;
  summary: string;
  article: string;
  anchor: string;
}

export const HELP_TOPICS = {
  shell: {
    title: 'Using the workspace',
    summary: 'Use the sidebar and breadcrumbs to move between projects, chains, skills, and runs. Changing appearance affects this browser only.',
    article: 'user-guide',
    anchor: 'sign-in-and-first-use',
  },
  start: {
    title: 'Choose a workflow',
    summary: 'Start with your goal: discover reusable workflows, open a repository, or browse examples and saved work.',
    article: 'user-guide',
    anchor: 'main-workflows',
  },
  discovery: {
    title: 'Discover reusable workflows',
    summary: 'Select and review enabled skills from already refreshed remote snapshots. Discovery prepares a handoff for an existing compatible CLI session; it does not launch a model or execute skills.',
    article: 'user-guide',
    anchor: 'discover-candidate-skills-and-prepare-a-handoff',
  },
  sharedBundles: {
    title: 'Shared bundles',
    summary: 'Review and publish a locally selected bundle without a project, or review and download a library entry. Import remains a separate project-scoped action.',
    article: 'user-guide',
    anchor: 'import-a-shared-chain',
  },
  libraries: {
    title: 'Libraries and saved work',
    summary: 'Drafts, chain templates, shared bundles, and scenario examples have different purposes and remain separate.',
    article: 'user-guide',
    anchor: 'reuse-a-chain',
  },
  projects: {
    title: 'Projects',
    summary: 'Open a recent project or browse to a local folder. Removing a recent entry does not delete its files.',
    article: 'user-guide',
    anchor: 'register-and-open-a-project',
  },
  recentProjects: {
    title: 'Recent projects',
    summary: 'Open a listed project to return to its workspace. Removing a recent entry only changes the list; it does not delete the folder.',
    article: 'user-guide',
    anchor: 'register-and-open-a-project',
  },
  folderBrowser: {
    title: 'Browse folders',
    summary: 'Browse to a readable local folder, then open it as a project or create a new folder beneath the current location.',
    article: 'user-guide',
    anchor: 'register-and-open-a-project',
  },
  projectChains: {
    title: 'Project chains',
    summary: 'Chains belong to this project. Create or import one to edit it; saved chains can be run or exported as reviewable bundles.',
    article: 'user-guide',
    anchor: 'main-workflows',
  },
  projectSkills: {
    title: 'Project skills',
    summary: 'Choose a harness to inspect its available skills. Copying a skill adds a project-local package and does not run it.',
    article: 'user-guide',
    anchor: 'browse-the-skill-catalog',
  },
  library: {
    title: 'Chain library',
    summary: 'The library stores independent templates. Importing makes a project copy; later edits do not sync between copies.',
    article: 'user-guide',
    anchor: 'reuse-a-chain',
  },
  scenarios: {
    title: 'Scenario catalog',
    summary: 'Examples are starting points, not prescribed workflows. Review requirements and sources before copying or installing anything.',
    article: 'scenario-chains',
    anchor: 'scenario-catalog',
  },
  builder: {
    title: 'Workflow designer',
    summary: 'Compose the ordered prompt from skill and instruction steps, then resolve inputs and save before running.',
    article: 'user-guide',
    anchor: 'design-and-save-a-chain',
  },
  builderSettings: {
    title: 'Chain settings',
    summary: 'A chain uses one harness. Session modes describe how context is shared; fork and fresh behavior depends on the harness.',
    article: 'user-guide',
    anchor: 'session-modes',
  },
  skills: {
    title: 'Skill catalog',
    summary: 'Search and inspect skill instructions before adding a skill to the chain. A named skill is model-invoked context, not a guarantee it will fire.',
    article: 'user-guide',
    anchor: 'browse-the-skill-catalog',
  },
  steps: {
    title: 'Steps',
    summary: 'Steps run in the displayed order. Add an instruction for a standalone prompt or add a catalog skill; reorder with the buttons or drag.',
    article: 'user-guide',
    anchor: 'design-and-save-a-chain',
  },
  stepEditor: {
    title: 'Step editor',
    summary: 'Write a clear instruction for this step. Use declared {{input_name}} placeholders for values that should be collected before a run.',
    article: 'user-guide',
    anchor: 'design-and-save-a-chain',
  },
  inputs: {
    title: 'Chain inputs',
    summary: 'Declare reusable input names and reference them in instructions with {{name}}. Required values must be supplied before starting.',
    article: 'user-guide',
    anchor: 'design-and-save-a-chain',
  },
  preflight: {
    title: 'Preflight',
    summary: 'Preflight checks local prerequisites without making a model call. Resolve blocking findings and review warnings before starting.',
    article: 'user-guide',
    anchor: 'preflight-and-start-a-run',
  },
  runMode: {
    title: 'Run mode',
    summary: 'Supervised mode waits for your outcome. Automatic mode advances only when the selected harness reports its documented completion signal.',
    article: 'user-guide',
    anchor: 'supervised-run-controls',
  },
  runControls: {
    title: 'Run controls',
    summary: 'Retry, skip, pause, and abort are explicit actions. Read the current step reason before deciding; retry does not undo file changes.',
    article: 'user-guide',
    anchor: 'supervised-run-controls',
  },
  recovery: {
    title: 'Interrupted run recovery',
    summary: 'An interrupted step is never replayed automatically. Choose retry, continue from the next pending step, or restart the chain.',
    article: 'user-guide',
    anchor: 'recover-an-interrupted-run',
  },
  terminal: {
    title: 'Terminal',
    summary: 'The terminal belongs to the active run. Closing this page does not stop the server or harness; use run controls to stop a run.',
    article: 'user-guide',
    anchor: 'supervised-run-controls',
  },
  help: {
    title: 'Help and guides',
    summary: 'Browse the user guide and linked local help articles. Section links can be bookmarked and opened directly.',
    article: 'user-guide',
    anchor: 'who-this-is-for',
  },
  stopServer: {
    title: 'Stop server',
    summary: 'Stopping the local server affects every connected tab. Active runs are interrupted for explicit recovery after the server restarts.',
    article: 'user-guide',
    anchor: 'offline-and-reconnect-behavior',
  },
  newProject: {
    title: 'Create a project',
    summary: 'Choose a parent folder and a new folder name. Skill Loom creates files only when you confirm project creation.',
    article: 'user-guide',
    anchor: 'register-and-open-a-project',
  },
  runStart: {
    title: 'Prepare a run',
    summary: 'Resolve inputs, select a run mode, review session and permission details, then run preflight before starting.',
    article: 'user-guide',
    anchor: 'preflight-and-start-a-run',
  },
  importBundle: {
    title: 'Import a bundle',
    summary: 'Review the chain instructions and every included skill package before confirming. Import does not run bundled scripts.',
    article: 'user-guide',
    anchor: 'import-a-shared-chain',
  },
  exportBundle: {
    title: 'Export a bundle',
    summary: 'Export uses the saved chain. Review package contents, secrets, and redistribution rights before sharing the file.',
    article: 'user-guide',
    anchor: 'share-a-chain-and-its-skills',
  },
  scenarioSkill: {
    title: 'Add a bundled skill',
    summary: 'Review the upstream source and license. Adding a package installs it into the project but does not execute its scripts.',
    article: 'scenario-chains',
    anchor: 'scenario-catalog',
  },
  discoverySkill: {
    title: 'Discover workflows with scenario-discovery',
    summary: 'The skill can inspect project-local packages or validate a project-independent handoff, propose scenarios, and build a reviewable bundle. It does not import or run the bundle.',
    article: 'user-guide',
    anchor: 'discover-candidate-skills-and-prepare-a-handoff',
  },
  runnerSkill: {
    title: 'Run a bundle with loom-run-bundle',
    summary: 'The portable runner inspects a bundle, installs reviewed skills, and coordinates explicit steps in the current host. It does not launch a harness.',
    article: 'user-guide',
    anchor: 'run-an-exported-chain-inside-a-harness',
  },
} satisfies Record<string, HelpTopic>;

export type HelpTopicId = keyof typeof HELP_TOPICS;

const PAGE_TOPICS: ReadonlyArray<[RegExp, HelpTopicId]> = [
  [/^\/$/, 'start'],
  [/^\/discovery$/, 'discovery'],
  [/^\/library$/, 'libraries'],
  [/^\/shared-bundles$/, 'sharedBundles'],
  [/^\/drafts(?:\/|$)/, 'library'],
  [/^\/help(?:\/|$)/, 'help'],
  [/^\/projects\/[^/]+\/chains\/[^/]+\/run$/, 'runStart'],
  [/^\/projects\/[^/]+\/chains\/[^/]+$/, 'builder'],
  [/^\/projects\/[^/]+\/skills$/, 'projectSkills'],
  [/^\/projects\/[^/]+$/, 'projectChains'],
  [/^\/projects$/, 'projects'],
  [/^\/chains$/, 'library'],
  [/^\/scenarios$/, 'scenarios'],
  [/^\/runs\/[^/]+\/terminal$/, 'terminal'],
  [/^\/runs\/[^/]+$/, 'runControls'],
];

export function getPageHelpTopic(pathname: string): HelpTopicId {
  return PAGE_TOPICS.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'shell';
}
