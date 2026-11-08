#!/usr/bin/env node
/**
 * Capture the README visual tour.
 *
 * Starts an isolated production server with a throwaway config directory, a
 * temporary HOME, a scripted fake OpenCode executable, and demo projects under
 * `.tmp/`. It then drives Chromium through the main screens, writes the
 * captioned tour images, and assembles the slow README GIF.
 *
 * Nothing here reads or writes the developer's real Skill Loom configuration,
 * projects, credentials, or harness installations.
 *
 * Usage:
 *   npm run docs:capture
 *   npm run docs:capture -- --skip-build
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import gifenc from 'gifenc';
import pngjs from 'pngjs';

const { GIFEncoder, applyPalette, quantize } = gifenc;
const { PNG } = pngjs;
const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tourDirectory = join(repoRoot, 'docs', 'assets', 'tour');
const gifPath = join(repoRoot, 'docs', 'assets', 'skill-loom-tour.gif');
const skipBuild = process.argv.includes('--skip-build');
const pngViewport = { width: 1440, height: 900 };
const gifViewport = { width: 960, height: 600 };
const designerViewport = { width: 1680, height: 1050 };
const frameDelayMs = 1_300;

const SKILLS = [
  {
    name: 'repo-audit',
    title: 'Repository audit',
    description: 'Audit a repository for risky changes and missing coverage.',
    body: 'Review the working tree, flag risky changes, and report missing tests.',
  },
  {
    name: 'release-check',
    title: 'Release check',
    description: 'Run a release checklist and report blocking gaps.',
    body: 'Check the version, changelog, lockfile, and release prerequisites.',
  },
  {
    name: 'docs-writer',
    title: 'Docs writer',
    description: 'Draft release notes and operator documentation.',
    body: 'Turn completed checks into release notes and operator-facing docs.',
  },
  {
    name: 'deploy-helper',
    title: 'Deploy helper',
    description: 'Prepare a deployment handoff with rollback steps.',
    body: 'Assemble the handoff, verification steps, and rollback plan.',
  },
  {
    name: 'incident-review',
    title: 'Incident review',
    description: 'Turn an incident timeline into follow-up actions.',
    body: 'Summarize the timeline, causes, and follow-up owners.',
  },
];

const DEMO_CHAIN_STEPS = [
  {
    id: 'step-repo-audit',
    skillName: 'repo-audit',
    label: 'Audit the repository',
    instruction: 'Audit the repository for release blockers.',
  },
  {
    id: 'step-release-check',
    skillName: 'release-check',
    label: 'Check the release',
    instruction: 'Run the release checklist against {{version}} and list every gap.',
  },
  {
    id: 'step-docs-writer',
    skillName: 'docs-writer',
    label: 'Draft release notes',
    instruction: 'Draft release notes for {{version}} from the completed checks.',
  },
  {
    id: 'step-deploy-helper',
    skillName: 'deploy-helper',
    label: 'Prepare handoff',
    instruction: 'Prepare the deployment handoff and rollback steps.',
  },
];

const SECOND_CHAIN_STEPS = [
  {
    id: 'step-incident-review',
    skillName: 'incident-review',
    label: 'Review the incident',
    instruction: 'Summarize the incident timeline and list follow-up actions.',
  },
  {
    id: 'step-incident-docs',
    skillName: 'docs-writer',
    label: 'Write the follow-up',
    instruction: 'Draft the follow-up note for the incident review.',
  },
];

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function findFreePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : null;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  if (port === null) {
    throw new Error('Could not allocate a loopback port.');
  }
  return port;
}

async function waitForHealth(baseURL, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'ok') {
          return;
        }
      }
    } catch {
      // The server may still be starting.
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${baseURL}/api/health.`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
}

async function api(baseURL, path, options = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `API ${options.method ?? 'GET'} ${path} failed: ${String(response.status)} ${body}`,
    );
  }
  return response.json();
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), 5_000)),
  ]);
  if (!exited) {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => undefined);
  }
}

async function writeSkill(projectPath, skill) {
  const directory = join(projectPath, '.opencode', 'skills', skill.name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.title}\n\n${skill.body}\n`,
    'utf8',
  );
}

async function createDemoProject(root, folder, description, skills, withGit) {
  const projectPath = join(root, folder);
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    join(projectPath, 'README.md'),
    `# ${folder}\n\n${description}\n`,
    'utf8',
  );
  await writeFile(join(projectPath, '.gitignore'), '.loom/\n', 'utf8');
  for (const skill of skills) {
    await writeSkill(projectPath, skill);
  }
  if (withGit) {
    try {
      await execFileAsync('git', ['init', '-q'], { cwd: projectPath });
      await execFileAsync('git', ['add', '.'], { cwd: projectPath });
      await execFileAsync(
        'git',
        [
          '-c',
          'user.name=Skill Loom Demo',
          '-c',
          'user.email=demo@example.invalid',
          'commit',
          '-qm',
          'Initial demo project',
        ],
        { cwd: projectPath },
      );
    } catch (error) {
      log(`  git demo repository skipped: ${String(error.message ?? error)}`);
    }
  }
  return realpath(projectPath);
}

async function seedRemoteSnapshot(baseURL, configDirectory) {
  const repository = 'https://github.com/skill-loom/demo-skills.git';
  const { source } = await api(baseURL, '/api/settings/remote-skill-sources', {
    method: 'POST',
    body: JSON.stringify({ repository, ref: 'main' }),
  });
  const revision = 'a'.repeat(40);
  const snapshotRoot = join(configDirectory, 'catalog-sources', source.id, revision);
  const packages = [];

  for (const skill of SKILLS.slice(0, 4)) {
    const repositoryPath = `skills/${skill.name}`;
    const directory = createHash('sha256').update(repositoryPath).digest('hex');
    const skillPath = `SKILL.md`;
    const content = Buffer.from(
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.title}\n\n${skill.body}\n`,
      'utf8',
    );
    const fingerprint = createHash('sha256')
      .update(skillPath)
      .update('\0')
      .update('-')
      .update('\0')
      .update(content)
      .digest('hex');
    const packageRoot = join(snapshotRoot, 'packages', directory);
    await mkdir(packageRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(packageRoot, skillPath), content, { mode: 0o644 });
    packages.push({
      name: skill.name,
      description: skill.description,
      repositoryPath,
      directory,
      files: 1,
      bytes: content.byteLength,
      fingerprint,
    });
  }

  await writeFile(
    join(snapshotRoot, 'snapshot.json'),
    `${JSON.stringify({
      version: 1,
      sourceId: source.id,
      repository,
      revision,
      packages,
      agents: [],
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const firstPackage = packages[0];
  if (firstPackage === undefined) {
    throw new Error('The visual-tour snapshot fixture has no candidate packages.');
  }
  await api(baseURL, '/api/discovery/handoffs', {
    method: 'POST',
    body: JSON.stringify({
      goal: 'Review release readiness and prepare an actionable handoff.',
      harness: 'opencode',
      candidates: [{
        sourceId: source.id,
        revision,
        repositoryPath: firstPackage.repositoryPath,
        fingerprint: firstPackage.fingerprint,
      }],
    }),
  });
  return source;
}

async function writeFakeOpenCode(binDirectory) {
  const executablePath = join(binDirectory, 'opencode');
  await writeFile(
    executablePath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([
    { provider: 'local-demo', connections: [{ type: 'oauth' }] }
  ]));
  process.exit(0);
}
process.stdout.write('\\x1b[36mOpenCode 2.2.5\\x1b[0m · local demo session\\r\\n\\r\\n');
process.stdout.write('\\x1b[2m> \\x1b[0mLoading skill \\x1b[33mrepo-audit\\x1b[0m\\r\\n');
process.stdout.write('  scanning the repository...\\r\\n');
process.stdout.write('  \\x1b[32m✓\\x1b[0m 42 files checked\\r\\n');
process.stdout.write('  \\x1b[33m!\\x1b[0m 2 release blockers found\\r\\n\\r\\n');
process.stdout.write('  - missing changelog entry\\r\\n');
process.stdout.write('  - dependency lockfile is stale\\r\\n\\r\\n');
process.stdout.write('\\x1b[2m> \\x1b[0mWaiting for review...\\r\\n');
setInterval(() => {
  process.stdout.write('\\x1b[2m  still working\\x1b[0m\\r\\n');
}, 3000);
`,
    'utf8',
  );
  await chmod(executablePath, 0o755);
}

async function openProject(baseURL, path) {
  const body = await api(baseURL, '/api/projects', {
    method: 'POST',
    body: JSON.stringify({ mode: 'open', path }),
  });
  return body.project;
}

async function createChain(baseURL, projectId, chain) {
  const body = await api(baseURL, `/api/projects/${projectId}/chains`, {
    method: 'POST',
    body: JSON.stringify(chain),
  });
  return body.chain;
}

async function saveTemplate(baseURL, projectId, chainId, name) {
  return api(baseURL, '/api/chains', {
    method: 'POST',
    body: JSON.stringify({ projectId, chainId, name }),
  });
}

async function abortActiveRun(baseURL) {
  try {
    const body = await api(baseURL, '/api/runs/active');
    if (body.active === true && typeof body.runId === 'string') {
      await api(baseURL, `/api/runs/${body.runId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action: 'abort', reason: 'Visual tour capture finished.' }),
      });
    }
  } catch (error) {
    log(`  active-run cleanup skipped: ${String(error.message ?? error)}`);
  }
}

async function goto(page, baseURL, pathname) {
  await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded' });
}

async function waitForText(page, selector, text, timeout = 20_000) {
  await page.waitForFunction(
    ({ selector: target, text: expected }) => {
      const element = document.querySelector(target);
      return element !== null && (element.textContent ?? '').includes(expected);
    },
    { selector, text },
    { timeout },
  );
}

async function openProjects(page, baseURL, projectsRoot) {
  await goto(page, baseURL, '/projects');
  await page.getByRole('heading', { level: 1, name: 'Projects' }).waitFor();
  await page.getByTestId('recent-project').first().waitFor();
  const folderPath = page.getByLabel('Folder path');
  await folderPath.fill(projectsRoot);
  await folderPath.press('Enter');
  await page.getByTestId('current-folder').filter({ hasText: projectsRoot }).waitFor();
  await page.getByRole('button', { name: 'Open folder atlas-platform' }).waitFor();
}

async function openWorkspace(page, baseURL, project) {
  await goto(page, baseURL, `/projects/${project.id}/skills`);
  await page.getByRole('heading', { level: 1, name: project.displayName }).waitFor();
  const toggle = page.getByTestId('catalog-toggle');
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  await page.getByTestId('skill-row').first().waitFor();
  await page.getByTestId('skill-row').first().getByRole('button').click();
  await page.getByTestId('skill-detail-content').waitFor();
}

async function openBuilder(page, baseURL, project, chain) {
  await goto(page, baseURL, `/projects/${project.id}/chains/${chain.id}`);
  await page.getByRole('heading', { level: 1, name: 'Workflow designer' }).waitFor();
  await page.getByTestId('step-list-count').waitFor();
  await page.getByTestId('chain-draft-check').waitFor();
  await page.getByTestId('step-row').first().getByTestId('step-select').click();
  await page.getByRole('dialog', { name: 'Step editor' }).waitFor();
}

async function openPreflight(page, baseURL, project, chain) {
  await goto(page, baseURL, `/projects/${project.id}/chains/${chain.id}/run`);
  await page.getByRole('heading', { level: 1, name: 'Run start' }).waitFor();
  await page.locator('[data-input-name="version"] input').fill('0.1.0');
  await page.getByTestId('preflight-run').click();
  await page.getByTestId('preflight-gate').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('preflight-gate').filter({ hasText: 'Start allowed' }).waitFor();
}

async function startRun(page) {
  await page.getByTestId('start-run').click();
  await page.waitForURL(/\/runs\/[^/]+\/terminal$/, { timeout: 30_000 });
  await page.getByTestId('run-terminal-screen').waitFor();
  await waitForText(page, '[data-testid="run-terminal-screen"]', 'OpenCode 2.2.5');
  const matched = page.url().match(/\/runs\/([^/]+)\/terminal$/);
  if (matched === null) {
    throw new Error(`Could not read the run id from ${page.url()}.`);
  }
  return matched[1];
}

async function openTerminal(page, baseURL, runId) {
  await goto(page, baseURL, `/runs/${runId}/terminal`);
  await page.getByTestId('run-terminal-screen').waitFor();
  await waitForText(page, '[data-testid="run-terminal-screen"]', 'OpenCode 2.2.5');
  await page.waitForTimeout(1_200);
}

async function openRunDetails(page, baseURL, runId) {
  await goto(page, baseURL, `/runs/${runId}`);
  await page.getByTestId('step-rail').waitFor();
  await page.getByTestId('run-status').waitFor();
  const terminal = page.getByTestId('run-terminal-screen');
  await terminal.waitFor();
  await waitForText(page, '[data-testid="run-terminal-screen"]', 'OpenCode 2.2.5');
  // Paint the terminal canvas before the full-page capture; Chromium may leave
  // an off-screen canvas blank.
  await terminal.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.getByTestId('run-status').scrollIntoViewIfNeeded();
}

async function openLibrary(page, baseURL) {
  await goto(page, baseURL, '/chains');
  await page.getByRole('heading', { level: 1, name: 'Global chain library' }).waitFor();
  await page.getByTestId('global-chain-card').first().waitFor();
}

async function settle(page, { scrollToTop = true } = {}) {
  await page.evaluate((shouldScroll) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (shouldScroll) {
      window.scrollTo(0, 0);
    }
  }, scrollToTop);
  await page.waitForTimeout(450);
}

async function capturePng(page, name, fullPage = true) {
  await settle(page);
  await page.screenshot({
    path: join(tourDirectory, name),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
  log(`  saved docs/assets/tour/${name}`);
}

async function captureGifFrame(page, target) {
  if (target !== undefined) {
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }
  await settle(page, { scrollToTop: target === undefined });
  return page.screenshot({ fullPage: false, animations: 'disabled', caret: 'hide' });
}

async function encodeGif(frames, outputPath) {
  const gif = GIFEncoder();
  frames.forEach((buffer, index) => {
    const png = PNG.sync.read(buffer);
    const palette = quantize(png.data, 256);
    const indexed = applyPalette(png.data, palette);
    gif.writeFrame(indexed, png.width, png.height, {
      palette,
      delay: frameDelayMs,
      ...(index === 0 ? { repeat: 0 } : {}),
    });
  });
  gif.finish();
  await writeFile(outputPath, gif.bytes());
}

async function main() {
  if (!skipBuild) {
    log('Building the app...');
    await execFileAsync('npm', ['run', 'build'], {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
    });
  }

  await mkdir(tourDirectory, { recursive: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'loom-tour-'));
  const configDirectory = join(temporaryRoot, 'config');
  const homeDirectory = join(temporaryRoot, 'home');
  const binDirectory = join(temporaryRoot, 'bin');
  const projectsRoot = join(temporaryRoot, 'projects');
  await mkdir(configDirectory, { recursive: true });
  await mkdir(homeDirectory, { recursive: true });
  await mkdir(binDirectory, { recursive: true });
  await mkdir(projectsRoot, { recursive: true });

  const port = await findFreePort();
  const baseURL = `http://127.0.0.1:${String(port)}`;
  let server = null;
  let browser = null;

  try {
    await writeFakeOpenCode(binDirectory);
    const atlasPath = await createDemoProject(
      projectsRoot,
      'atlas-platform',
      'Demo project for the Skill Loom visual tour.',
      SKILLS,
      true,
    );
    const ledgerPath = await createDemoProject(
      projectsRoot,
      'ledger-service',
      'A second demo project for the recent-project list.',
      SKILLS.slice(0, 3),
      false,
    );

    server = spawn(process.execPath, ['dist/src/server/index.js'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        LOOM_CONFIG_DIR: configDirectory,
        LOOM_PORT: String(port),
        HOME: homeDirectory,
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverOutput = '';
    server.stdout?.on('data', (chunk) => {
      serverOutput += String(chunk);
    });
    server.stderr?.on('data', (chunk) => {
      serverOutput += String(chunk);
    });
    server.on('exit', (code) => {
      if (code !== null && code !== 0) {
        log(`Server exited with code ${String(code)}:\n${serverOutput}`);
      }
    });

    await waitForHealth(baseURL);
    log('Seeding the isolated demo workspace...');
    const atlas = await openProject(baseURL, atlasPath);
    await openProject(baseURL, ledgerPath);
    await seedRemoteSnapshot(baseURL, configDirectory);

    const chain = await createChain(baseURL, atlas.id, {
      name: 'Release readiness',
      harness: 'opencode',
      sessionMode: 'shared',
      steps: DEMO_CHAIN_STEPS,
      inputs: [
        {
          name: 'version',
          label: 'Release version',
          required: true,
          defaultValue: '0.1.0',
        },
      ],
    });
    const secondChain = await createChain(baseURL, atlas.id, {
      name: 'Incident follow-up',
      harness: 'opencode',
      sessionMode: 'fresh',
      steps: SECOND_CHAIN_STEPS,
      inputs: [],
    });
    await saveTemplate(baseURL, atlas.id, chain.id, 'Release readiness template');
    await saveTemplate(baseURL, atlas.id, secondChain.id, 'Incident follow-up template');

    const sharedDirectory = join(temporaryRoot, 'shared-bundles');
    await mkdir(sharedDirectory, { recursive: true });
    await api(baseURL, '/api/shared-bundles/config', {
      method: 'PUT',
      body: JSON.stringify({ directory: sharedDirectory }),
    });
    const { bundle } = await api(
      baseURL,
      `/api/projects/${atlas.id}/chains/${chain.id}/bundle`,
    );
    const reviewFingerprint = createHash('sha256')
      .update(JSON.stringify(bundle), 'utf8')
      .digest('hex');
    await api(baseURL, '/api/shared-bundles/publish-upload', {
      method: 'POST',
      body: JSON.stringify({
        bundle,
        displayName: 'Release readiness example',
        contentsReviewed: true,
        redistributionReviewed: true,
        reviewFingerprint,
      }),
    });

    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: pngViewport,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });

    log('Capturing full-size tour images...');
    await goto(page, baseURL, '/');
    await page.getByRole('heading', { level: 1, name: 'What would you like to do?' }).waitFor();
    await capturePng(page, '01-start.png');

    await goto(page, baseURL, '/discovery');
    await page.getByRole('heading', { level: 1, name: 'Discover reusable workflows' }).waitFor();
    await page.getByRole('checkbox', { name: /Select repo-audit/ }).check();
    await capturePng(page, '02-discovery.png');
    await page.getByRole('checkbox', { name: /Select repo-audit/ }).uncheck();

    await goto(page, baseURL, '/library');
    await page.getByRole('heading', { level: 1, name: 'Libraries and saved work' }).waitFor();
    await capturePng(page, '03-library-overview.png');

    await openProjects(page, baseURL, projectsRoot);
    await capturePng(page, '04-projects.png');

    await openWorkspace(page, baseURL, atlas);
    await capturePng(page, '05-project-workspace.png');

    await openBuilder(page, baseURL, atlas, chain);
    await page.setViewportSize(designerViewport);
    await capturePng(page, '06-workflow-designer.png', false);
    await page.setViewportSize(pngViewport);

    await openPreflight(page, baseURL, atlas, chain);
    await capturePng(page, '07-preflight.png');

    const runId = await startRun(page);
    await openTerminal(page, baseURL, runId);
    await capturePng(page, '08-terminal.png', false);

    await openRunDetails(page, baseURL, runId);
    await capturePng(page, '09-run-details.png');

    await openLibrary(page, baseURL);
    await capturePng(page, '10-chain-library.png');

    await goto(page, baseURL, '/shared-bundles');
    await page.getByRole('heading', { level: 1, name: 'Shared bundle library' }).waitFor();
    await page.getByText('Release readiness', { exact: true }).waitFor();
    await capturePng(page, '11-shared-bundles.png');

    log('Capturing slow GIF frames...');
    await page.setViewportSize(gifViewport);
    const frames = [];

    await goto(page, baseURL, '/');
    frames.push(await captureGifFrame(page));

    await goto(page, baseURL, '/discovery');
    await page.getByRole('heading', { level: 1, name: 'Discover reusable workflows' }).waitFor();
    frames.push(await captureGifFrame(page, page.getByRole('heading', { name: '3. Candidate skills' })));

    await goto(page, baseURL, '/library');
    frames.push(await captureGifFrame(page));

    await openProjects(page, baseURL, projectsRoot);
    frames.push(await captureGifFrame(page));

    await openWorkspace(page, baseURL, atlas);
    frames.push(await captureGifFrame(page, page.getByTestId('skill-catalog')));

    await openBuilder(page, baseURL, atlas, chain);
    frames.push(await captureGifFrame(page, page.getByTestId('step-row').first()));

    await openPreflight(page, baseURL, atlas, chain);
    frames.push(await captureGifFrame(page, page.getByTestId('preflight-report')));

    await openTerminal(page, baseURL, runId);
    frames.push(await captureGifFrame(page));

    await openRunDetails(page, baseURL, runId);
    frames.push(await captureGifFrame(page));

    await openLibrary(page, baseURL);
    frames.push(await captureGifFrame(page, page.getByTestId('global-chain-list')));

    await goto(page, baseURL, '/shared-bundles');
    frames.push(await captureGifFrame(page, page.getByRole('heading', { name: 'Shared bundle library' })));

    await encodeGif(frames, gifPath);
    log(`  saved docs/assets/skill-loom-tour.gif (${String(frames.length)} frames)`);

    log('Visual tour capture complete.');
  } finally {
    await abortActiveRun(baseURL).catch(() => undefined);
    if (browser !== null) {
      await browser.close().catch(() => undefined);
    }
    if (server !== null) {
      await stopProcess(server);
    }
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
