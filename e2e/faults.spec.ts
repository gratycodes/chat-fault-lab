import { expect, test } from '@playwright/test';
import { assistant, openScenario, send, waitForStatus } from './helpers';

test('disconnect: a stream with no terminal event is interrupted, not done', async ({ page }) => {
  await openScenario(page, 'disconnect');
  await send(page);
  await waitForStatus(page, 'interrupted');
  await expect(assistant(page)).toHaveAttribute('data-state', 'interrupted');
  await expect(assistant(page)).toContainText('This reply is going to be cut off');
  await expect(page.getByTestId('live-assertive')).toContainText('partial reply is kept');
  await page.getByRole('radio', { name: /Steady stream/ }).check();
  await page.getByRole('button', { name: 'Retry' }).click();
  await waitForStatus(page, 'done');
  await expect(page.locator('[data-testid=transcript] li[data-role=assistant]')).toHaveCount(1);
});

test('stall: shows a waiting notice, then recovers', async ({ page }) => {
  await openScenario(page, 'stall');
  await send(page);
  await expect(page.getByTestId('notice')).toHaveAttribute('data-kind', 'stalled', { timeout: 10_000 });
  await waitForStatus(page, 'done');
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await expect(assistant(page)).toContainText('And now it is back');
});

test('hang: the idle watchdog gives up and keeps the partial reply', async ({ page }) => {
  await openScenario(page, 'hang');
  await send(page);
  await waitForStatus(page, 'interrupted');
  await expect(assistant(page)).toContainText('The first half of this reply arrives normally.');
  await expect(page.getByTestId('log')).toContainText('gave up');
});

test('rate limit: waits for retry-after and retries once', async ({ page }) => {
  await openScenario(page, 'rate-limit');
  await send(page);
  await expect(page.getByTestId('notice')).toContainText('Rate limited');
  await waitForStatus(page, 'done');
  await expect(assistant(page)).toContainText('Second attempt succeeded');
  await expect(page.getByTestId('log')).toContainText('server asked to wait 500 ms');
});

test('server error: keeps the partial text and alerts', async ({ page }) => {
  await openScenario(page, 'server-error');
  await send(page);
  await waitForStatus(page, 'error');
  await expect(assistant(page)).toHaveAttribute('data-state', 'error');
  await expect(assistant(page)).toContainText('Here are the first two sentences');
  await expect(page.getByTestId('live-assertive')).toContainText('The server had an error');
});

test('malformed frame: skipped and logged, reply completes', async ({ page }) => {
  await openScenario(page, 'malformed');
  await send(page);
  await waitForStatus(page, 'done');
  await expect(page.getByTestId('malformed')).toHaveText('1');
  await expect(assistant(page)).toContainText('so it did.');
  await expect(assistant(page)).not.toContainText('LOST');
});

test('utf-8 split across chunks renders intact', async ({ page }) => {
  await openScenario(page, 'utf8-split');
  await send(page);
  await waitForStatus(page, 'done');
  const text = await assistant(page).innerText();
  expect(text).toContain('₹10,000');
  expect(text).toContain('नमस्ते');
  expect(text).toContain('👋🏽');
  expect(text).not.toContain('\uFFFD');
});

test('tool call: arguments stream in, the tool runs once, the answer uses it', async ({ page }) => {
  await openScenario(page, 'tool-call');
  await send(page);
  await expect(page.getByTestId('tool-call')).toContainText('convert_currency');
  await waitForStatus(page, 'done');
  await expect(page.getByTestId('tool-call')).toContainText('arguments complete');
  await expect(page.locator('li[data-role=tool]')).toHaveCount(1);
  await expect(assistant(page)).toContainText('120 EUR is 10,944 INR');
});

test('slow first token: shows waiting state, then streams', async ({ page }) => {
  await openScenario(page, 'slow-start');
  await send(page);
  await expect(page.getByTestId('notice')).toContainText('Waiting for the first token');
  await waitForStatus(page, 'done');
  const ttft = Number((await page.getByTestId('ttft').innerText()).replace(/\D/g, ''));
  expect(ttft).toBeGreaterThanOrEqual(700);
});

test('stop: keeps the partial reply and the composer keeps focus', async ({ page }) => {
  await openScenario(page, 'hang');
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.focus();
  await page.keyboard.press('Enter');
  await waitForStatus(page, 'streaming');
  await expect(assistant(page)).toContainText('arrives');
  await page.keyboard.press('Escape');
  await waitForStatus(page, 'stopped');
  await expect(assistant(page)).toHaveAttribute('data-state', 'stopped');
  await expect(box).toBeFocused();
});
