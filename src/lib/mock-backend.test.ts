import { createSseParser } from './sse';
import { applyChunk, emptyDraft, parseFrame, type Draft } from './openai';
import { mockCompletion, REPLIES, tokenize, type MockRequest } from './mock-backend';

const user = (content: string) => [{ role: 'user' as const, content }];

async function collect(res: Response) {
  const parser = createSseParser();
  const reader = res.body!.getReader();
  let draft: Draft = emptyDraft();
  let done = false;
  let malformed = 0;
  let errors: string[] = [];
  let chunks = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    chunks += 1;
    for (const ev of parser.push(value)) {
      const f = parseFrame(ev.data);
      if (f.kind === 'done') done = true;
      else if (f.kind === 'chunk') draft = applyChunk(draft, f.chunk);
      else if (f.kind === 'malformed') malformed += 1;
      else errors = [...errors, f.message];
    }
  }
  return { draft, done, malformed, errors, chunks, truncated: parser.end().truncated };
}

const run = (req: Partial<MockRequest> & Pick<MockRequest, 'scenario'>) =>
  mockCompletion({ messages: user('hi'), ...req }, { timeScale: 0.01 });

describe('mockCompletion', () => {
  it('streams a complete steady reply with [DONE] and usage', async () => {
    const r = await collect(run({ scenario: 'steady' }));
    expect(r.draft.content).toBe(REPLIES.steady);
    expect(r.draft.finishReason).toBe('stop');
    expect(r.draft.usage?.completion_tokens).toBe(tokenize(REPLIES.steady).length);
    expect(r.done).toBe(true);
  });

  it('disconnect ends with neither finish_reason nor [DONE]', async () => {
    const r = await collect(run({ scenario: 'disconnect' }));
    expect(r.done).toBe(false);
    expect(r.draft.finishReason).toBeNull();
    expect(r.draft.content.length).toBeGreaterThan(20);
    expect(r.draft.content.length).toBeLessThan(REPLIES.disconnect.length * 0.6);
  });

  it('rate-limit fails attempt 0 with scaled retry-after-ms, then succeeds', async () => {
    const first = mockCompletion({ messages: user('x'), scenario: 'rate-limit', attempt: 0 }, { timeScale: 0.5 });
    expect(first.status).toBe(429);
    expect(first.headers.get('retry-after-ms')).toBe('1000');
    expect((await first.json()).error.type).toBe('rate_limit_error');
    const second = await collect(run({ scenario: 'rate-limit', attempt: 1 }));
    expect(second.done).toBe(true);
  });

  it('server-error sends an error frame after partial content', async () => {
    const r = await collect(run({ scenario: 'server-error' }));
    expect(r.draft.content).toBe(REPLIES.serverError);
    expect(r.errors).toHaveLength(1);
    expect(r.done).toBe(false);
  });

  it('malformed inserts exactly one bad frame and still completes', async () => {
    const r = await collect(run({ scenario: 'malformed' }));
    expect(r.malformed).toBe(1);
    expect(r.draft.content).toBe(REPLIES.malformed);
    expect(r.draft.content).not.toContain('LOST');
    expect(r.done).toBe(true);
  });

  it('utf8-split delivers 5-byte slices that still decode cleanly', async () => {
    const r = await collect(run({ scenario: 'utf8-split' }));
    expect(r.chunks).toBeGreaterThan(100);
    expect(r.draft.content).toBe(REPLIES.utf8);
    expect(r.draft.content).not.toContain('\uFFFD');
  });

  it('tool-call streams fragmented arguments, then answers from the tool result', async () => {
    const first = await collect(run({ scenario: 'tool-call' }));
    expect(first.draft.finishReason).toBe('tool_calls');
    expect(first.draft.toolCalls).toEqual([{ id: 'call_demo_1', name: 'convert_currency', arguments: '{"amount":120,"from":"EUR","to":"INR"}' }]);

    const toolResult = JSON.stringify({ amount: 120, from: 'EUR', to: 'INR', rate: 91.2, result: 10944 });
    const second = await collect(
      mockCompletion(
        {
          scenario: 'tool-call',
          messages: [
            { role: 'user', content: 'convert' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'call_demo_1', type: 'function', function: { name: 'convert_currency', arguments: '{}' } }] },
            { role: 'tool', content: toolResult, tool_call_id: 'call_demo_1' },
          ],
        },
        { timeScale: 0.01 },
      ),
    );
    expect(second.draft.content).toContain('10,944 INR');
  });

  it('long-code streams a closed 60+ line fence', async () => {
    const r = await collect(run({ scenario: 'long-code' }));
    const fences = r.draft.content.match(/```/g) ?? [];
    expect(fences).toHaveLength(2);
    expect(r.draft.content.split('\n').length).toBeGreaterThan(60);
  });

  it('stops producing and calls onCancel when the signal aborts', async () => {
    const ac = new AbortController();
    const onCancel = vi.fn();
    const res = mockCompletion({ messages: user('x'), scenario: 'hang' }, { timeScale: 0.01, signal: ac.signal, onCancel });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort(new Error('client went away'));
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('stops when the consumer cancels the body', async () => {
    const onCancel = vi.fn();
    const res = mockCompletion({ messages: user('x'), scenario: 'hang' }, { timeScale: 0.01, onCancel });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel('stop button');
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledWith('stop button'));
  });
});
