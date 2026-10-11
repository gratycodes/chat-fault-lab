import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openScenario, send, waitForStatus } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('axe: lab, idle', async ({ page }) => {
  await openScenario(page, 'steady');
  await axe(page);
});

test('axe: lab, after a reply with a tool call', async ({ page }) => {
  await openScenario(page, 'tool-call');
  await send(page);
  await waitForStatus(page, 'done');
  await axe(page);
});

test('axe: lab, after an interrupted reply', async ({ page }) => {
  await openScenario(page, 'disconnect');
  await send(page);
  await waitForStatus(page, 'interrupted');
  await axe(page);
});

test('axe: checklist page', async ({ page }) => {
  await page.goto('./checklist/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Streaming chat checklist');
  await axe(page);
});

test('axe: dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openScenario(page, 'server-error');
  await send(page);
  await waitForStatus(page, 'error');
  await axe(page);
});

test('no token flood: the live region changes per sentence, not per token', async ({ page }) => {
  await openScenario(page, 'steady');
  await page.evaluate(() => {
    const region = document.querySelector('[data-testid=live-polite]')!;
    const w = window as unknown as { liveChanges: string[] };
    w.liveChanges = [];
    new MutationObserver(() => w.liveChanges.push(region.textContent ?? '')).observe(region, { childList: true, subtree: true, characterData: true });
  });
  await send(page);
  await waitForStatus(page, 'done');
  const changes = await page.evaluate(() => (window as unknown as { liveChanges: string[] }).liveChanges.filter(Boolean));
  const frames = Number(await page.getByTestId('frames').innerText());
  expect(frames).toBeGreaterThan(40);
  expect(changes.length).toBeLessThanOrEqual(8);
  for (const c of changes) expect(c).toMatch(/[.!?:]$/);

  // The streaming transcript must not be inside, or contain, a live region.
  const liveInTranscript = await page.evaluate(() => {
    const t = document.querySelector('[data-testid=transcript]')!;
    return Boolean(t.closest('[aria-live],[role=log],[role=status],[role=alert]')) || t.querySelectorAll('[aria-live],[role=log],[role=status],[role=alert]').length > 0;
  });
  expect(liveInTranscript).toBe(false);
});

test('keyboard only: pick a scenario, send, and stop without a mouse', async ({ page }) => {
  await openScenario(page, 'steady');
  await page.getByRole('radio', { name: /Steady stream/ }).focus();
  // Arrow keys move within the radio group.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: /Hung stream/ })).toBeChecked();
  await page.getByRole('textbox', { name: 'Message' }).focus();
  await page.keyboard.press('Enter');
  await waitForStatus(page, 'streaming');
  await page.keyboard.press('Escape');
  await waitForStatus(page, 'stopped');
  // Message box → Send → (Stop is disabled, skipped) → Retry.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
  await page.keyboard.press('Enter');
  await waitForStatus(page, 'streaming');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'streaming');
  await page.getByRole('textbox', { name: 'Message' }).press('Escape');
  await waitForStatus(page, 'stopped');
});

for (const reduce of [true, false]) {
  test(`caret animation ${reduce ? 'is off with' : 'runs without'} prefers-reduced-motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await openScenario(page, 'hang');
    await send(page);
    await waitForStatus(page, 'streaming');
    await expect(page.locator('.caret')).toHaveCount(1);
    await expect(page.locator('.caret')).toHaveCSS('animation-name', reduce ? 'none' : 'blink');
    await page.getByRole('button', { name: 'Stop' }).click();
  });
}
