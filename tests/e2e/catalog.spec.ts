import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser coverage for CAT-04 (skill catalog).
 *
 * Playwright supplies an isolated LOOM_CONFIG_DIR and HOME, and this spec keeps
 * every project and extra-directory fixture under its own temporary root. The
 * catalog is driven through src/web/App.tsx and the real server API; only the
 * failure test intercepts a request to force the error state.
 */

const runSuffix = `${String(process.pid)}-${String(Date.now())}`;
const projectName = `catalog-project-${runSuffix}`;

let fixtureRoot: string;
let projectPath: string;
let extraDirectory: string;
let secondExtraDirectory: string;
let brokenSkillPath: string;
let freshSkillPath: string;

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

test.beforeAll(async () => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'loom-catalog-e2e-')));
  projectPath = join(fixtureRoot, projectName);
  extraDirectory = join(fixtureRoot, 'extra-skills');
  secondExtraDirectory = join(fixtureRoot, 'team-skills');
  brokenSkillPath = join(projectPath, '.opencode', 'skills', 'broken');
  freshSkillPath = join(projectPath, '.opencode', 'skills', 'fresh-skill');

  await writeSkill(
    join(projectPath, '.opencode', 'skills', 'deploy'),
    'deploy',
    'Ships releases to production',
    'Deploy instructions\n<em>literal tag</em>\n<script>window.__loom_evil = true</script>',
  );
  await writeSkill(
    join(projectPath, '.opencode', 'skills', 'shared-name'),
    'shared-name',
    'Project copy of a shared name',
    'PROJECT_SHARED_BODY',
  );
  await writeSkill(
    join(projectPath, '.opencode', 'skills', 'alpha-skill'),
    'alpha-skill',
    'Runs alpha checks',
    'Alpha body',
  );

  // A malformed frontmatter block must become a warning without hiding the
  // valid siblings or the fallback-named entry itself.
  await mkdir(brokenSkillPath, { recursive: true });
  await writeFile(
    join(brokenSkillPath, 'SKILL.md'),
    '---\nname: [unclosed\n---\nBroken body\n',
    'utf8',
  );

  await writeSkill(
    join(extraDirectory, 'shared-name'),
    'shared-name',
    'Extra copy of a shared name',
    'EXTRA_SHARED_BODY',
  );
  await writeSkill(
    join(extraDirectory, 'release-notes'),
    'release-notes',
    'Writes release notes from a changelog',
    'EXTRA_RELEASE_BODY',
  );
  await writeSkill(
    join(secondExtraDirectory, 'quality-check'),
    'quality-check',
    'Runs an independent quality check',
    'QUALITY_CHECK_BODY',
  );
});

