import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Browser coverage for RUN-07 (terminal-dominant run view).
 *
 * Playwright starts the built app behind the real Fastify server with an
 * isolated SLAN_CONFIG_DIR, HOME, and PATH. Every project, chain, run, and fake
 * harness executable in this spec lives under a temporary root. The fake
 * OpenCode emits real OSC 7501 working/idle sequences for automatic mode and
 * stays alive for supervised Done/Next. Runs are created through the typed API
 * (not by this view) after a passing preflight.
 */

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;
let fakeOpenCodePath: string;
let fakeCopilotPath: string;
let configDirectory: string;
let configPath: string;
let originalConfigText: string | null = null;

interface OpenedProject {
  id: string;
  canonicalPath: string;
  displayName: string;
}

interface StoredStep {
  id: string;
  skillName: string;
  instruction: string;
  label?: string;
}

interface StoredChain {
  version: number;
  id: string;
  name: string;
  harness: 'opencode' | 'copilot';
  sessionMode: 'shared' | 'fresh' | 'fork';
  steps: StoredStep[];
  inputs: Array<{ name: string; label?: string; required: boolean; defaultValue?: string }>;
  automaticPermissionOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoredRun {
  id: string;
  status: string;
  mode: string;
  steps: Array<{ id: string; status: string; index: number }>;
}

function openCodeScript(): string {
  return `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const cwd = process.cwd();
const projectName = path.basename(cwd);
const automatic = args[0] === 'run';

if (args[0] === 'auth' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([
    { provider: 'fake-provider', connections: [{ type: 'oauth' }] }
  ]));
  process.exit(0);
}
if (args[0] === '--version' || args[0] === 'version') {
  process.stdout.write('2.2.5\\n');
  process.exit(0);
}

try {
  fs.appendFileSync(
    path.join(cwd, '.fake-harness.log'),
    'LAUNCH ' + (automatic ? 'automatic' : 'supervised') + ' ' + projectName + '\\n',
  );
} catch {
  // A read-only fixture would still exercise the run; the log is only proof.
}

process.stdout.write('FAKE_OPENCODE_' + (automatic ? 'AUTO' : 'SUPERVISED') + '_' + projectName + '\\r\\n');

if (automatic) {
  if (projectName.includes('failure')) {
    process.stdout.write('FAKE_AUTOMATIC_FAILURE\\r\\n');
    process.exit(1);
  }

  // A real OSC working then idle sequence is the only automatic completion
  // signal. The delay keeps Pause usable in the browser test.
  process.stdout.write('\\x1b]7501;state=working\\x07');
  setTimeout(() => {
    process.stdout.write('FAKE_AUTOMATIC_IDLE_' + projectName + '\\r\\n');
    process.stdout.write('\\x1b]7501;state=idle\\x07');
    setTimeout(() => process.exit(0), 100);
  }, 2000);
} else {
  process.stdout.write('FAKE_SUPERVISED_HOLDING\\r\\n');
  setInterval(() => {}, 1000);
}
`;
}

function copilotScript(): string {
  return `#!/usr/bin/env node
process.stderr.write('fake copilot is not used by the run view spec\\n');
process.exit(1);
`;
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body, 'utf8');
  await chmod(path, 0o755);
}

