import { expect, type Page } from '@playwright/test';

export const target = process.env.E2E_TARGET === 'static' ? 'static' : 'server';

export async function openScenario(page: Page, scenario: string, speed: 'fast' | 'realistic' = 'fast') {
  await page.goto(`./?scenario=${scenario}&speed=${speed}`);
  await expect(page.getByRole('radio', { checked: true })).toHaveValue(scenario);
}

export async function send(page: Page) {
  await page.getByRole('button', { name: 'Send' }).click();
}

export async function waitForStatus(page: Page, status: string, timeout = 15_000) {
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', status, { timeout });
}

export const assistant = (page: Page) => page.locator('[data-testid=transcript] li[data-role=assistant]').last();
