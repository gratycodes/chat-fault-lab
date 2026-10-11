/**
 * A deterministic, OpenAI-compatible streaming backend with fault injection.
 *
 * `mockCompletion` returns a standard `Response` whose body is a
 * `text/event-stream` of `chat.completion.chunk` frames. The same function runs
 * inside the Next.js route handler and, for the static GitHub Pages demo,
 * directly in the browser, so both paths stream identical bytes.
 */
import { encodeSseFrame } from './sse';
import type { ScenarioId } from './scenarios';
import type { ConversionResult } from './tools';

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface MockRequest {
  messages: WireMessage[];
  scenario: Exclude<ScenarioId, 'live'>;
  /** Zero-based attempt number. The rate-limit scenario fails attempt 0 only. */
  attempt?: number;
}

export interface MockOptions {
  /** Multiplies every delay. 1 is realistic, 0.25 is used by end-to-end tests. */
  timeScale?: number;
  /** Aborting stops the stream, like a client disconnect. */
  signal?: AbortSignal;
  /** Called once when the stream is cancelled before it finished. */
  onCancel?: (reason: unknown) => void;
}

type Step =
  | { t: 'frame'; data: string }
  | { t: 'raw'; text: string }
  | { t: 'pause'; ms: number }
  | { t: 'cut' };

const TOKEN_MS = 28;
const MODEL = 'mock-fault-lab-1';

export const REPLIES = {
  steady:
    'This reply streams one word at a time, the way most providers send tokens. ' +
    'A screen reader should hear it in whole sentences, not as a stutter of single words. ' +
    'Sighted users still see every word as it lands. ' +
    'Try scrolling up while it streams: the view should stay where you put it until you come back down.',
  slowStart:
    'Sorry for the wait. The first byte took three seconds, so the interface had to show that a reply was coming. ' +
    'From here on the stream runs at a normal pace.',
  stall:
    'The first half of this reply arrives normally. Then the server goes quiet for a while. ' +
    'And now it is back, so the interface should clear its waiting notice and finish the reply normally.',
  disconnect:
    'This reply is going to be cut off partway through, because the server will drop the connection without sending a finish reason or the done marker. ' +
    'A chat UI that treats the end of the byte stream as success will show this half sentence as if it were the full answer, which is exactly the bug this scenario exists to catch.',
  serverError:
    'Here are the first two sentences of an answer. They arrive normally before the provider fails. ',
  malformed:
    'One frame in the middle of this reply is broken JSON. ' +
    'The parser should skip it, record it in the inspector, and keep going. ' +
    'You are reading the rest of the reply, so it did.',
  utf8:
    'The byte stream for this reply is cut every five bytes, so multi-byte characters land in two pieces. ' +
    'Price: ₹10,000 (about €110). Greeting: नमस्ते. Wave: 👋🏽. Done ✅.',
  longCodeIntro: 'Here is a retry helper with jittered exponential backoff. It respects an AbortSignal and a server-provided delay.\n\n',
  longCodeOutro: '\nCall it with the request function and the abort signal from your Stop button.',
};

export function longCodeBlock(): string {
  const lines = [
    '```ts',
    'export interface RetryOptions {',
    '  attempts: number;',
    '  baseMs: number;',
    '  maxMs: number;',
    '  signal?: AbortSignal;',
    '  retryAfterMs?: (err: unknown) => number | undefined;',
    '}',
    '',
    'export async function withRetry<T>(',
    '  fn: (attempt: number) => Promise<T>,',
    '  opts: RetryOptions,',
    '): Promise<T> {',
    '  let lastError: unknown;',
    '  for (let attempt = 0; attempt < opts.attempts; attempt++) {',
    '    opts.signal?.throwIfAborted();',
    '    try {',
    '      return await fn(attempt);',
    '    } catch (err) {',
    '      lastError = err;',
    '      if (attempt === opts.attempts - 1) break;',
    '      const hinted = opts.retryAfterMs?.(err);',
    '      const backoff = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);',
    '      const jitter = Math.random() * backoff * 0.2;',
    '      await sleep(hinted ?? backoff + jitter, opts.signal);',
    '    }',
    '  }',
    '  throw lastError;',
    '}',
    '',
  ];
  for (let i = 1; lines.length < 60; i++) {
    lines.push(`// note ${String(i).padStart(2, '0')}: keep retries idempotent; replay the same request id.`);
  }
  lines.push(
    'function sleep(ms: number, signal?: AbortSignal) {',
    '  return new Promise<void>((resolve, reject) => {',
    '    const t = setTimeout(resolve, ms);',
    "    signal?.addEventListener('abort', () => {",
    '      clearTimeout(t);',
    '      reject(signal.reason);',
    '    }, { once: true });',
    '  });',
    '}',
    '```',
  );
  return lines.join('\n') + '\n';
}

