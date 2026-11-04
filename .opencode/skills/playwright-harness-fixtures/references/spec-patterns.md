# Spec Patterns

> Load when writing a Playwright spec for catalog, preflight, supervised run, automatic run, failure, or reconnect.

## Shared fixture

```ts
import { test as base, expect } from "@playwright/test";
import { join } from "node:path";

export const test = base.extend<{ projectDir: string }>({
  projectDir: async ({}, use, testInfo) => {
    const dir = join(process.env.LOOM_E2E_ROOT!, "projects", `p-${testInfo.workerIndex}-${testInfo.title.replace(/\W+/g, "-")}`);
    await use(dir);
  },
});
```

Create the project and skills inside the fixture only when the test needs them.

## Catalog spec

```ts
test("groups duplicate names by source", async ({ page, projectDir }) => {
  await page.goto(`/projects/${projectId}/chains/new`);
  await expect(page.getByRole("region", { name: /catalog/i })).toBeVisible();
  await expect(page.getByText("loom-e2e-alpha")).toHaveCount(2);
  await expect(page.getByText("project", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: /search skills/i }).fill("alpha");
  await expect(page.getByRole("listitem")).toHaveCount(2);
});
```

## Automatic run spec

```ts
test("advances only after working then idle", async ({ page }) => {
  await startRun(page, { mode: "automatic" });
  await expect(page.getByTestId("step-status-0")).toHaveText(/running/i);
  await expect(page.getByTestId("step-status-0")).toHaveText(/done/i, { timeout: 10_000 });
  await expect(page.getByTestId("step-status-1")).toHaveText(/running/i);
});
```

Never assert completion by waiting for the terminal to become quiet.

## Supervised run spec

```ts
test("waits for Done and Next", async ({ page }) => {
  await startRun(page, { mode: "supervised" });
  await expect(page.getByTestId("step-status-0")).toHaveText(/awaiting/i);
  await page.getByRole("button", { name: /mark done/i }).click();
  await page.getByRole("button", { name: /^next$/i }).click();
  await expect(page.getByTestId("step-status-1")).toHaveText(/running|awaiting/i);
});
```

## Failure spec

```ts
test("pauses with retry, skip, and abort", async ({ page }) => {
  await startRun(page, { mode: "automatic", fakeMode: "fail" });
  await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /skip/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /abort/i })).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveText(/failed|paused/i);
});
```

## Terminal assertions

- Wait for xterm-rendered text, not raw frames.
- Use a unique marker printed by the fake harness.
- Do not open a second subscriber for the same run.
- Focus the terminal with the documented button and leave with Escape.

## Cleanup

```ts
test.afterEach(async ({ page }) => {
  await page.evaluate(() => fetch("/api/runs/active")).then((r) => r.ok && r.json()).then((run) => {
    if (run?.id) return fetch(`/api/runs/${run.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "abort" }),
    });
  }).catch(() => {});
});
```

Always abort a live run before teardown and assert no fake process remains.
