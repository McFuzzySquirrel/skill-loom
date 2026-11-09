import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Browser coverage for the chain-to-run flow and the global template library.
 *
 * The fake OpenCode holds the supervised PTY open so Start can navigate to a
 * live xterm run. Every project, chain, and fake executable lives under this
 * spec's temporary root.
 */

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;

let fixtureRoot: string;
let openCodePath: string;
let originalOpenCode: Buffer | undefined;
let configPath: string;
let originalConfigText: string | null = null;

interface Project {
  id: string;
  canonicalPath: string;
  displayName: string;
}

interface Chain {
  id: string;
  name: string;
  steps: Array<{ id: string; skillName: string; instruction: string }>;
}

interface Template extends Chain {
  harness: string;
  sessionMode: string;
}

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

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body, 'utf8');
  await chmod(path, 0o755);
}

async function writeSkill(projectPath: string): Promise<void> {
  const directory = join(projectPath, '.opencode', 'skills', 'deploy-helper');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    '---\nname: deploy-helper\ndescription: Fake skill for the run flow test\n---\nRUN_FLOW_BODY\n',
    'utf8',
  );
}

test.beforeAll(async ({ request }) => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'loom-run-flow-e2e-')));
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  const configDirectory = (await health.json()) as { configDirectory: string };
  configPath = join(configDirectory.configDirectory, 'config.json');
  openCodePath = join(dirname(configDirectory.configDirectory), 'bin', 'opencode');

  try {
    originalConfigText = await readFile(configPath, 'utf8');
  } catch {
    originalConfigText = null;
  }
  const base =
    originalConfigText === null
      ? { version: 1 }
      : (JSON.parse(originalConfigText) as Record<string, unknown>);
  await mkdir(dirname(openCodePath), { recursive: true });
  originalOpenCode = await readFile(openCodePath);
  await writeExecutable(
    openCodePath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([
    { provider: 'fake-provider', connections: [{ type: 'oauth' }] }
  ]));
  process.exit(0);
}
process.stdout.write('FAKE_RUN_FLOW_HOLDING\\r\\n');
setInterval(() => {
  process.stdout.write('FAKE_RUN_FLOW_HOLDING\\r\\n');
}, 500);
`,
  );
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...base,
        harnessCommands: {
          ...(base.harnessCommands as Record<string, unknown> | undefined),
          opencode: openCodePath,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
});

test.afterAll(async () => {
  if (openCodePath !== undefined && originalOpenCode !== undefined) {
    await writeFile(openCodePath, originalOpenCode, { mode: 0o755 });
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
  try {
    const active = await request.get('/api/runs/active');
    if (!active.ok()) {
      return;
    }
    const body = (await active.json()) as { active: boolean; runId: string | null };
    if (body.active && body.runId !== null) {
      await request.post(`/api/runs/${body.runId}/actions`, {
        data: { action: 'abort', reason: 'Playwright run flow cleanup.' },
      });
    }
  } catch {
    // Cleanup must not mask the original assertion.
  }
});

async function openProject(request: APIRequestContext, name: string): Promise<Project> {
  const path = join(fixtureRoot, `${name}-${runSuffix}`);
  await writeSkill(path);
  const response = await request.post('/api/projects', {
    data: { mode: 'open', path },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { project: Project }).project;
}

async function createChain(request: APIRequestContext, projectId: string): Promise<Chain> {
  const response = await request.post(`/api/projects/${projectId}/chains`, {
    data: {
      name: `Run flow ${runSuffix}`,
      harness: 'opencode',
      sessionMode: 'shared',
      steps: [
        {
          id: 'run-flow-step',
          skillName: 'deploy-helper',
          instruction: 'Run the run flow step.',
        },
      ],
      inputs: [],
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { chain: Chain }).chain;
}

test.describe('Chain to run flow', () => {
  test('saves and runs from the builder, opens a live xterm, and reaches the run from a chain card', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const consoleErrors = collectConsoleErrors(page);
    const project = await openProject(request, 'flow');
    const chain = await createChain(request, project.id);

    await page.goto(`/projects/${project.id}/chains/${chain.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
    ).toBeVisible();

    await page.getByTestId('chain-save-and-run').click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Run start' }),
    ).toBeVisible();

    await page.getByTestId('preflight-run').click();
    await expect(page.getByTestId('preflight-gate')).toHaveText('Start allowed');
    await page.getByTestId('start-run').click();

    await expect(page).toHaveURL(/\/runs\/run-[^/]+\/terminal$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Run terminal' }),
    ).toBeVisible();
    await expect(page.getByTestId('terminal-run-chain-name')).toHaveText(chain.name);
    const terminalScreen = page.getByTestId('run-terminal-screen');
    await expect(terminalScreen).toContainText('FAKE_RUN_FLOW_HOLDING', {
      timeout: 15_000,
    });
    await page.getByLabel('Appearance').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(terminalScreen).toContainText('FAKE_RUN_FLOW_HOLDING');

    // The pane must stay a fixed, viewport-bounded size while output arrives.
    // Regression guard: an auto-height xterm container used to grow on every
    // fit/resize cycle, slowing the browser and the whole page.
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const initialBox = await terminalScreen.boundingBox();
    expect(initialBox).not.toBeNull();
    expect(initialBox!.height).toBeLessThanOrEqual(viewport!.height);
    await page.waitForTimeout(2_500);
    const laterBox = await terminalScreen.boundingBox();
    expect(laterBox).not.toBeNull();
    expect(Math.abs(laterBox!.height - initialBox!.height)).toBeLessThanOrEqual(1);
    expect(laterBox!.height).toBeLessThanOrEqual(viewport!.height);

    await page.getByTestId('run-control-abort').click();
    await expect(page.getByTestId('terminal-run-status')).toContainText('Aborted');

    // The dedicated terminal links back to the detailed run view.
    await page.getByRole('link', { name: 'Run details' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Run view' }),
    ).toBeVisible();

    // The chain card is a one-click route back to the run-start screen.
    await page.goto(`/projects/${project.id}`);
    const card = page.locator(
      `[data-testid="chain-card"][data-chain-id="${chain.id}"]`,
    );
    await expect(card.getByTestId('chain-run')).toBeVisible();
    await card.getByTestId('chain-run').click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Run start' }),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('saves a global template, imports it into a new project, and removes it', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const source = await openProject(request, 'template-source');
    const target = await openProject(request, 'template-target');
    const chain = await createChain(request, source.id);

    await page.goto(`/projects/${source.id}/chains/${chain.id}`);
    await page.getByText('More actions').click();
    await page.getByTestId('chain-save-to-library').click();
    await expect(page.getByTestId('chain-library-saved')).toBeVisible();

    const listResponse = await request.get('/api/chains');
    expect(listResponse.ok()).toBe(true);
    const list = (await listResponse.json()) as { chains: Template[] };
    const template = list.chains.find((entry) => entry.name === chain.name);
    expect(template).toBeDefined();
    expect(template!.id).not.toBe(chain.id);

    await page.goto('/chains');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Global chain library' }),
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid="global-chain-card"][data-chain-id="${template!.id}"]`),
    ).toBeVisible();

    await page.getByTestId('global-import-project').selectOption(target.id);
    await page
      .locator(`[data-testid="global-chain-card"][data-chain-id="${template!.id}"]`)
      .getByTestId('global-chain-import')
      .click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Workflow designer' }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${target.id}/chains/`));

    const targetChains = await request.get(`/api/projects/${target.id}/chains`);
    const targetList = (await targetChains.json()) as { chains: Chain[] };
    expect(targetList.chains.map((entry) => entry.id)).toHaveLength(1);
    expect(targetList.chains[0]!.id).not.toBe(template!.id);

    // Removing the template leaves the imported project chain intact.
    await page.goto('/chains');
    const card = page.locator(
      `[data-testid="global-chain-card"][data-chain-id="${template!.id}"]`,
    );
    await card.getByTestId('global-chain-remove').click();
    await card.getByTestId('global-chain-remove-confirm').click();
    await expect(card).toHaveCount(0);

    const afterRemoval = await request.get(`/api/projects/${target.id}/chains`);
    expect(afterRemoval.status()).toBe(200);
    expect(((await afterRemoval.json()) as { chains: Chain[] }).chains).toHaveLength(1);

    expect(consoleErrors).toEqual([]);
  });
});