/** Split text into word-sized tokens, keeping whitespace attached. */
export function tokenize(text: string): string[] {
  return text.match(/\s*\S+\s*|\s+/gu) ?? [];
}

let counter = 0;
const chunkId = () => `chatcmpl-mock-${(++counter).toString(36)}`;

function contentFrame(id: string, content: string, role?: string): Step {
  return {
    t: 'frame',
    data: JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      model: MODEL,
      choices: [{ index: 0, delta: role ? { role, content } : { content }, finish_reason: null }],
    }),
  };
}

function finishFrames(id: string, reason: 'stop' | 'tool_calls', completionTokens: number): Step[] {
  return [
    {
      t: 'frame',
      data: JSON.stringify({ id, object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: reason }] }),
    },
    {
      t: 'frame',
      data: JSON.stringify({ id, object: 'chat.completion.chunk', model: MODEL, choices: [], usage: { prompt_tokens: 42, completion_tokens: completionTokens, total_tokens: 42 + completionTokens } }),
    },
    { t: 'frame', data: '[DONE]' },
  ];
}

function textSteps(id: string, text: string): Step[] {
  return tokenize(text).map((tok, i) => contentFrame(id, tok, i === 0 ? 'assistant' : undefined));
}

function lastMessage(messages: WireMessage[]): WireMessage | undefined {
  return messages[messages.length - 1];
}

