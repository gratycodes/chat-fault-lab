import { defineConfig, devices } from '@playwright/test';

// E2E_TARGET=server (default): `next start`, mock backend behind the route handler.
// E2E_TARGET=static: the GitHub Pages export, mock backend in the browser.
const target = process.env.E2E_TARGET === 'static' ? 'static' : 'server';
const port = target === 'static' ? 3418 : 3417;
const baseURL = target === 'static' ? `http://localhost:${port}/chat-fault-lab/` : `http://localhost:${port}/`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  metadata: { target },
  projects: [{ name: `chromium-${target}`, use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      target === 'static'
        ? `npm run build:static && node scripts/serve-static.mjs`
        : `npm run build && npx next start -p ${port}`,
    url: baseURL,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
