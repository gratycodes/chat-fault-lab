import { expect, test } from '@playwright/test';
import { openScenario, send, waitForStatus } from './helpers';

test('no layout shift while a long code block streams', async ({ page }) => {
  await openScenario(page, 'long-code');
  await page.evaluate(() => {
    const w = window as unknown as { cls: number };
    w.cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEntry[] & { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) w.cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await send(page);
  await waitForStatus(page, 'done');
  const cls = await page.evaluate(() => (window as unknown as { cls: number }).cls);
  expect(cls).toBeLessThan(0.1);
});

test('renders are batched to animation frames, not one per frame received', async ({ page }) => {
  await openScenario(page, 'long-code');
  await send(page);
  await waitForStatus(page, 'done');
  const frames = Number(await page.getByTestId('frames').innerText());
  const commits = Number(await page.getByTestId('commits').innerText());
  expect(frames).toBeGreaterThan(200);
  expect(commits).toBeLessThan(frames);
});
