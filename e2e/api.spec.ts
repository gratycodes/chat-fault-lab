import { expect, test } from '@playwright/test';
import { target } from './helpers';

test.skip(target === 'static', 'the static export has no server');

test('route handler streams SSE and validates input', async ({ request }) => {
  const ok = await request.post('api/chat', { data: { scenario: 'steady', messages: [{ role: 'user', content: 'hi' }], timeScale: 0.05 } });
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toContain('text/event-stream');
  expect((await ok.text()).trim().endsWith('data: [DONE]')).toBe(true);

  const bad = await request.post('api/chat', { data: { scenario: 'nope', messages: [] } });
  expect(bad.status()).toBe(400);

  const live = await request.post('api/chat', { data: { scenario: 'live', messages: [{ role: 'user', content: 'hi' }] } });
  expect(live.status()).toBe(501);
});
