import { ChatController, type ChatSnapshot } from './chat-controller';
import { REPLIES } from './mock-backend';
import type { ScenarioId } from './scenarios';
import { runDemoTool } from './tools';
import { inBrowserTransport, type Transport } from './transport';

function make(scenario: ScenarioId, extra: Partial<ConstructorParameters<typeof ChatController>[0]> = {}) {
  return new ChatController({
    transport: inBrowserTransport,
    runTool: runDemoTool,
    scenario,
    timeScale: 0.02,
    schedule: (fn) => queueMicrotask(fn),
    ...extra,
  });
}

const last = (s: ChatSnapshot) => s.messages[s.messages.length - 1]!;
const spoken = (s: ChatSnapshot) => s.announcements.map((a) => a.text);

describe('ChatController', () => {
  it('streams a steady reply, batching renders and announcing sentences', async () => {
    const c = make('steady');
    await c.send('hello');
    const s = c.getSnapshot();
    expect(s.status).toBe('done');
    expect(last(s)).toMatchObject({ role: 'assistant', state: 'complete', content: REPLIES.steady });
    expect(s.metrics.contentFrames).toBeGreaterThan(40);
    expect(s.metrics.announcements).toBeLessThan(10);
    expect(spoken(s)[0]).toBe('Assistant is responding.');
    expect(spoken(s).at(-1)).toMatch(/End of reply\.$/);
    expect(s.metrics.firstTokenAt).toBeGreaterThanOrEqual(s.metrics.requestAt!);
  });

  it('ignores empty input and sends while busy', async () => {
    const c = make('steady');
    await c.send('   ');
    expect(c.getSnapshot().messages).toHaveLength(0);
    const p = c.send('one');
    await c.send('two');
    await p;
    expect(c.getSnapshot().messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('marks a dropped connection as interrupted and keeps the partial text', async () => {
    const c = make('disconnect');
    await c.send('x');
    const s = c.getSnapshot();
    expect(s.status).toBe('interrupted');
    expect(last(s).state).toBe('interrupted');
    expect(last(s).content.length).toBeGreaterThan(20);
    expect(s.announcements.at(-1)).toMatchObject({ politeness: 'assertive' });
  });

  it('retry replaces the interrupted reply', async () => {
    const c = make('disconnect');
    await c.send('x');
    c.setScenario('steady');
    await c.retry();
    const s = c.getSnapshot();
    expect(s.status).toBe('done');
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('honours retry-after on 429 and then succeeds', async () => {
    const c = make('rate-limit');
    const states: string[] = [];
    c.subscribe(() => states.push(c.getSnapshot().status));
    await c.send('x');
    const s = c.getSnapshot();
    expect(states).toContain('retrying');
    expect(s.status).toBe('done');
    expect(s.metrics.retries).toBe(1);
    expect(s.log.some((l) => l.kind === 'retry' && l.detail.includes('40 ms'))).toBe(true);
  });

  it('gives up after maxRetries', async () => {
    const always429: Transport = async () => new Response('{"error":{"message":"slow down"}}', { status: 429, headers: { 'retry-after-ms': '1' } });
    const c = make('steady', { transport: always429, maxRetries: 2 });
    await c.send('x');
    expect(c.getSnapshot()).toMatchObject({ status: 'error', error: 'slow down' });
    expect(c.getSnapshot().metrics.retries).toBe(2);
  });

  it('keeps partial text on a mid-stream error frame', async () => {
    const c = make('server-error');
    await c.send('x');
    const s = c.getSnapshot();
    expect(s.status).toBe('error');
    expect(last(s)).toMatchObject({ state: 'error', content: REPLIES.serverError });
  });

  it('skips malformed frames and logs them', async () => {
    const c = make('malformed');
    await c.send('x');
    const s = c.getSnapshot();
    expect(s.status).toBe('done');
    expect(s.metrics.malformed).toBe(1);
    expect(last(s).content).toBe(REPLIES.malformed);
  });

  it('shows a stall notice and recovers when data resumes', async () => {
    const c = make('stall', { stallNoticeMs: 1000, idleTimeoutMs: 20_000 });
    const notices: string[] = [];
    c.subscribe(() => {
      const n = c.getSnapshot().notice;
      if (n) notices.push(n.kind);
    });
    await c.send('x');
    expect(notices).toContain('stalled');
    expect(c.getSnapshot().status).toBe('done');
    expect(c.getSnapshot().log.some((l) => l.detail === 'data resumed')).toBe(true);
  });

  it('times out a hung stream as interrupted', async () => {
    const c = make('hang', { idleTimeoutMs: 1000 });
    await c.send('x');
    const s = c.getSnapshot();
    expect(s.status).toBe('interrupted');
    expect(last(s).content.length).toBeGreaterThan(10);
    expect(s.log.some((l) => l.kind === 'end' && l.detail.includes('gave up'))).toBe(true);
  });

  it('runs a streamed tool call and streams the answer', async () => {
    const runTool = vi.fn(runDemoTool);
    const c = make('tool-call', { runTool });
    await c.send('Convert 120 EUR to INR');
    const s = c.getSnapshot();
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith('convert_currency', { amount: 120, from: 'EUR', to: 'INR' });
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(s.messages[1]!.toolCalls?.[0]?.name).toBe('convert_currency');
    expect(last(s).content).toContain('10,944 INR');
    expect(s.status).toBe('done');
  });

  it('reports tool failures to the model instead of crashing', async () => {
    const c = make('tool-call', { runTool: async () => { throw new Error('rates service down'); } });
    await c.send('x');
    const s = c.getSnapshot();
    expect(s.messages[2]!.content).toContain('rates service down');
    expect(s.status).toBe('done');
  });

  it('stop aborts the stream, cancels the body and keeps the partial reply', async () => {
    let cancelled = false;
    const transport: Transport = async (req, signal) => {
      const res = await inBrowserTransport(req, signal);
      const reader = res.body!.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          const r = await reader.read();
          if (r.done) ctrl.close();
          else ctrl.enqueue(r.value);
        },
        cancel(reason) {
          cancelled = true;
          return reader.cancel(reason);
        },
      });
      return new Response(body, { headers: res.headers });
    };
    const c = make('hang', { transport });
    const p = c.send('x');
    await vi.waitFor(() => expect(c.getSnapshot().status).toBe('streaming'));
    await vi.waitFor(() => expect(last(c.getSnapshot()).content.length).toBeGreaterThan(5));
    c.stop();
    await p;
    const s = c.getSnapshot();
    expect(s.status).toBe('stopped');
    expect(last(s).state).toBe('stopped');
    expect(cancelled).toBe(true);
    expect(spoken(s).at(-1)).toBe('Stopped. The partial reply is kept.');
  });

  it('stop during a retry wait ends cleanly', async () => {
    const c = make('rate-limit', { timeScale: 1 });
    const p = c.send('x');
    await vi.waitFor(() => expect(c.getSnapshot().status).toBe('retrying'));
    c.stop();
    await p;
    expect(c.getSnapshot().status).toBe('stopped');
  });

  it('decodes split UTF-8 without replacement characters', async () => {
    const c = make('utf8-split');
    await c.send('x');
    expect(last(c.getSnapshot()).content).toBe(REPLIES.utf8);
  });

  it('turns network failures into a readable error', async () => {
    const c = make('steady', { transport: async () => { throw new TypeError('Failed to fetch'); } });
    await c.send('x');
    expect(c.getSnapshot().error).toBe('Network error: Failed to fetch');
  });

  it('clear resets everything', async () => {
    const c = make('steady');
    await c.send('x');
    c.clear();
    expect(c.getSnapshot()).toMatchObject({ messages: [], status: 'idle', log: [] });
  });
});
