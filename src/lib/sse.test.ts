import { createSseParser, encodeSseFrame } from './sse';

const enc = new TextEncoder();

describe('createSseParser', () => {
  it('parses whole frames', () => {
    const p = createSseParser();
    const events = p.pushText('data: one\n\ndata: two\n\n');
    expect(events.map((e) => e.data)).toEqual(['one', 'two']);
    expect(p.end().truncated).toBe(false);
  });

  it('joins frames split across many chunks', () => {
    const p = createSseParser();
    const text = 'data: {"a":1}\n\n';
    const out = [...text].flatMap((ch) => p.pushText(ch));
    expect(out).toEqual([{ event: undefined, data: '{"a":1}', id: undefined }]);
  });

  it('handles CRLF and a CR split from its LF', () => {
    const p = createSseParser();
    expect(p.pushText('data: x\r')).toEqual([]);
    const out = [...p.pushText('\n\r'), ...p.pushText('\n')];
    expect(out.map((e) => e.data)).toEqual(['x']);
  });

  it('handles bare CR line endings', () => {
    const p = createSseParser();
    const out = p.pushText('data: a\r\rdata: b\r\r ');
    expect(out.map((e) => e.data)).toEqual(['a', 'b']);
  });

  it('joins multi-line data and keeps event names and ids', () => {
    const p = createSseParser();
    const [e] = p.pushText('event: error\nid: 7\ndata: line1\ndata: line2\n\n');
    expect(e).toEqual({ event: 'error', data: 'line1\nline2', id: '7' });
  });

  it('counts comments and ignores them as data', () => {
    const p = createSseParser();
    const out = p.pushText(': keep-alive\n\n: OPENROUTER PROCESSING\n\ndata: ok\n\n');
    expect(out.map((e) => e.data)).toEqual(['ok']);
    expect(p.comments).toBe(2);
  });

  it('strips only one leading space from values', () => {
    const p = createSseParser();
    const [e] = p.pushText('data:  two spaces\n\n');
    expect(e?.data).toBe(' two spaces');
  });

  it('decodes multi-byte characters split across byte chunks', () => {
    const p = createSseParser();
    const bytes = enc.encode('data: ₹ नमस्ते 👋🏽\n\n');
    const out = [];
    for (let i = 0; i < bytes.length; i++) out.push(...p.push(bytes.slice(i, i + 1)));
    expect(out[0]?.data).toBe('₹ नमस्ते 👋🏽');
    expect(out[0]?.data).not.toContain('\uFFFD');
  });

  it('reports a truncated final frame', () => {
    const p = createSseParser();
    p.pushText('data: {"choices":[{"delta":{"content":"half');
    expect(p.end().truncated).toBe(true);
  });

  it('reports a frame with data lines but no terminating blank line', () => {
    const p = createSseParser();
    p.pushText('data: complete line\n');
    expect(p.end().truncated).toBe(true);
  });

  it('round-trips encodeSseFrame', () => {
    const p = createSseParser();
    const out = p.pushText(encodeSseFrame('a\nb', 'message'));
    expect(out).toEqual([{ event: 'message', data: 'a\nb', id: undefined }]);
  });
});