async function writeSkill(projectPath: string, name: string): Promise<void> {
  const directory = join(projectPath, '.opencode', 'skills', name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Fake skill for the run view browser test\n---\nRUN_VIEW_SKILL_BODY\n`,
    'utf8',
  );
}

test.beforeAll(async ({ request }) => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'slan-run-e2e-')));

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  const healthBody = (await health.json()) as { configDirectory: string };
  configDirectory = healthBody.configDirectory;
  configPath = join(configDirectory, 'config.json');

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

  const baseConfig =
    originalConfigText === null
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

test.afterEach(async ({ request }) => {
  // Never leave the single active-run slot claimed by a failed assertion.
  try {
    const active = await request.get('/api/runs/active');
    if (!active.ok()) {
      return;
    }
    const body = (await active.json()) as {
      active: boolean;
      runId: string | null;
    };
    if (body.active && body.runId !== null) {
      await request.post(`/api/runs/${body.runId}/actions`, {
        data: { action: 'abort', reason: 'Playwright run view cleanup.' },
      });
    }
  } catch {
    // A failed cleanup must not mask the original assertion.
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
  name: string,
): Promise<{ project: OpenedProject; projectPath: string }> {
  const projectPath = join(fixtureRoot, `${name}-${runSuffix}`);
  await writeSkill(projectPath, 'deploy-helper');
  const response = await request.post('/api/projects', {
    data: { mode: 'open', path: projectPath },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { project: OpenedProject };
  return { project: body.project, projectPath };
}

async function createChain(
  request: APIRequestContext,
  projectId: string,
  name: string,
  steps: StoredStep[],
): Promise<StoredChain> {
  const response = await request.post(`/api/projects/${projectId}/chains`, {
    data: {
      name,
      harness: 'opencode',
      sessionMode: 'shared',
      steps,
      inputs: [],
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

/**
 * Create a run through the real API. This view does not implement run creation;
 * the test uses the same preflight-gated endpoint the preflight screen would.
 */
async function createRun(
  request: APIRequestContext,
  projectId: string,
  chainId: string,
  mode: 'supervised' | 'automatic',
): Promise<StoredRun> {
  const preflightResponse = await request.post(`/api/projects/${projectId}/preflight`, {
    data: { chainId, mode, inputs: {} },
  });
  expect(preflightResponse.ok()).toBe(true);
  const report = (await preflightResponse.json()) as {
    status: string;
    startAllowed: boolean;
    acknowledgements: { required: string[]; missing: string[] };
    checks: Array<{ id: string; message: string; status: string }>;
  };
  expect(
    report.status,
    JSON.stringify(report.checks.filter((check) => check.status === 'block')),
  ).not.toBe('blocked');
  expect(report.startAllowed).toBe(true);

  const response = await request.post(`/api/projects/${projectId}/runs`, {
    data: {
      chainId,
      mode,
      inputs: {},
      acknowledgements: report.acknowledgements.required,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { run: StoredRun };
  return body.run;
}

async function gotoRun(page: Page, runId: string): Promise<void> {
  await page.goto(`/runs/${encodeURIComponent(runId)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Run view' })).toBeVisible();
}

function terminalScreen(page: Page) {
  return page.getByTestId('run-terminal-screen');
}

test.describe('Terminal-dominant run view', () => {
  test('shows the supervised terminal, waits for Done, advances, and leaves the terminal with Escape', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const consoleErrors = collectConsoleErrors(page);
    const { project } = await openFixtureProject(request, 'supervised');
    const chain = await createChain(request, project.id, `Supervised ${runSuffix}`, [
      {
        id: 'supervised-step-one',
        skillName: 'deploy-helper',
        instruction: 'Run the first supervised step.',
        label: 'First supervised step',
      },
      {
        id: 'supervised-step-two',
        skillName: 'deploy-helper',
        instruction: 'Run the second supervised step.',
        label: 'Second supervised step',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');

    await gotoRun(page, run.id);
    await expect(page.getByTestId('run-chain-name')).toHaveText(chain.name);
    await expect(page.getByTestId('run-mode')).toHaveText('Supervised');
    await expect(page.getByTestId('run-status')).toContainText('Awaiting user');
    await expect(page.getByTestId('step-status-0')).toContainText('Awaiting user');
    await expect(page.getByTestId('step-status-1')).toContainText('Pending');

    // Terminal output comes from the real fake harness and is rendered by xterm.
    await expect(terminalScreen(page)).toContainText('FAKE_SUPERVISED_HOLDING', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('run-terminal')).toHaveAttribute('data-session-id', /slan_run_/);

    // Only supervised controls are present.
    await expect(page.getByTestId('run-outcome-done')).toBeVisible();
    await expect(page.getByTestId('run-control-next')).toBeDisabled();
    await expect(page.getByTestId('run-control-abort')).toBeVisible();
    await expect(page.getByTestId('run-control-pause')).toHaveCount(0);
    await expect(page.getByTestId('run-control-resume')).toHaveCount(0);
    await expect(page.getByTestId('run-control-run-next')).toHaveCount(0);

    // Focus enters the terminal through the documented button and leaves with Escape.
    await page.getByTestId('run-terminal-focus').focus();
    await page.keyboard.press('Enter');
    const terminalInput = page.locator('.xterm-helper-textarea');
    await expect(terminalInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('run-controls')).toBeFocused();

    // Step transitions reach the shared aria-live status region.
    await page.getByTestId('run-outcome-done').click();
    await expect(page.getByTestId('step-status-0')).toContainText('Done');
    await expect(page.getByTestId('run-control-next')).toBeEnabled();
    await expect(page.getByRole('status')).toContainText('Step 1 of 2');

    await page.getByTestId('run-control-next').click();
    await expect(page.getByTestId('step-status-1')).toContainText('Awaiting user');
    await expect(page.getByRole('status')).toContainText('Step 2 of 2');

    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');
    await expect(page.getByTestId('run-terminal-empty')).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('automatic mode advances only on the harness signal and exposes Pause, Resume, Run next, and Abort', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const consoleErrors = collectConsoleErrors(page);
    const { project } = await openFixtureProject(request, 'automatic');
    const chain = await createChain(request, project.id, `Automatic ${runSuffix}`, [
      {
        id: 'automatic-step-one',
        skillName: 'deploy-helper',
        instruction: 'Run the first automatic step.',
        label: 'First automatic step',
      },
      {
        id: 'automatic-step-two',
        skillName: 'deploy-helper',
        instruction: 'Run the second automatic step.',
        label: 'Second automatic step',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'automatic');

    await gotoRun(page, run.id);
    await expect(page.getByTestId('run-mode')).toHaveText('Automatic');
    await expect(page.getByTestId('run-status')).toContainText('Running');
    await expect(page.getByTestId('run-control-pause')).toBeVisible();
    await expect(page.getByTestId('run-control-abort')).toBeVisible();
    await expect(page.getByTestId('run-outcome-done')).toHaveCount(0);
    await expect(page.getByTestId('run-outcome-failed')).toHaveCount(0);
    await expect(terminalScreen(page)).toContainText('FAKE_OPENCODE_AUTO_', {
      timeout: 15_000,
    });

    await page.getByTestId('run-control-pause').click();
    await expect(page.getByTestId('run-status')).toContainText('Paused');

    // The in-flight step still finishes on the signal, but the chain pauses
    // before the next step.
    await expect(page.getByTestId('step-status-0')).toContainText('Done', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('run-control-resume')).toBeVisible();
    await expect(page.getByTestId('run-control-run-next')).toBeVisible();
    await expect(page.getByTestId('step-status-1')).toContainText('Pending');

    await page.getByTestId('run-control-resume').click();
    await expect(page.getByTestId('run-status')).toContainText('Running');
    await expect(page.getByTestId('step-status-1')).toContainText('Done', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('run-status')).toContainText('Completed', {
      timeout: 30_000,
    });

    expect(consoleErrors).toEqual([]);
  });

  test('a failure pauses the chain and offers Retry, Skip, and Abort without auto-retry', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const consoleErrors = collectConsoleErrors(page);
    const { project } = await openFixtureProject(request, 'failure');
    const chain = await createChain(request, project.id, `Failure ${runSuffix}`, [
      {
        id: 'failure-step',
        skillName: 'deploy-helper',
        instruction: 'Run the failing automatic step.',
        label: 'Failing automatic step',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'automatic');

    await gotoRun(page, run.id);
    await expect(page.getByTestId('run-status')).toContainText('Paused', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('step-status-0')).toContainText('Failed');
    await expect(page.getByTestId('run-failure')).toBeVisible();
    await expect(page.getByTestId('run-failure-hint')).toBeVisible();
    await expect(page.getByTestId('run-control-retry')).toBeVisible();
    await expect(page.getByTestId('run-control-skip')).toBeVisible();
    await expect(page.getByTestId('run-control-abort')).toBeVisible();
    await expect(page.getByTestId('run-outcome-done')).toHaveCount(0);

    // No timer or terminal transition retries the step behind the user's back.
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('run-status')).toContainText('Paused');
    await expect(page.getByTestId('step-status-0')).toContainText('Failed');
    await expect(page.getByTestId('run-control-retry')).toBeVisible();

    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');

    expect(consoleErrors).toEqual([]);
  });

  test('reloading reconnects to the live terminal with a snapshot and never replays a step', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const consoleErrors = collectConsoleErrors(page);
    const { project, projectPath } = await openFixtureProject(request, 'reconnect');
    const chain = await createChain(request, project.id, `Reconnect ${runSuffix}`, [
      {
        id: 'reconnect-step-one',
        skillName: 'deploy-helper',
        instruction: 'Run the first reconnect step.',
        label: 'First reconnect step',
      },
      {
        id: 'reconnect-step-two',
        skillName: 'deploy-helper',
        instruction: 'Run the second reconnect step.',
        label: 'Second reconnect step',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');

    await gotoRun(page, run.id);
    await expect(page.getByTestId('run-status')).toContainText('Awaiting user');
    await expect(terminalScreen(page)).toContainText('FAKE_SUPERVISED_HOLDING', {
      timeout: 15_000,
    });

    const logPath = join(projectPath, '.fake-harness.log');
    const launchesBefore = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean).length;
    expect(launchesBefore).toBe(1);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Run view' })).toBeVisible();
    await expect(page.getByTestId('run-status')).toContainText('Awaiting user');
    await expect(page.getByTestId('step-status-0')).toContainText('Awaiting user');
    await expect(page.getByTestId('step-status-1')).toContainText('Pending');
    // The buffered terminal output is replayed by the server to the new xterm.
    await expect(terminalScreen(page)).toContainText('FAKE_SUPERVISED_HOLDING', {
      timeout: 15_000,
    });

    // The reload must not spawn the step again or advance it.
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('step-status-0')).toContainText('Awaiting user');
    await expect(page.getByTestId('step-status-1')).toContainText('Pending');
    const launchesAfterReload = (await readFile(logPath, 'utf8'))
      .split('\n')
      .filter(Boolean).length;
    expect(launchesAfterReload).toBe(launchesBefore);

    // Controls still work after the reattach.
    await page.getByTestId('run-outcome-done').click();
    await expect(page.getByTestId('step-status-0')).toContainText('Done');
    await page.getByTestId('run-control-next').click();
    await expect(page.getByTestId('step-status-1')).toContainText('Awaiting user');

    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');

    expect(consoleErrors).toEqual([]);
  });

  test('an interrupted run shows recovery actions and retry starts the interrupted step', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const consoleErrors = collectConsoleErrors(page);
    const { project } = await openFixtureProject(request, 'recovery');
    const chain = await createChain(request, project.id, `Recovery ${runSuffix}`, [
      {
        id: 'recovery-step',
        skillName: 'deploy-helper',
        instruction: 'Run the interrupted recovery step.',
        label: 'Interrupted recovery step',
      },
    ]);
    const fullChain = await getChain(request, project.id, chain.id);

    const runId = `run-recovery-${runSuffix}`;
    const timestamp = new Date().toISOString();
    const runRecord = {
      version: 1,
      id: runId,
      projectId: project.id,
      chainId: fullChain.id,
      harness: fullChain.harness,
      mode: 'supervised',
      sessionMode: fullChain.sessionMode,
      chainSnapshot: fullChain,
      resolvedInputs: {},
      status: 'interrupted',
      currentStepIndex: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      finishedAt: timestamp,
      sessionId: null,
      forkMechanism: 'none',
      steps: [
        {
          id: fullChain.steps[0]!.id,
          index: 0,
          skillName: fullChain.steps[0]!.skillName,
          label: fullChain.steps[0]!.label ?? null,
          status: 'interrupted',
          startedAt: timestamp,
          finishedAt: timestamp,
          exitCode: null,
          sessionId: null,
          forkMechanism: 'none',
          skillObservation: 'unknown',
          tail: '',
          reason: 'PROCESS_INTERRUPTED',
        },
      ],
      reason: 'PROCESS_INTERRUPTED',
    };
    const runsDirectory = join(project.canonicalPath, '.slan', 'runs');
    await mkdir(runsDirectory, { recursive: true });
    await writeFile(join(runsDirectory, `${runId}.json`), `${JSON.stringify(runRecord, null, 2)}\n`, 'utf8');

    await gotoRun(page, runId);
    await expect(page.getByTestId('run-status')).toContainText('Interrupted');
    await expect(page.getByTestId('run-recovery')).toBeVisible();
    await expect(page.getByTestId('run-recovery-note')).toContainText('Nothing replays');
    await expect(page.getByTestId('run-recovery-retry')).toBeEnabled();
    await expect(page.getByTestId('run-recovery-continue')).toBeDisabled();
    await expect(page.getByTestId('run-recovery-restart')).toBeEnabled();
    await expect(page.getByTestId('run-terminal-empty')).toBeVisible();

    await page.getByTestId('run-recovery-retry').click();
    await expect(page.getByTestId('run-status')).toContainText('Awaiting user', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('run-recovery')).toHaveCount(0);
    await expect(page.getByTestId('step-status-0')).toContainText('Awaiting user');
    await expect(terminalScreen(page)).toContainText('FAKE_SUPERVISED_HOLDING', {
      timeout: 15_000,
    });

    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');

    expect(consoleErrors).toEqual([]);
  });
});