test.afterAll(async () => {
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/settings/extra-skill-directories');
  expect(response.ok()).toBe(true);
  const { extraSkillDirectories } = await response.json() as { extraSkillDirectories: string[] };
  for (const directory of [extraDirectory, secondExtraDirectory]) {
    if (!extraSkillDirectories.includes(directory)) continue;
    const removed = await request.delete(
      `/api/settings/extra-skill-directories?path=${encodeURIComponent(directory)}`,
    );
    expect(removed.ok()).toBe(true);
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
): Promise<{ id: string; canonicalPath: string }> {
  const response = await request.post('/api/projects', {
    data: { mode: 'open', path: projectPath },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    project: { id: string; canonicalPath: string };
  };
  return body.project;
}

async function expandCatalog(page: Page): Promise<void> {
  const toggle = page.getByTestId('catalog-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('catalog-summary')).toBeVisible();
}

async function gotoCatalog(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/skills`);
  await expect(
    page.getByRole('heading', { level: 1, name: projectName }),
  ).toBeVisible();
  await expect(page.getByTestId('skill-catalog')).toBeVisible();
  await expandCatalog(page);
}

function rowFor(page: Page, name: string) {
  return page.locator(`[data-testid="skill-row"][data-name="${name}"]`);
}

test.describe('Skill catalog', () => {
  test('opens on the skills workspace and can be collapsed on demand', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const project = await openFixtureProject(request);

    await page.goto(`/projects/${project.id}/skills`);
    await expect(
      page.getByRole('heading', { level: 1, name: projectName }),
    ).toBeVisible();

    const toggle = page.getByTestId('catalog-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toContainText('Hide catalog');
    await expect(page.getByTestId('catalog-search')).toBeVisible();
    await expect(page.getByTestId('catalog-summary')).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('catalog-collapsed-summary')).toBeVisible();
    await expect(page.getByTestId('catalog-search')).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('catalog-search')).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('groups by source, keeps warnings visible, and expands full SKILL.md text', async ({
    page,
    request,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const project = await openFixtureProject(request);

    await gotoCatalog(page, project.id);

    await expect(page.getByTestId('catalog-harness-opencode')).toBeChecked();

    const projectGroup = page.locator(
      '[data-testid="catalog-group"][data-source="project"]',
    );
    await expect(projectGroup).toBeVisible();
    await expect(projectGroup.getByText('Project', { exact: true }).first()).toBeVisible();
    await expect(projectGroup).toContainText('Project skills');
    await expect(rowFor(page, 'deploy')).toBeVisible();
    await expect(rowFor(page, 'alpha-skill')).toBeVisible();

    // A warning is shown above the results and never suppresses them.
    const warnings = page.getByTestId('catalog-warnings');
    await expect(warnings).toBeVisible();
    await expect(page.getByTestId('catalog-warning')).toContainText(
      'SKILL_FRONTMATTER_INVALID',
    );
    await expect(rowFor(page, 'broken')).toBeVisible();

    const deployRow = rowFor(page, 'deploy');
    const toggle = deployRow.locator('.skill-row__toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const detail = deployRow.getByTestId('skill-detail-content');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Deploy instructions');
    await expect(detail).toContainText('<em>literal tag</em>');
    await expect(detail).toContainText('<script>window.__loom_evil = true</script>');
    await expect(detail.locator('script')).toHaveCount(0);
    expect(await page.evaluate(() => '__loom_evil' in window)).toBe(false);

    // Collapsing removes the detail region and restores the button state.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(deployRow.getByTestId('skill-detail-content')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
  });

  test('filters on name and description, preserves groups, and shows a distinct empty state', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    await gotoCatalog(page, project.id);

    const search = page.getByTestId('catalog-search');

    await search.fill('PRODUCTION');
    await expect(rowFor(page, 'deploy')).toBeVisible();
    await expect(rowFor(page, 'alpha-skill')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="catalog-group"][data-source="project"]'),
    ).toBeVisible();

    await search.fill('alpha');
    await expect(rowFor(page, 'alpha-skill')).toBeVisible();
    await expect(rowFor(page, 'deploy')).toHaveCount(0);

    await search.fill('no-such-skill-xyz');
    const empty = page.getByTestId('catalog-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(
      'No skills match "no-such-skill-xyz" in the OpenCode catalog.',
    );
    await expect(page.getByTestId('catalog-group')).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
    await expect(rowFor(page, 'deploy')).toBeVisible();
    await expect(page.getByTestId('catalog-empty')).toHaveCount(0);
  });

  test('refreshes discovery without losing the search text', async ({ page, request }) => {
    const project = await openFixtureProject(request);
    await gotoCatalog(page, project.id);

    const search = page.getByTestId('catalog-search');
    await search.fill('fresh-skill');
    await expect(page.getByTestId('catalog-empty')).toBeVisible();

    await writeSkill(
      freshSkillPath,
      'fresh-skill',
      'Appears after an explicit refresh',
      'FRESH_BODY',
    );

    await page.getByTestId('catalog-refresh').click();
    await expect(rowFor(page, 'fresh-skill')).toBeVisible();
    await expect(search).toHaveValue('fresh-skill');

    await rowFor(page, 'fresh-skill').locator('.skill-row__toggle').click();
    await expect(rowFor(page, 'fresh-skill').getByTestId('skill-detail-content')).toContainText(
      'FRESH_BODY',
    );
  });

  test('adds and removes a global extra directory and refreshes duplicate rows', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);

    // A previous interrupted run of this spec may have left the directory
    // configured. Removal only touches Skill Loom config, never the fixture files.
    await request.delete(
      `/api/settings/extra-skill-directories?path=${encodeURIComponent(extraDirectory)}`,
    );

    await gotoCatalog(page, project.id);
    await expect(page.getByTestId('catalog-settings-open')).toBeVisible();
    await page.getByTestId('catalog-settings-open').click();

    const dialog = page.getByTestId('extra-directories-dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: 'Extra skill directories' }),
    ).toBeFocused();
    await expect(dialog).toContainText('Changes are global to Skill Loom');

    const input = dialog.getByTestId('extra-directory-input');
    await input.fill('relative/skills');
    await dialog.getByTestId('extra-directory-add').click();
    await expect(dialog).toContainText('Enter an absolute POSIX or Windows path.');

    await input.fill(join(fixtureRoot, 'does-not-exist'));
    await dialog.getByTestId('extra-directory-add').click();
    const serverError = dialog.getByRole('alert').filter({
      hasText: 'Extra directory update failed',
    });
    await expect(serverError).toBeVisible();
    await expect(serverError).toContainText('The folder does not exist.');
    await expect(serverError).toContainText('PATH_NOT_FOUND');

    await input.fill(extraDirectory);
    await dialog.getByTestId('extra-directory-add').click();
    const item = dialog.getByTestId('extra-directory-item').filter({
      hasText: extraDirectory,
    });
    await expect(item).toBeVisible();

    await input.fill(secondExtraDirectory);
    await dialog.getByTestId('extra-directory-add').click();
    await expect(
      dialog.getByTestId('extra-directory-item').filter({ hasText: secondExtraDirectory }),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('catalog-settings-open')).toBeFocused();

    // Adding the directory refreshes the catalog automatically; the explicit
    // Refresh control must also show the change.
    await page.getByTestId('catalog-refresh').click();
    const extraGroups = page.locator(
      '[data-testid="catalog-group"][data-source="loom-extra"]',
    );
    await expect(extraGroups).toHaveCount(2);
    const firstExtraGroup = page.locator(
      `[data-testid="catalog-group"][data-source="loom-extra"][data-source-directory="${extraDirectory}"]`,
    );
    const secondExtraGroup = page.locator(
      `[data-testid="catalog-group"][data-source="loom-extra"][data-source-directory="${secondExtraDirectory}"]`,
    );
    await expect(firstExtraGroup).toBeVisible();
    await expect(firstExtraGroup).toContainText('Loom extra skills');
    await expect(firstExtraGroup).toContainText(extraDirectory);
    await expect(secondExtraGroup).toContainText(secondExtraDirectory);

    const extraGroupToggle = firstExtraGroup.locator('.catalog-group__toggle');
    const secondExtraGroupToggle = secondExtraGroup.locator('.catalog-group__toggle');
    await expect(extraGroupToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(secondExtraGroupToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rowFor(page, 'release-notes')).toBeHidden();
    await expect(rowFor(page, 'quality-check')).toBeHidden();
    await extraGroupToggle.click();
    await expect(extraGroupToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(rowFor(page, 'release-notes')).toBeVisible();
    await expect(rowFor(page, 'quality-check')).toBeHidden();
    await extraGroupToggle.click();
    await expect(extraGroupToggle).toHaveAttribute('aria-expanded', 'false');
    await secondExtraGroupToggle.click();
    await expect(rowFor(page, 'quality-check')).toBeVisible();
    await expect(rowFor(page, 'release-notes')).toBeHidden();
    await secondExtraGroupToggle.click();
    await extraGroupToggle.click();
    await expect(rowFor(page, 'release-notes')).toBeVisible();

    const projectShared = page.locator(
      '[data-testid="skill-row"][data-source="project"][data-name="shared-name"]',
    );
    const extraShared = firstExtraGroup.locator(
      '[data-testid="skill-row"][data-name="shared-name"]',
    );
    await expect(projectShared).toHaveCount(1);
    await expect(extraShared).toHaveCount(1);
    await expect(page.getByTestId('skill-row').filter({ hasText: 'shared-name' })).toHaveCount(
      2,
    );

    // Same name, different source and canonical path: expansion proves the
    // extra row shows its own file, not the project row's body.
    await extraShared.locator('.skill-row__toggle').click();
    await expect(extraShared.getByTestId('skill-detail-content')).toContainText(
      'EXTRA_SHARED_BODY',
    );
    await expect(extraShared.getByTestId('skill-detail-content')).not.toContainText(
      'PROJECT_SHARED_BODY',
    );

    await page.getByTestId('catalog-settings-open').click();
    const reopened = page.getByTestId('extra-directories-dialog');
    const configured = reopened.getByTestId('extra-directory-item').filter({
      hasText: extraDirectory,
    });
    await configured.getByRole('button', { name: `Remove ${extraDirectory}` }).click();

    const confirm = reopened.getByRole('group', {
      name: `Confirm removal of ${extraDirectory}`,
    });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Files on disk are not deleted.');
    await reopened.getByTestId('extra-directory-confirm').click();
    await expect(configured).toHaveCount(0);

    await reopened.getByRole('button', { name: 'Close settings' }).click();
    await expect(reopened).toHaveCount(0);

    await page.getByTestId('catalog-refresh').click();
    await expect(firstExtraGroup).toHaveCount(0);
    await expect(secondExtraGroup).toHaveCount(1);
    await expect(rowFor(page, 'release-notes')).toHaveCount(0);
    await expect(rowFor(page, 'quality-check')).toHaveCount(1);
    await expect(extraShared).toHaveCount(0);
    await expect(projectShared).toHaveCount(1);
  });

  test('copies a non-project skill package into the project', async ({ page, request }) => {
    const consoleErrors = collectConsoleErrors(page);
    const project = await openFixtureProject(request);
    const added = await request.post('/api/settings/extra-skill-directories', {
      data: { path: extraDirectory },
    });
    expect([201, 409]).toContain(added.status());

    try {
      await gotoCatalog(page, project.id);
      await page
        .locator(
          `[data-testid="catalog-group"][data-source="loom-extra"][data-source-directory="${extraDirectory}"]`,
        )
        .locator('.catalog-group__toggle')
        .click();
      const extraRow = page.locator(
        '[data-testid="skill-row"][data-source="loom-extra"][data-name="release-notes"]',
      );
      await expect(extraRow).toBeVisible();
      await extraRow.locator('.skill-row__toggle').click();

      const copy = extraRow.getByTestId('skill-copy');
      await expect(copy).toBeVisible();
      await copy.click();
      await expect(extraRow.getByTestId('skill-copy-result')).toContainText(
        '.agents/skills/release-notes',
      );

      // The refresh picks up the new project-source entry.
      await page.getByTestId('catalog-refresh').click();
      await expect(
        page.locator(
          '[data-testid="skill-row"][data-source="project"][data-name="release-notes"]',
        ),
      ).toBeVisible();
    } finally {
      await request.delete(
        `/api/settings/extra-skill-directories?path=${encodeURIComponent(extraDirectory)}`,
      );
    }

    expect(consoleErrors).toEqual([]);
  });

  test('shows a distinct loading state, an inline error, and a working retry', async ({
    page,
    request,
  }) => {
    const project = await openFixtureProject(request);
    let catalogRequests = 0;

    await page.route(/\/api\/projects\/[^/]+\/catalog(\?.*)?$/, async (route) => {
      catalogRequests += 1;
      if (catalogRequests === 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, 600);
        });
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Catalog request failed on purpose.',
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/projects/${project.id}/skills`);
    await expect(page.getByTestId('catalog-loading')).toBeVisible();

    const error = page.getByTestId('catalog-error').getByRole('alert');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Catalog request failed on purpose.');
    await expect(error).toContainText('INTERNAL_ERROR');
    await expect(page.getByTestId('catalog-empty')).toHaveCount(0);

    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('catalog-summary')).toBeVisible();
    await expect(page.getByTestId('catalog-error')).toHaveCount(0);
    await expect(rowFor(page, 'deploy')).toBeVisible();
  });
});
