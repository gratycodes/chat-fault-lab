/**
 * Request handling for POST /api/chat, kept out of the route file so it can be
 * unit-tested with plain Request objects.
 *
 * Mock scenarios stream from `mockCompletion`. The `live` scenario proxies to
 * an OpenAI-compatible API and passes the client's abort signal upstream, so
 * pressing Stop in the browser also stops the paid generation.
 */
import { mockCompletion, type WireMessage } from './mock-backend';
import { isScenarioId } from './scenarios';
import { convertCurrencyTool } from './tools';

export interface HandlerEnv {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

const MAX_MESSAGES = 40;
const MAX_CHARS = 20_000;

function jsonError(status: number, message: string, type = 'invalid_request_error'): Response {
  return Response.json({ error: { message, type } }, { status });
}

function validMessages(v: unknown): v is WireMessage[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_MESSAGES) return false;
  let chars = 0;
  for (const m of v) {
    if (typeof m !== 'object' || m === null) return false;
    const { role, content } = m as Record<string, unknown>;
    if (!['system', 'user', 'assistant', 'tool'].includes(role as string)) return false;
    if (content !== null && typeof content !== 'string') return false;
    chars += typeof content === 'string' ? content.length : 0;
  }
  return chars <= MAX_CHARS;
}

export async function handleChat(request: Request, env: HandlerEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Body must be JSON.');
  }
  const { messages, scenario, attempt, timeScale } = (body ?? {}) as Record<string, unknown>;
  if (!isScenarioId(scenario)) return jsonError(400, 'Unknown scenario.');
  if (!validMessages(messages)) return jsonError(400, `messages must be 1-${MAX_MESSAGES} chat messages, at most ${MAX_CHARS} characters.`);

  if (scenario !== 'live') {
    const scale = typeof timeScale === 'number' && timeScale >= 0.05 && timeScale <= 4 ? timeScale : 1;
    return mockCompletion(
      { messages, scenario, attempt: typeof attempt === 'number' ? attempt : 0 },
      { timeScale: scale, signal: request.signal },
    );
  }

  if (!env.OPENAI_API_KEY) {
    return jsonError(501, 'Live mode needs OPENAI_API_KEY on the server. The mock scenarios work without it.', 'not_configured');
  }
  const base = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  let upstream: Response;
  try {
    upstream = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
        messages,
        stream: true,
        stream_options: { include_usage: true },
        tools: [convertCurrencyTool],
      }),
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return jsonError(502, `Upstream request failed: ${(err as Error).message}`, 'upstream_error');
  }
  const headers = new Headers({ 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache, no-transform' });
  for (const h of ['retry-after', 'retry-after-ms']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
