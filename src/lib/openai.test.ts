import { applyChunk, emptyDraft, parseFrame, retryDelayMs, tryParseArguments, type ChatChunk } from './openai';

const content = (text: string): ChatChunk => ({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });

describe('parseFrame', () => {
  it('recognises [DONE]', () => {
    expect(parseFrame('[DONE]')).toEqual({ kind: 'done' });
  });
  it('parses a chunk', () => {
    const f = parseFrame(JSON.stringify(content('hi')));
    expect(f.kind).toBe('chunk');
  });
  it('turns an error payload into an error frame', () => {
    const f = parseFrame('{"error":{"message":"boom","type":"server_error"}}');
    expect(f).toEqual({ kind: 'error', message: 'boom', type: 'server_error' });
  });
  it('flags truncated JSON as malformed instead of throwing', () => {
    const f = parseFrame('{"choices":[{"delta":{"content":"oo');
    expect(f.kind).toBe('malformed');
  });
  it('flags non-object JSON and bad choices as malformed', () => {
    expect(parseFrame('42').kind).toBe('malformed');
    expect(parseFrame('{"choices":"x"}').kind).toBe('malformed');
  });
});

describe('applyChunk', () => {
  it('appends content and keeps the input untouched', () => {
    const a = emptyDraft();
    const b = applyChunk(a, content('Hel'));
    const c = applyChunk(b, content('lo'));
    expect(c.content).toBe('Hello');
    expect(a.content).toBe('');
  });

  it('assembles tool calls from fragments by index', () => {
    let d = emptyDraft();
    const frags: ChatChunk[] = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'convert_currency', arguments: '' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"amo' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call_2', function: { name: 'now', arguments: '{}' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'unt":5}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    for (const f of frags) d = applyChunk(d, f);
    expect(d.toolCalls).toEqual([
      { id: 'call_1', name: 'convert_currency', arguments: '{"amount":5}' },
      { id: 'call_2', name: 'now', arguments: '{}' },
    ]);
    expect(d.finishReason).toBe('tool_calls');
  });

  it('ignores null content and records usage', () => {
    let d = applyChunk(emptyDraft(), { choices: [{ index: 0, delta: { content: null } }] });
    d = applyChunk(d, { choices: [], usage: { total_tokens: 12 } });
    expect(d.content).toBe('');
    expect(d.usage?.total_tokens).toBe(12);
  });
});

describe('tryParseArguments', () => {
  it('returns undefined for partial JSON and arrays', () => {
    expect(tryParseArguments('{"a":')).toBeUndefined();
    expect(tryParseArguments('[1]')).toBeUndefined();
    expect(tryParseArguments('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('retryDelayMs', () => {
  it('prefers retry-after-ms, then seconds, then fallback', () => {
    expect(retryDelayMs(new Headers({ 'retry-after-ms': '750', 'retry-after': '9' }), 1)).toBe(750);
    expect(retryDelayMs(new Headers({ 'retry-after': '2' }), 1)).toBe(2000);
    expect(retryDelayMs(new Headers(), 1234)).toBe(1234);
  });
  it('accepts an HTTP date', () => {
    const at = new Date(Date.now() + 5000).toUTCString();
    const ms = retryDelayMs(new Headers({ 'retry-after': at }), 0);
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThanOrEqual(5000);
  });
});
