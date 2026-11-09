import { expect, test, type APIRequestContext, type Page, type WebSocketRoute } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Browser coverage for RUN-07 (terminal-dominant run view).
 *
 * Playwright starts the built app behind the real Fastify server with an
 * isolated LOOM_CONFIG_DIR, HOME, and PATH. Every project, chain, run, and fake
 * harness executable in this spec lives under a temporary root. The fake
 * OpenCode emits real OSC 7501 working/idle sequences for automatic mode and
 * stays alive for supervised Done/Next. Runs are created through the typed API
 * (not by this view) after a passing preflight.
 */

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;
let fakeOpenCodePath: string;
let fakeCopilotPath: string;
let originalOpenCode: Buffer | undefined;
let originalCopilot: Buffer | undefined;
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

let launch = 1;
try {
  const log = path.join(cwd, '.fake-harness.log');
  if (fs.existsSync(log)) launch += fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length;
  fs.appendFileSync(
    log,
    'LAUNCH ' + (automatic ? 'automatic' : 'supervised') + ' ' + projectName + '\\n',
  );
} catch {
  // A read-only fixture would still exercise the run; the log is only proof.
}

process.stdout.write('FAKE_OPENCODE_' + (automatic ? 'AUTO' : 'SUPERVISED') + '_' + projectName + '\\r\\n');
process.stdout.write('FAKE_HARNESS_LAUNCH_' + launch + '\\r\\n');

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
  if (args.join(' ').includes('Run the second supervised step.')) {
    process.stdout.write('FAKE_SECOND_SUPERVISED_STEP\\r\\n');
  }
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
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'loom-run-e2e-')));

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  const healthBody = (await health.json()) as { configDirectory: string };
  configDirectory = healthBody.configDirectory;
  configPath = join(configDirectory, 'config.json');

  const fakeBinDirectory = join(dirname(configDirectory), 'bin');
  await mkdir(fakeBinDirectory, { recursive: true });
  fakeOpenCodePath = join(fakeBinDirectory, 'opencode');
  fakeCopilotPath = join(fakeBinDirectory, 'copilot');
  originalOpenCode = await readFile(fakeOpenCodePath);
  originalCopilot = await readFile(fakeCopilotPath);
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
  if (fakeOpenCodePath !== undefined && originalOpenCode !== undefined) {
    await writeFile(fakeOpenCodePath, originalOpenCode, { mode: 0o755 });
  }
  if (fakeCopilotPath !== undefined && originalCopilot !== undefined) {
    await writeFile(fakeCopilotPath, originalCopilot, { mode: 0o755 });
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

function collectTerminalFrames(page: Page): string[] {
  const events: string[] = [];
  const marker = 'FAKE_SUPERVISED_HOLDING';
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/api/terminal/')) {
      return;
    }
    let tail = '';
    events.push('socket opened');
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') {
        events.push('binary frame');
        return;
      }
      try {
        const message = JSON.parse(payload) as { type?: string; data?: string; code?: string };
        if (message.type === 'output') {
          const text = tail + (message.data ?? '');
          events.push(`output: holding marker ${text.includes(marker) ? 'present' : 'absent'}`);
          tail = text.slice(-(marker.length - 1));
        } else {
          events.push(`message: ${message.type ?? 'unknown'}${message.code === undefined ? '' : ` (${message.code})`}`);
        }
      } catch {
        events.push('invalid JSON frame');
      }
    });
    socket.on('close', () => events.push('socket closed'));
    socket.on('socketerror', () => events.push('socket error'));
  });
  return events;
}

async function expectHoldingTerminal(page: Page, frames: string[]): Promise<void> {
  try {
    await expect(terminalScreen(page)).toContainText('FAKE_SUPERVISED_HOLDING', {
      timeout: 15_000,
    });
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_1');
  } catch (error) {
    await test.info().attach('terminal-frames', {
      body: frames.join('\n'),
      contentType: 'text/plain',
    });
    throw error;
  }
}

