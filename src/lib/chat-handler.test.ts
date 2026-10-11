import { handleChat } from './chat-handler';

const post = (body: unknown, signal?: AbortSignal) =>
  new Request('http://local/api/chat', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), signal });

const okBody = { scenario: 'steady', messages: [{ role: 'user', content: 'hi' }], timeScale: 0.05 };

describe('handleChat', () => {
  it('rejects bad JSON, unknown scenarios and bad messages', async () => {
    expect((await handleChat(post('{'), {})).status).toBe(400);
    expect((await handleChat(post({ ...okBody, scenario: 'nope' }), {})).status).toBe(400);
    expect((await handleChat(post({ ...okBody, messages: [] }), {})).status).toBe(400);
    expect((await handleChat(post({ ...okBody, messages: [{ role: 'root', content: 'x' }] }), {})).status).toBe(400);
    expect((await handleChat(post({ ...okBody, messages: [{ role: 'user', content: 'x'.repeat(20_001) }] }), {})).status).toBe(400);
  });

  it('streams mock scenarios as text/event-stream', async () => {
    const res = await handleChat(post(okBody), {});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('passes the rate-limit headers through', async () => {
    const res = await handleChat(post({ ...okBody, scenario: 'rate-limit', attempt: 0 }), {});
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after-ms')).toBe('100');
  });

  it('returns 501 for live mode without a key and never calls upstream', async () => {
    const fetchImpl = vi.fn();
    const res = await handleChat(post({ ...okBody, scenario: 'live' }), {}, fetchImpl);
    expect(res.status).toBe(501);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('proxies live mode with the key, tools, stream flag and abort signal', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream', 'retry-after-ms': '5', 'set-cookie': 'x=1' } }),
    );
    const res = await handleChat(post({ ...okBody, scenario: 'live' }), { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: 'https://example.test/v1/', OPENAI_MODEL: 'm' }, fetchImpl as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get('retry-after-ms')).toBe('5');
    expect(res.headers.get('set-cookie')).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ model: 'm', stream: true, tools: [{ function: { name: 'convert_currency' } }] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps upstream network errors to 502 without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await handleChat(post({ ...okBody, scenario: 'live' }), { OPENAI_API_KEY: 'sk-secret' }, fetchImpl as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('sk-secret');
  });
});
