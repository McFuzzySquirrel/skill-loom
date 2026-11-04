import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Browser coverage for PRE-04 (run start and preflight report).
 *
 * Playwright supplies an isolated SLAN_CONFIG_DIR and HOME. This spec keeps its
 * project fixtures, fake harness executables, and chains under its own
 * temporary root. The isolated config is updated only through the health
 * endpoint's own configDirectory so the developer's real Slan state is never
 * read or written.
 */

const execFileAsync = promisify(execFile);
const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;
let fakeOpenCodePath: string;
let fakeCopilotPath: string;
let configDirectory: string;
let configPath: string;
let isolatedHome: string;
let originalConfigText: string | null = null;

interface OpenedProject {
  id: string;
  canonicalPath: string;
  displayName: string;
}

interface StoredChain {
  id: string;
  name: string;
  harness: 'opencode' | 'copilot';
  sessionMode: 'shared' | 'fresh' | 'fork';
  automaticPermissionOptIn: boolean;
  steps: Array<{ id: string; skillName: string; instruction: string; label?: string }>;
  inputs: Array<{ name: string; label?: string; required: boolean; defaultValue?: string }>;
}

interface ChainSeed {
  name: string;
  harness: 'opencode' | 'copilot';
  sessionMode: 'shared' | 'fresh' | 'fork';
  steps: StoredChain['steps'];
  inputs?: StoredChain['inputs'];
}

async function writeSkill(
  directory: string,
  name: string,
  description: string,
  body: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
    'utf8',
  );
}

/**
 * A fake OpenCode executable. The static auth probe reports a local credential
 * connection, and the supervised entry holds the PTY open so the Start action
 * can navigate to a live run view.
 */
function openCodeScript(): string {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([
    { provider: 'fake-provider', connections: [{ type: 'oauth' }] }
  ]));
  process.exit(0);
}
process.stdout.write('FAKE_PREFLIGHT_RUN\\r\\n');
setInterval(() => {}, 1000);
`;
}

/**
 * A fake Copilot executable. Discovery returns one project skill; every other
 * invocation is the interactive trust launch, which holds the PTY open until
 * the server closes it.
 */
function copilotScript(): string {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'skill' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([
    {
      name: 'deploy-helper',
      source: 'project',
      path: '.copilot/skills/deploy-helper',
      description: 'Fake Copilot deploy skill'
    }
  ]));
  process.exit(0);
}
process.stdout.write('FAKE COPILOT TRUST SESSION\\r\\n');
process.stdout.write('Accept the folder-trust dialog, then verify.\\r\\n');
setInterval(() => {}, 1000);
`;
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body, 'utf8');
  await chmod(path, 0o755);
}

test.beforeAll(async ({ request }) => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'slan-preflight-e2e-')));

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  const healthBody = (await health.json()) as { configDirectory: string };
  configDirectory = healthBody.configDirectory;
  configPath = join(configDirectory, 'config.json');
  isolatedHome = join(dirname(configDirectory), 'home');

  // The Playwright server config puts this isolated directory first on PATH,
  // so default `opencode` and `copilot` lookups hit these fakes. The config
  // override is still set for preflight CLI and auth evidence.
  const fakeBinDirectory = join(dirname(configDirectory), 'bin');
  await mkdir(fakeBinDirectory, { recursive: true });
  fakeOpenCodePath = join(fakeBinDirectory, 'opencode');
  fakeCopilotPath = join(fakeBinDirectory, 'copilot');
  await writeExecutable(fakeOpenCodePath, openCodeScript());
  await writeExecutable(fakeCopilotPath, copilotScript());

  try {
    originalConfigText = await readFile(configPath, 'utf8');
  } catch {
    originalConfigText = null;
  }

  const baseConfig = originalConfigText === null
    ? { version: 1 }
    : (JSON.parse(originalConfigText) as Record<string, unknown>);
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...baseConfig,
        harnessCommands: {
          opencode: fakeOpenCodePath,
          copilot: fakeCopilotPath,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const passProject = join(fixtureRoot, `pass-project-${runSuffix}`);
  await writeSkill(
    join(passProject, '.opencode', 'skills', 'deploy-helper'),
    'deploy-helper',
    'Deploys a release with a checklist',
    'PASS_PROJECT_BODY',
  );

  const warningProject = join(fixtureRoot, `warning-project-${runSuffix}`);
  await writeSkill(
    join(warningProject, '.opencode', 'skills', 'deploy-helper'),
    'deploy-helper',
    'Deploys a release with a checklist',
    'WARNING_PROJECT_BODY',
  );
  await execFileAsync('git', ['init', '--quiet', warningProject]);
  await writeFile(join(warningProject, 'dirty-change.txt'), 'uncommitted\n', 'utf8');

  const trustProject = join(fixtureRoot, `trust-project-${runSuffix}`);
  await writeSkill(
    join(trustProject, '.copilot', 'skills', 'deploy-helper'),
    'deploy-helper',
    'Fake Copilot deploy skill',
    'TRUST_PROJECT_BODY',
  );
});

