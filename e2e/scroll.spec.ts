import { expect, test } from '@playwright/test';
import { openScenario, send, waitForStatus } from './helpers';

test('follows new tokens while pinned to the bottom', async ({ page }) => {
  await openScenario(page, 'long-code');
  await send(page);
  const t = page.getByTestId('transcript');
  await expect.poll(() => t.evaluate((el) => el.scrollHeight > el.clientHeight + 100), { timeout: 10_000 }).toBe(true);
  const gap = await t.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(gap).toBeLessThan(40);
  await waitForStatus(page, 'done');
  expect(await t.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);
});

test('scrolling up mid-stream is not undone by new tokens', async ({ page }) => {
  await openScenario(page, 'long-code', 'realistic');
  await send(page);
  const t = page.getByTestId('transcript');
  await expect.poll(() => t.evaluate((el) => el.scrollHeight > el.clientHeight + 300), { timeout: 15_000 }).toBe(true);
  await t.hover();
  await page.mouse.wheel(0, -250);
  await expect(page.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
  const before = await t.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(800);
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'streaming');
  const after = await t.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(4);

  await page.getByRole('button', { name: /Jump to latest/ }).click();
  await expect(page.getByRole('button', { name: /Jump to latest/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop' }).click();
  await waitForStatus(page, 'stopped');
  expect(await t.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);
});