/** Build the script of steps for a scenario. Exported for tests. */
export function buildScript(req: MockRequest): { status: number; headers?: Record<string, string>; body?: string; steps: Step[]; byteSlice?: number } {
  const id = chunkId();
  const s = req.scenario;
  const done = (text: string) => [...textSteps(id, text), ...finishFrames(id, 'stop', tokenize(text).length)];

  switch (s) {
    case 'steady':
      return { status: 200, steps: done(REPLIES.steady) };
    case 'slow-start':
      return { status: 200, steps: [{ t: 'pause', ms: 3000 }, ...done(REPLIES.slowStart)] };
    case 'stall': {
      const steps = done(REPLIES.stall);
      const cut = tokenize('The first half of this reply arrives normally. Then the server goes quiet for a while. ').length;
      steps.splice(cut, 0, { t: 'pause', ms: 5000 });
      return { status: 200, steps };
    }
    case 'hang': {
      const steps = textSteps(id, REPLIES.stall).slice(0, tokenize('The first half of this reply arrives normally. Then the server goes quiet for a while. ').length);
      return { status: 200, steps: [...steps, { t: 'pause', ms: 10 * 60_000 }] };
    }
    case 'disconnect': {
      const steps = textSteps(id, REPLIES.disconnect);
      return { status: 200, steps: [...steps.slice(0, Math.floor(steps.length * 0.4)), { t: 'cut' }] };
    }
    case 'rate-limit': {
      if ((req.attempt ?? 0) === 0) {
        return {
          status: 429,
          headers: { 'retry-after-ms': '2000', 'retry-after': '2' },
          body: JSON.stringify({ error: { message: 'Rate limit reached for requests. Please retry after 2s.', type: 'rate_limit_error' } }),
          steps: [],
        };
      }
      return { status: 200, steps: done('Second attempt succeeded. The interface waited the two seconds the server asked for instead of hammering it, and told you it was doing so.') };
    }
    case 'server-error':
      return {
        status: 200,
        steps: [
          ...textSteps(id, REPLIES.serverError),
          { t: 'frame', data: JSON.stringify({ error: { message: 'The server had an error while processing your request.', type: 'server_error' } }) },
          { t: 'cut' },
        ],
      };
    case 'malformed': {
      const steps = done(REPLIES.malformed);
      const at = tokenize('One frame in the middle of this reply is broken JSON. ').length;
      steps.splice(at, 0, { t: 'raw', text: 'data: {"id":"broken","choices":[{"index":0,"delta":{"content":"LOST\n\n' });
      return { status: 200, steps };
    }
    case 'utf8-split':
      return { status: 200, steps: done(REPLIES.utf8), byteSlice: 5 };
    case 'tool-call': {
      const last = lastMessage(req.messages);
      if (last?.role === 'tool') {
        let text: string;
        try {
          const r = JSON.parse(last.content ?? '') as ConversionResult;
          text = `${r.amount} ${r.from} is ${r.result.toLocaleString('en-US')} ${r.to} at the demo rate of ${r.rate}. These rates are fixed sample numbers, not market data.`;
        } catch {
          text = 'The tool result could not be read, so I cannot give you a number.';
        }
        return { status: 200, steps: done(text) };
      }
      const args = JSON.stringify({ amount: 120, from: 'EUR', to: 'INR' });
      const frags: Step[] = [];
      for (let i = 0; i < args.length; i += 2) {
        frags.push({
          t: 'frame',
          data: JSON.stringify({ id, object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 2) } }] }, finish_reason: null }] }),
        });
      }
      return {
        status: 200,
        steps: [
          {
            t: 'frame',
            data: JSON.stringify({ id, object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_demo_1', type: 'function', function: { name: 'convert_currency', arguments: '' } }] }, finish_reason: null }] }),
          },
          ...frags,
          ...finishFrames(id, 'tool_calls', frags.length),
        ],
      };
    }
    case 'long-code':
      return { status: 200, steps: done(REPLIES.longCodeIntro + longCodeBlock() + REPLIES.longCodeOutro) };
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export function mockCompletion(req: MockRequest, opts: MockOptions = {}): Response {
  const scale = opts.timeScale ?? 1;
  const script = buildScript(req);

  if (script.status !== 200) {
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const [k, v] of Object.entries(script.headers ?? {})) {
      headers.set(k, k === 'retry-after-ms' ? String(Math.round(Number(v) * scale)) : v);
    }
    return new Response(script.body ?? '', { status: script.status, headers });
  }

  const encoder = new TextEncoder();
  const stop = new AbortController();
  let finished = false;
  const onAbort = () => stop.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = async (bytes: Uint8Array) => {
        if (!script.byteSlice) {
          controller.enqueue(bytes);
          return;
        }
        for (let i = 0; i < bytes.length && !stop.signal.aborted; i += script.byteSlice) {
          controller.enqueue(bytes.slice(i, i + script.byteSlice));
          await abortableSleep(4 * scale, stop.signal);
        }
      };
      try {
        for (const step of script.steps) {
          if (stop.signal.aborted) break;
          if (step.t === 'pause') {
            await abortableSleep(step.ms * scale, stop.signal);
            continue;
          }
          if (step.t === 'cut') break;
          await abortableSleep(TOKEN_MS * scale, stop.signal);
          if (stop.signal.aborted) break;
          await write(encoder.encode(step.t === 'raw' ? step.text : encodeSseFrame(step.data)));
        }
        finished = !stop.signal.aborted;
        if (!stop.signal.aborted) controller.close();
      } catch {
        // The consumer cancelled while we were enqueueing; nothing to do.
      } finally {
        opts.signal?.removeEventListener('abort', onAbort);
        if (stop.signal.aborted && !finished) {
          opts.onCancel?.(stop.signal.reason);
          try {
            controller.close();
          } catch {
            /* already cancelled */
          }
        }
      }
    },
    cancel(reason) {
      stop.abort(reason);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