test.afterAll(async () => {
  if (fakeOpenCodePath !== undefined) {
    await rm(fakeOpenCodePath, { force: true });
  }
  if (fakeCopilotPath !== undefined) {
    await rm(fakeCopilotPath, { force: true });
  }
  if (configPath !== undefined) {
    if (originalConfigText === null) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, originalConfigText, 'utf8');
    }
  }
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function openFixtureProject(
  request: APIRequestContext,
  projectPath: string,
): Promise<OpenedProject> {
  const response = await request.post('/api/projects', {
    data: { mode: 'open', path: projectPath },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { project: OpenedProject };
  return body.project;
}

async function createChain(
  request: APIRequestContext,
  projectId: string,
  seed: ChainSeed,
): Promise<StoredChain> {
  const response = await request.post(`/api/projects/${projectId}/chains`, {
    data: {
      name: seed.name,
      harness: seed.harness,
      sessionMode: seed.sessionMode,
      steps: seed.steps,
      inputs: seed.inputs ?? [],
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { chain: StoredChain };
  return body.chain;
}

async function getChain(
  request: APIRequestContext,
  projectId: string,
  chainId: string,
): Promise<StoredChain> {
  const response = await request.get(`/api/projects/${projectId}/chains/${chainId}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { chain: StoredChain };
  return body.chain;
}

async function gotoRunStart(
  page: Page,
  projectId: string,
  chainId: string,
  chainName: string,
): Promise<void> {
  await page.goto(`/projects/${projectId}/chains/${chainId}/run`);
  await expect(page.getByRole('heading', { level: 1, name: 'Run start' })).toBeVisible();
  await expect(page.getByTestId('chain-summary-name')).toHaveText(chainName);
}

function blockingFinding(page: Page, checkId: string) {
  return page
    .getByTestId('preflight-blocking')
    .locator(`[data-testid="preflight-finding"][data-check-id="${checkId}"]`);
}

function warningFinding(page: Page, checkId: string) {
  return page
    .getByTestId('preflight-warnings')
    .locator(`[data-testid="preflight-finding"][data-check-id="${checkId}"]`);
}

test.describe('Run start and preflight', () => {
  test('validates required inputs, blocks Start, and shows the fork mechanism', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const projectPath = join(fixtureRoot, `pass-project-${runSuffix}`);
    const project = await openFixtureProject(request, projectPath);
    const chain = await createChain(request, project.id, {
      name: `Preflight pass ${runSuffix}`,
      harness: 'opencode',
      sessionMode: 'fork',
      steps: [
        {
          id: 'step-deploy',
          skillName: 'deploy-helper',
          instruction: 'Deploy {{release}} and report the result.',
          label: 'Deploy release',
        },
      ],
      inputs: [
        {
          name: 'release',
          label: 'Release version',
          required: true,
          defaultValue: '',
        },
      ],
    });

    await gotoRunStart(page, project.id, chain.id, chain.name);

    const start = page.getByTestId('start-run');
    await expect(start).toBeDisabled();
    await expect(page.getByTestId('start-reason')).toContainText('Run preflight');

    // The preflight action is reachable and executable by keyboard.
    const preflightButton = page.getByTestId('preflight-run');
    await preflightButton.focus();
    await expect(preflightButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('preflight-report')).toBeVisible();
    const requiredInputFinding = blockingFinding(page, 'inputs').filter({
      hasText: 'Required input(s) are unresolved: release',
    });
    await expect(requiredInputFinding).toBeVisible();
    await expect(requiredInputFinding).toContainText('Required input(s) are unresolved: release');
    await expect(requiredInputFinding.getByTestId('preflight-remediation')).toContainText(
      'Provide a nonempty value for every required input.',
    );
    await expect(page.getByTestId('preflight-summary')).toContainText('Blocked');
    await expect(start).toBeDisabled();
    await expect(page.getByTestId('start-reason')).toContainText('blocking finding');

    // Local validation is visible and independently blocks Start.
    await expect(page.getByTestId('preflight-input-error')).toContainText('Release version');
    await expect(page.getByTestId('preflight-input-error')).toContainText('required');

    await page.getByTestId('preflight-input-field').fill('v1.0.0');
    await expect(page.getByTestId('preflight-input-error')).toHaveCount(0);
    await expect(page.getByTestId('start-reason')).toContainText(
      'changed after the last preflight',
    );
    await expect(start).toBeDisabled();

    await page.getByTestId('preflight-run').click();
    await expect(page.getByTestId('preflight-summary')).toContainText('Preflight passed');
    await expect(page.getByTestId('preflight-blocking')).toContainText(
      'No blocking findings',
    );
    await expect(page.getByTestId('preflight-warnings')).toContainText('No warnings');

    // The fork mechanism is visible before Start is used.
    await expect(page.getByTestId('preflight-fork-mechanism')).toContainText('Handoff');
    await expect(page.getByTestId('preflight-session-plan')).toBeVisible();
    await expect(page.getByTestId('preflight-gate')).toHaveText('Start allowed');

    await expect(start).toBeEnabled();
    await start.click();

    // Start is now a real run trigger: it creates a run and opens the dedicated
    // xterm terminal page. The fake harness holds the PTY so it stays live.
    await expect(page).toHaveURL(/\/runs\/run-[^/]+\/terminal$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Run terminal' }),
    ).toBeVisible();
    await expect(page.getByTestId('run-terminal-screen')).toContainText(
      'FAKE_PREFLIGHT_RUN',
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('terminal-run-status')).toContainText('Awaiting user');

    // Release the single active-run slot before the next test.
    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('terminal-run-status')).toContainText('Aborted');

    expect(consoleErrors).toEqual([]);
  });

  test('groups warnings, requires explicit acknowledgement, and keeps findings visible', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const projectPath = join(fixtureRoot, `warning-project-${runSuffix}`);
    const project = await openFixtureProject(request, projectPath);
    const chain = await createChain(request, project.id, {
      name: `Preflight warnings ${runSuffix}`,
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        {
          id: 'step-warning',
          skillName: 'deploy-helper',
          instruction: 'Review the working tree and deploy.',
        },
      ],
    });

    await gotoRunStart(page, project.id, chain.id, chain.name);

    await page.getByTestId('preflight-run').focus();
    await page.keyboard.press('Enter');

    const reportData = page.getByTestId('preflight-report');
    await expect(reportData).toHaveAttribute('data-status', 'warn');
    await expect(page.getByTestId('preflight-summary')).toContainText('warning');
    await expect(page.getByTestId('preflight-blocking')).toBeVisible();
    await expect(page.getByTestId('preflight-blocking')).toContainText(
      'No blocking findings',
    );

    const gitWarning = warningFinding(page, 'git');
    await expect(gitWarning).toBeVisible();
    await expect(gitWarning).toContainText('uncommitted change');
    await expect(gitWarning.getByTestId('preflight-remediation')).toContainText(
      'never blocks a run',
    );

    const start = page.getByTestId('start-run');
    await expect(start).toBeDisabled();
    await expect(page.getByTestId('start-reason')).toContainText('Acknowledge');

    const warningsAcknowledgement = page.locator(
      '[data-testid="preflight-acknowledgement"][data-ack-key="warnings"]',
    );
    await expect(warningsAcknowledgement).toBeVisible();
    await warningsAcknowledgement.focus();
    await expect(warningsAcknowledgement).toBeFocused();
    await page.keyboard.press('Space');
    await expect(warningsAcknowledgement).toBeChecked();
    await expect(start).toBeEnabled();

    // Re-running preflight after acknowledgement makes the server gate agree.
    await page.getByTestId('preflight-run').click();
    await expect(page.getByTestId('preflight-gate')).toHaveText('Start allowed');
    await expect(page.getByTestId('preflight-summary')).toContainText('acknowledged warning');
    await expect(start).toBeEnabled();
    await expect(warningsAcknowledgement).toBeChecked();

    expect(consoleErrors).toEqual([]);
  });

  test('names a missing skill as a blocking finding with remediation', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const projectPath = join(fixtureRoot, `pass-project-${runSuffix}`);
    const project = await openFixtureProject(request, projectPath);
    const chain = await createChain(request, project.id, {
      name: `Preflight missing skill ${runSuffix}`,
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        {
          id: 'step-missing',
          skillName: 'not-installed-skill',
          instruction: 'Run the missing skill.',
          label: 'Missing skill step',
        },
      ],
    });

    await gotoRunStart(page, project.id, chain.id, chain.name);
    await page.getByTestId('preflight-run').click();

    await expect(page.getByTestId('preflight-report')).toHaveAttribute('data-status', 'blocked');
    const skillFinding = blockingFinding(page, 'skill');
    await expect(skillFinding).toHaveCount(1);
    await expect(skillFinding).toContainText('not-installed-skill');
    await expect(skillFinding).toContainText('not in the opencode catalog');
    await expect(skillFinding.getByTestId('preflight-remediation')).toContainText(
      'Install or add the "not-installed-skill" skill',
    );
    await expect(page.getByTestId('start-run')).toBeDisabled();
    await expect(page.getByTestId('start-reason')).toContainText('blocking finding');

    expect(consoleErrors).toEqual([]);
  });

  test('starts trust, verifies it, and persists the exact automatic-permission opt-in', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const projectPath = join(fixtureRoot, `trust-project-${runSuffix}`);
    const project = await openFixtureProject(request, projectPath);
    const chain = await createChain(request, project.id, {
      name: `Preflight trust ${runSuffix}`,
      harness: 'copilot',
      sessionMode: 'fork',
      steps: [
        {
          id: 'step-copilot',
          skillName: 'deploy-helper',
          instruction: 'Deploy the release with Copilot.',
          label: 'Copilot deploy',
        },
      ],
    });

    await gotoRunStart(page, project.id, chain.id, chain.name);

    const automaticMode = page.getByTestId('run-mode-automatic');
    await automaticMode.focus();
    await expect(automaticMode).toBeFocused();
    await page.keyboard.press('Space');
    await expect(automaticMode).toBeChecked();

    await page.getByTestId('preflight-run').click();
    await expect(page.getByTestId('preflight-report')).toBeVisible();

    // Exact broad flags are visible before any opt-in.
    await expect(page.getByTestId('permission-flags')).toHaveText(
      '--allow-all-paths --allow-all-tools',
    );
    const trustBlock = blockingFinding(page, 'trust');
    await expect(trustBlock).toBeVisible();
    await expect(trustBlock).toContainText('not trusted');
    const permissionBlock = blockingFinding(page, 'permissions');
    await expect(permissionBlock).toBeVisible();
    await expect(permissionBlock).toContainText('per-chain permission opt-in');
    await expect(permissionBlock.getByTestId('preflight-remediation')).toContainText(
      'Enable automatic permissions on this chain',
    );
    await expect(page.getByTestId('start-run')).toBeDisabled();
    await expect(page.getByTestId('preflight-fork-mechanism')).toContainText('Handoff');

    // Trust panel always shows the exact manual fallback.
    const trustPanel = page.getByTestId('trust-panel');
    await expect(trustPanel).toBeVisible();
    await expect(page.getByTestId('trust-state')).toContainText('Not trusted');
    await expect(page.getByTestId('trust-manual-command')).toContainText(/copilot/);
    await expect(page.getByTestId('trust-manual-command')).toContainText(/-C/);

    // The opt-in confirmation is explicit and the chain is unchanged before it.
    const optIn = page.getByTestId('permission-opt-in');
    await expect(optIn).not.toBeChecked();
    await optIn.click();
    const optInConfirm = page.getByTestId('permission-opt-in-confirm-panel');
    await expect(optInConfirm).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 3,
        name: 'Enable automatic permissions for this chain?',
      }),
    ).toBeFocused();
    await expect(page.getByTestId('permission-opt-in-flags')).toHaveText(
      '--allow-all-paths --allow-all-tools',
    );
    const beforeOptIn = await getChain(request, project.id, chain.id);
    expect(beforeOptIn.automaticPermissionOptIn).toBe(false);

    await page.getByTestId('permission-opt-in-confirm').click();
    await expect(optIn).toBeChecked();
    await expect(optIn).toBeDisabled();
    const afterOptIn = await getChain(request, project.id, chain.id);
    expect(afterOptIn.automaticPermissionOptIn).toBe(true);

    // Start the trust PTY only after the explicit confirmation.
    await page.getByTestId('trust-start').click();
    const trustConfirm = page.getByTestId('trust-start-confirm-panel');
    await expect(trustConfirm).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Open a Copilot trust session?' }),
    ).toBeFocused();
    await page.getByTestId('trust-start-confirm').click();
    await expect(page.getByTestId('trust-terminal')).toBeVisible();
    await expect(page.getByTestId('trust-terminal-screen')).toBeVisible();
    await expect(page.getByTestId('trust-terminal')).toHaveAttribute(
      'data-session-id',
      /trust_/,
    );

    // The terminal accepts focus, and Escape returns focus to Verify trust.
    const terminalInput = page.locator('.xterm-helper-textarea');
    await expect(terminalInput).toHaveCount(1);
    await terminalInput.focus();
    await expect(terminalInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('trust-verify')).toBeFocused();

    // Establishing persistent trust is a user action outside Slan: write the
    // isolated Copilot config the CLI would write, then verify.
    await mkdir(join(isolatedHome, '.copilot'), { recursive: true });
    await writeFile(
      join(isolatedHome, '.copilot', 'config.json'),
      `${JSON.stringify({ trustedFolders: [project.canonicalPath] }, null, 2)}\n`,
      'utf8',
    );

    await page.getByTestId('trust-verify').click();
    await expect(page.getByTestId('trust-state')).toContainText('Trusted');
    await expect(page.getByTestId('trust-verify-result')).toContainText('trusted');
    await expect(page.getByTestId('trust-manual-command')).toContainText(/copilot/);

    // Refresh the report: trust and permissions are now resolved. Remaining
    // Copilot authentication ambiguity may still require acknowledgement.
    await page.getByTestId('preflight-run').click();
    await expect(page.getByTestId('preflight-report')).toBeVisible();
    await expect(blockingFinding(page, 'trust')).toHaveCount(0);
    await expect(blockingFinding(page, 'permissions')).toHaveCount(0);
    await expect(page.getByTestId('preflight-fork-mechanism')).toContainText('Handoff');

    const acknowledgements = page.getByTestId('preflight-acknowledgement');
    const acknowledgementCount = await acknowledgements.count();
    for (let index = 0; index < acknowledgementCount; index += 1) {
      await acknowledgements.nth(index).check();
    }

    await page.getByTestId('preflight-run').click();
    await expect(page.getByTestId('preflight-report')).toBeVisible();
    await expect(page.getByTestId('preflight-gate')).toHaveText('Start allowed');
    await expect(page.getByTestId('start-run')).toBeEnabled();

    // Persisted opt-in survives a reload and stays off another chain.
    await page.reload();
    await expect(page.getByTestId('chain-summary-name')).toHaveText(chain.name);
    const persisted = await getChain(request, project.id, chain.id);
    expect(persisted.automaticPermissionOptIn).toBe(true);

    expect(consoleErrors).toEqual([]);
  });
});