test.describe('Terminal-dominant run view', () => {
  test('shows and gates managed discovery review before terminal controls', async ({ page, request }) => {
    const { project } = await openFixtureProject(request, 'discovery-review');
    const chain = await createChain(request, project.id, `Discovery review ${runSuffix}`, [
      {
        id: 'scenario-discovery',
        skillName: 'deploy-helper',
        instruction: 'Review the discovery result.',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    await page.route('**/api/discovery/workspaces', async (route) => {
      await route.fulfill({
        json: {
          workspaces: [{
            id: 'a0f4cbaa-f755-4be6-95bf-d6a2019ff7d5',
            projectId: project.id,
            chainId: chain.id,
            harness: 'opencode',
            createdAt: new Date().toISOString(),
            handoffFingerprint: 'a'.repeat(64),
            autoImport: false,
            path: project.canonicalPath,
            runId: run.id,
          }],
        },
      });
    });

    await page.goto(`/runs/${encodeURIComponent(run.id)}/terminal`);

    const reviewHeading = page.getByRole('heading', {
      level: 2,
      name: 'Review scenario-discovery result',
    });
    const done = page.getByTestId('run-outcome-done');
    await expect(reviewHeading).toBeVisible();
    await expect(page.locator('[data-testid="discovery-result-review"], [data-testid="run-controls"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')))
    ).resolves.toEqual(['discovery-result-review', 'run-controls']);
    await expect(done).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Load result for review' })).toBeVisible();
  });

  test('shows the same guarded review in run details', async ({ page, request }) => {
    const { project } = await openFixtureProject(request, 'discovery-review-details');
    const chain = await createChain(request, project.id, `Discovery details ${runSuffix}`, [
      {
        id: 'scenario-discovery',
        skillName: 'deploy-helper',
        instruction: 'Review the discovery result.',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    await page.route('**/api/discovery/workspaces', async (route) => {
      await route.fulfill({
        json: {
          workspaces: [{
            id: 'a0f4cbaa-f755-4be6-95bf-d6a2019ff7d5',
            projectId: project.id,
            chainId: chain.id,
            harness: 'opencode',
            createdAt: new Date().toISOString(),
            handoffFingerprint: 'a'.repeat(64),
            autoImport: false,
            path: project.canonicalPath,
            runId: run.id,
          }],
        },
      });
    });

    await page.goto(`/runs/${encodeURIComponent(run.id)}`);
    await expect(page.getByRole('heading', { name: 'Review scenario-discovery result' })).toBeVisible();
    await expect(page.getByTestId('run-outcome-done')).toBeDisabled();
  });

  test('reviews the exact result before Done and imports the completed result as a draft', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { project } = await openFixtureProject(request, 'discovery-review-flow');
    const chain = await createChain(request, project.id, `Discovery review flow ${runSuffix}`, [
      {
        id: 'scenario-discovery',
        skillName: 'deploy-helper',
        instruction: 'Review the discovery result.',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    const workspace: Record<string, unknown> = {
      id: 'a0f4cbaa-f755-4be6-95bf-d6a2019ff7d5',
      projectId: project.id,
      chainId: chain.id,
      harness: 'opencode',
      createdAt: new Date().toISOString(),
      handoffFingerprint: 'a'.repeat(64),
      autoImport: true,
      path: project.canonicalPath,
      runId: run.id,
    };
    const resultBundle = {
      format: 'skill-loom-chain',
      version: 1,
      chain: {
        name: 'Reviewed discovery result',
        harness: 'opencode',
        sessionMode: 'shared',
        steps: [{ id: 'approved-step', skillName: 'deploy-helper', instruction: 'Review safely.' }],
        inputs: [],
      },
      skills: [{
        name: 'deploy-helper',
        directory: 'deploy-helper',
        files: [{ path: 'SKILL.md', content: 'Reviewed fixture content.', executable: false }],
      }],
    };
    let actionFingerprint: string | null = null;
    await page.route('**/api/discovery/workspaces', async (route) => {
      await route.fulfill({ json: { workspaces: [workspace] } });
    });
    await page.route('**/api/discovery/workspaces/*/result', async (route) => {
      await route.fulfill({ json: { bundle: resultBundle, fingerprint: 'd'.repeat(64) } });
    });
    await page.route('**/api/discovery/workspaces/*/result-review', async (route) => {
      const body = route.request().postDataJSON() as {
        fingerprint: string;
        contentsReviewed: boolean;
        redistributionReviewed: boolean;
      };
      expect(body).toEqual({
        fingerprint: 'd'.repeat(64),
        contentsReviewed: true,
        redistributionReviewed: true,
      });
      actionFingerprint = body.fingerprint;
      workspace.resultFingerprint = body.fingerprint;
      await route.fulfill({ json: { fingerprint: body.fingerprint, reviewed: true } });
    });
    await page.route('**/api/discovery/workspaces/*/import', async (route) => {
      workspace.importedDraftId = 'draft-reviewed-result';
      await route.fulfill({ json: { draftId: 'draft-reviewed-result', imported: true } });
    });

    await page.goto(`/runs/${encodeURIComponent(run.id)}/terminal`);
    const done = page.getByTestId('run-outcome-done');
    await expect(done).toBeDisabled();
    await page.getByRole('button', { name: 'Load result for review' }).click();
    await expect(page.getByText('Reviewed fixture content.')).toBeVisible();
    await page.getByLabel('I reviewed the complete generated chain and package contents.').check();
    await page.getByLabel('I separately reviewed whether sharing these package contents is permitted.').check();
    await expect(done).toBeEnabled();
    await done.click();
    await expect.poll(() => actionFingerprint).toBe('d'.repeat(64));
    await expect(page.getByTestId('run-control-next')).toBeEnabled();
    await page.getByTestId('run-control-next').click();
    await expect(page.getByTestId('terminal-run-status')).toHaveAttribute('data-status', 'completed');
    const importButton = page.getByRole('button', { name: 'Create new Chain draft from reviewed result' });
    await expect(importButton).toBeVisible();
    await importButton.click();
    await expect(page.getByRole('link', { name: 'Open Chain draft' })).toHaveAttribute(
      'href',
      '/drafts/draft-reviewed-result',
    );
  });

  test('keeps Done disabled and offers retry when discovery ownership cannot be checked', async ({
    page,
    request,
  }) => {
    const { project } = await openFixtureProject(request, 'discovery-review-lookup');
    const chain = await createChain(request, project.id, `Discovery lookup ${runSuffix}`, [
      {
        id: 'scenario-discovery',
        skillName: 'deploy-helper',
        instruction: 'Review the discovery result.',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    let lookupCount = 0;
    await page.route('**/api/discovery/workspaces', async (route) => {
      lookupCount += 1;
      if (lookupCount === 1) {
        await route.fulfill({
          status: 503,
          json: { error: { code: 'TEMPORARY', message: 'Workspace lookup failed.' } },
        });
        return;
      }
      await route.fulfill({
        json: {
          workspaces: [{
            id: 'a0f4cbaa-f755-4be6-95bf-d6a2019ff7d5',
            projectId: project.id,
            chainId: chain.id,
            harness: 'opencode',
            createdAt: new Date().toISOString(),
            handoffFingerprint: 'a'.repeat(64),
            autoImport: false,
            path: project.canonicalPath,
            runId: run.id,
          }],
        },
      });
    });

    await page.goto(`/runs/${encodeURIComponent(run.id)}/terminal`);
    const done = page.getByTestId('run-outcome-done');
    await expect(page.getByText('Workspace lookup failed.')).toBeVisible();
    await expect(done).toBeDisabled();
    await page.locator('.panel')
      .filter({ has: page.getByRole('heading', { name: 'Discovery review status unavailable' }) })
      .getByRole('button', { name: 'Retry' })
      .click();
    await expect(page.getByRole('heading', { name: 'Review scenario-discovery result' })).toBeVisible();
    await expect(done).toBeDisabled();
  });

  test('clears loaded result approval when the fingerprint becomes stale', async ({ page, request }) => {
    const { project } = await openFixtureProject(request, 'discovery-review-stale');
    const chain = await createChain(request, project.id, `Discovery stale ${runSuffix}`, [
      {
        id: 'scenario-discovery',
        skillName: 'deploy-helper',
        instruction: 'Review the discovery result.',
      },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    await page.route('**/api/discovery/workspaces', async (route) => {
      await route.fulfill({
        json: {
          workspaces: [{
            id: 'a0f4cbaa-f755-4be6-95bf-d6a2019ff7d5',
            projectId: project.id,
            chainId: chain.id,
            harness: 'opencode',
            createdAt: new Date().toISOString(),
            handoffFingerprint: 'a'.repeat(64),
            autoImport: false,
            path: project.canonicalPath,
            runId: run.id,
          }],
        },
      });
    });
    await page.route('**/api/discovery/workspaces/*/result', async (route) => {
      await route.fulfill({ json: { bundle: { chain: { name: 'Stale fixture' } }, fingerprint: 'd'.repeat(64) } });
    });
    await page.route('**/api/discovery/workspaces/*/result-review', async (route) => {
      await route.fulfill({
        status: 409,
        json: { error: { code: 'DISCOVERY_RESULT_REVIEW_STALE', message: 'The result changed after review.' } },
      });
    });

    await page.goto(`/runs/${encodeURIComponent(run.id)}/terminal`);
    await page.getByRole('button', { name: 'Load result for review' }).click();
    await page.getByLabel('I reviewed the complete generated chain and package contents.').check();
    await page.getByLabel('I separately reviewed whether sharing these package contents is permitted.').check();
    const done = page.getByTestId('run-outcome-done');
    await expect(done).toBeEnabled();
    await done.click();
    await expect(page.getByText('The result changed after review.')).toBeVisible();
    await expect(done).toBeDisabled();
    await expect(page.getByTestId('terminal-run-status')).toHaveAttribute('data-status', 'awaiting-user');
    const runResponse = await request.get(`/api/runs/${encodeURIComponent(run.id)}`);
    expect(runResponse.ok()).toBe(true);
    expect((await runResponse.json()).run.steps[0].status).toBe('running');
  });

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
    await expect(page.getByTestId('run-terminal')).toHaveAttribute('data-session-id', /loom_run_/);

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
    await expect(terminalScreen(page)).toContainText('FAKE_SECOND_SUPERVISED_STEP', { timeout: 15_000 });
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_1');
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_2');

    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');
    await expect(page.getByTestId('run-terminal-empty')).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('reattaches the compact terminal to the retried process', async ({ page, request }) => {
    test.setTimeout(60_000);
    const consoleErrors = collectConsoleErrors(page);
    const { project } = await openFixtureProject(request, 'compact-retry');
    const chain = await createChain(request, project.id, `Compact retry ${runSuffix}`, [
      { id: 'retry-step', skillName: 'deploy-helper', instruction: 'Review the task.' },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    await page.goto(`/runs/${encodeURIComponent(run.id)}/terminal`);
    await expect(page.getByRole('heading', { level: 1, name: 'Run terminal' })).toBeVisible();
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_1', { timeout: 15_000 });

    await page.getByTestId('run-outcome-failed').click();
    await expect(page.getByTestId('terminal-run-status')).toContainText('Paused');
    await page.getByTestId('run-control-retry').click();
    await expect(page.getByTestId('terminal-run-status')).toContainText('Awaiting user');
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_2', { timeout: 15_000 });
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_1');
    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('terminal-run-status')).toContainText('Aborted');
    expect(consoleErrors).toEqual([]);
  });

  test('reattaches after missing a process-start event while the run stream is offline', async ({ page, request }) => {
    test.setTimeout(60_000);
    const { project, projectPath } = await openFixtureProject(request, 'missed-process-start');
    const chain = await createChain(request, project.id, `Missed start ${runSuffix}`, [
      { id: 'one', skillName: 'deploy-helper', instruction: 'Review first.' },
      { id: 'two', skillName: 'deploy-helper', instruction: 'Review second.' },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    let activeEvents: WebSocketRoute | undefined;
    let rejectReconnect = false;
    await page.routeWebSocket(/\/api\/runs\/[^/]+\/events/, (socket) => {
      if (rejectReconnect) {
        void socket.close();
        return;
      }
      activeEvents = socket;
      socket.connectToServer();
    });
    await gotoRun(page, run.id);
    await expect(page.getByTestId('run-stream-state')).toContainText('live');
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_1', { timeout: 15_000 });
    if (activeEvents === undefined) throw new Error('The run event stream did not connect.');
    rejectReconnect = true;
    await activeEvents.close();
    await expect(page.getByTestId('run-stream-state')).toContainText('offline');

    const done = await request.post(`/api/runs/${run.id}/actions`, { data: { action: 'done' } });
    expect(done.ok()).toBe(true);
    const next = await request.post(`/api/runs/${run.id}/actions`, { data: { action: 'next' } });
    expect(next.ok()).toBe(true);
    await expect.poll(async () =>
      (await readFile(join(projectPath, '.fake-harness.log'), 'utf8')).split('\n').filter(Boolean).length,
    ).toBe(2);
    rejectReconnect = false;
    await expect(page.getByTestId('run-stream-state')).toContainText('live', { timeout: 15_000 });
    await expect(page.getByTestId('step-status-1')).toContainText('Awaiting user');
    await terminalScreen(page).scrollIntoViewIfNeeded();
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_2', { timeout: 15_000 });
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_1');
    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');
  });

  test('keeps a healthy terminal attached when only the run stream reconnects', async ({ page, request }) => {
    test.setTimeout(60_000);
    const { project } = await openFixtureProject(request, 'event-reconnect');
    const chain = await createChain(request, project.id, `Event reconnect ${runSuffix}`, [
      { id: 'one', skillName: 'deploy-helper', instruction: 'Hold until aborted.' },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    let activeEvents: WebSocketRoute | undefined;
    let terminalConnections = 0;
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname.startsWith('/api/terminal/')) terminalConnections += 1;
    });
    await page.routeWebSocket(/\/api\/runs\/[^/]+\/events/, (socket) => {
      activeEvents = socket;
      socket.connectToServer();
    });
    await gotoRun(page, run.id);
    await expect(page.getByTestId('run-stream-state')).toContainText('live');
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_1', { timeout: 15_000 });
    if (activeEvents === undefined) throw new Error('The run event stream did not connect.');
    await activeEvents.close();
    await expect(page.getByTestId('run-stream-state')).toContainText('offline');
    await expect(page.getByTestId('run-stream-state')).toContainText('live', { timeout: 15_000 });
    await page.waitForTimeout(900);
    expect(terminalConnections).toBe(1);
    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');
  });

  test('recovers a process started before the first event-stream snapshot', async ({ page, request }) => {
    test.setTimeout(60_000);
    const { project } = await openFixtureProject(request, 'initial-stream-race');
    const chain = await createChain(request, project.id, `Initial stream race ${runSuffix}`, [
      { id: 'one', skillName: 'deploy-helper', instruction: 'Review first.' },
      { id: 'two', skillName: 'deploy-helper', instruction: 'Review second.' },
    ]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    let connectEvents: (() => void) | undefined;
    await page.routeWebSocket(/\/api\/runs\/[^/]+\/events/, (socket) => {
      connectEvents = () => { socket.connectToServer(); };
    });
    await gotoRun(page, run.id);
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_1', { timeout: 15_000 });
    await expect.poll(() => connectEvents !== undefined).toBe(true);
    expect((await request.post(`/api/runs/${run.id}/actions`, { data: { action: 'done' } })).ok()).toBe(true);
    expect((await request.post(`/api/runs/${run.id}/actions`, { data: { action: 'next' } })).ok()).toBe(true);
    connectEvents?.();
    await expect(page.getByTestId('step-status-1')).toContainText('Awaiting user');
    await terminalScreen(page).scrollIntoViewIfNeeded();
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_2', { timeout: 15_000 });
    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');
  });

  test('refuses live reconciliation and clears a claimed run only after abort and a fresh review', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { project } = await openFixtureProject(request, 'claimed-reconciliation');
    const reviewUrl = `/api/projects/${project.id}/coordination-review`;
    const actionUrl = `/api/projects/${project.id}/coordination-action`;
    const initial = await request.post(reviewUrl);
    expect(initial.ok()).toBe(true);
    const { review: initialReview } = await initial.json() as { review: { reviewDigest: string } };
    const enabled = await request.post(actionUrl, {
      data: { action: 'enable', reviewDigest: initialReview.reviewDigest, stoppedConfirmed: true, oldClientsStoppedConfirmed: true },
    });
    expect(enabled.ok()).toBe(true);
    const chain = await createChain(request, project.id, `Claimed ${runSuffix}`, [{
      id: 'claimed-step', skillName: 'deploy-helper', instruction: 'Hold until explicitly aborted.',
    }]);
    const run = await createRun(request, project.id, chain.id, 'supervised');

    await page.goto(`/projects/${project.id}`);
    const details = page.locator('.project-details');
    if (!(await details.evaluate((element) => element instanceof HTMLDetailsElement && element.open))) {
      await details.getByText('Project details').click();
    }
    const review = page.getByRole('button', { name: 'Review coordination' });
    const confirmStopped = async () => {
      await page.getByRole('checkbox', { name: 'I confirmed older Skill Loom services and helpers have stopped.' }).check();
      await page.getByRole('checkbox', { name: 'I confirmed previous work and all its processes and descendants have stopped.' }).check();
    };
    await review.click();
    await expect(page.getByText(`Claim: managed run ${run.id}`, { exact: false })).toBeVisible();
    await confirmStopped();
    await page.getByRole('button', { name: 'Mark claimed managed run interrupted' }).click();
    await expect(page.getByText(/Coordination failed:.*PROJECT_COORDINATION_BUSY/)).toBeVisible();
    await expect(review).toBeFocused();

    const aborted = await request.post(`/api/runs/${run.id}/actions`, {
      data: { action: 'abort', reason: 'Finish browser reconciliation test.' },
    });
    expect(aborted.ok(), await aborted.text()).toBe(true);
    await review.click();
    await expect(page.getByText(`Claim: managed run ${run.id}`, { exact: false })).toBeVisible();
    await expect(page.getByText(/aborted — terminal/)).toBeVisible();
    const clear = page.getByRole('button', { name: 'Clear reviewed claim' });
    await expect(clear).toBeDisabled();
    await confirmStopped();
    await clear.click();
    await expect(page.getByRole('status')).toHaveText('Coordination action applied. Review again before another action.');
    await expect(review).toBeFocused();
    await review.click();
    await expect(page.getByText('Claim: None.')).toBeVisible();
  });

  test('stops retrying terminal attachments that are repeatedly rejected', async ({ page, request }) => {
    test.setTimeout(60_000);
    const { project } = await openFixtureProject(request, 'terminal-conflict');
    const chain = await createChain(request, project.id, `Terminal conflict ${runSuffix}`, [{
      id: 'terminal-conflict-step', skillName: 'deploy-helper', instruction: 'Hold until aborted.',
    }]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    let attempts = 0;
    await page.routeWebSocket(/\/api\/terminal\//, (socket) => {
      attempts += 1;
      socket.send(JSON.stringify({
        type: 'error', code: 'TERMINAL_SUBSCRIBER_CONFLICT', message: 'Another subscriber is attached.',
      }));
      socket.close({ code: 1008, reason: 'TERMINAL_SUBSCRIBER_CONFLICT' });
    });
    await gotoRun(page, run.id);
    await expect.poll(() => attempts, { timeout: 15_000 }).toBe(9);
    await expect(page.getByTestId('run-terminal').getByText('Terminal disconnected. Reopen the terminal to try attaching again.')).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Terminal disconnected. Reopen the terminal to try attaching again.');
    expect(attempts).toBe(9);
    await page.waitForTimeout(900);
    expect(attempts).toBe(9);
  });

  test('renews the terminal retry budget after an attachment is accepted', async ({ page, request }) => {
    test.setTimeout(60_000);
    const { project } = await openFixtureProject(request, 'terminal-retry');
    const chain = await createChain(request, project.id, `Terminal retry ${runSuffix}`, [{
      id: 'terminal-retry-step', skillName: 'deploy-helper', instruction: 'Hold until aborted.',
    }]);
    const run = await createRun(request, project.id, chain.id, 'supervised');
    let attempts = 0;
    await page.routeWebSocket(/\/api\/terminal\//, async (socket) => {
      attempts += 1;
      if (attempts >= 9) {
        socket.send(JSON.stringify({ type: 'ready', sessionId: 'loom_run_fixture', pid: 1, cols: 80, rows: 24 }));
        if (attempts === 9) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          socket.close({ code: 1001, reason: 'transient disconnect' });
        }
        return;
      }
      socket.send(JSON.stringify({
        type: 'error', code: 'TERMINAL_SUBSCRIBER_CONFLICT', message: 'Another subscriber is attached.',
      }));
      socket.close({ code: 1008, reason: 'TERMINAL_SUBSCRIBER_CONFLICT' });
    });
    await gotoRun(page, run.id);
    await expect.poll(() => attempts, { timeout: 15_000 }).toBe(10);
    await expect(page.getByTestId('run-terminal').getByText('Terminal disconnected.', { exact: false })).toHaveCount(0);
    await page.waitForTimeout(900);
    expect(attempts).toBe(10);
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
    await expect(terminalScreen(page)).toContainText('FAKE_HARNESS_LAUNCH_2', { timeout: 15_000 });
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
    const terminalFrames = collectTerminalFrames(page);
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
    await expectHoldingTerminal(page, terminalFrames);

    const logPath = join(projectPath, '.fake-harness.log');
    const launchesBefore = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean).length;
    expect(launchesBefore).toBe(1);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Run view' })).toBeVisible();
    await expect(page.getByTestId('run-status')).toContainText('Awaiting user');
    await expect(page.getByTestId('step-status-0')).toContainText('Awaiting user');
    await expect(page.getByTestId('step-status-1')).toContainText('Pending');
    // The buffered terminal output is replayed by the server to the new xterm.
    await expectHoldingTerminal(page, terminalFrames);
    expect(terminalFrames.filter((event) => event === 'message: ready').length).toBeGreaterThanOrEqual(2);
    expect(
      terminalFrames.filter((event) => event === 'output: holding marker present').length,
    ).toBeGreaterThanOrEqual(2);

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
    const runsDirectory = join(project.canonicalPath, '.loom', 'runs');
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

    let receivedSnapshot = false;
    page.on('websocket', (socket) => {
      if (!socket.url().includes(`/api/runs/${runId}/events`)) return;
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string' && JSON.parse(payload).type === 'snapshot') {
          receivedSnapshot = true;
        }
      });
    });
    await page.getByTestId('run-recovery-retry').click();
    await expect(page.getByTestId('run-status')).toContainText('Awaiting user', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('run-recovery')).toHaveCount(0);
    await expect(page.getByTestId('step-status-0')).toContainText('Awaiting user');
    await terminalScreen(page).scrollIntoViewIfNeeded();
    await expect(terminalScreen(page)).toContainText('FAKE_SUPERVISED_HOLDING', {
      timeout: 15_000,
    });

    await expect.poll(() => receivedSnapshot).toBe(true);
    const externalFailure = await request.post(`/api/runs/${runId}/actions`, {
      data: { action: 'failed', reason: 'External supervised decision' },
    });
    expect(externalFailure.status()).toBe(200);
    await expect(page.getByTestId('run-status')).toContainText('Paused');
    await expect(page.getByTestId('step-status-0')).toContainText('Failed');
    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('run-status')).toContainText('Aborted');

    expect(consoleErrors).toEqual([]);
  });
});
