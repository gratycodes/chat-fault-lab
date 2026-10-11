import { SentenceAnnouncer, toSpeakable } from './announcer';
import { REPLIES, tokenize } from './mock-backend';

describe('toSpeakable', () => {
  it('summarises closed code blocks and hides open ones', () => {
    expect(toSpeakable('Intro.\n```ts\na\nb\n```\nAfter.')).toBe('Intro.\nCode block, 2 lines.\nAfter.');
    expect(toSpeakable('Intro.\n```ts\na\nb')).toBe('Intro.');
    expect(toSpeakable('Intro.\n``')).toBe('Intro.');
  });

  it('is prefix-stable as text grows', () => {
    const full = REPLIES.longCodeIntro + '```ts\nconst a = 1;\n```\nDone.';
    let prev = '';
    for (let i = 1; i <= full.length; i++) {
      const cur = toSpeakable(full.slice(0, i));
      expect(cur.startsWith(prev.trimEnd()) || prev === '').toBe(true);
      prev = cur;
    }
  });
});

describe('SentenceAnnouncer', () => {
  it('announces whole sentences only, far fewer times than tokens arrive', () => {
    const a = new SentenceAnnouncer({ minIntervalMs: 0 });
    const out: string[] = [];
    let text = '';
    let t = 0;
    for (const tok of tokenize(REPLIES.steady)) {
      text += tok;
      const said = a.update(text, (t += 30));
      if (said) out.push(said);
    }
    const last = a.finish(text);
    if (last) out.push(last);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(tokenize(REPLIES.steady).length).toBeGreaterThan(40);
    for (const s of out) expect(s).toMatch(/[.!?:]$/);
    expect(out.join(' ')).toBe(REPLIES.steady.replace(/\s+/g, ' ').trim());
  });

  it('respects the minimum interval by batching sentences', () => {
    const a = new SentenceAnnouncer({ minIntervalMs: 1000 });
    expect(a.update('One. ', 0)).toBe('One.');
    expect(a.update('One. Two. ', 100)).toBeNull();
    expect(a.update('One. Two. Three. ', 1200)).toBe('Two. Three.');
  });

  it('falls back to a word boundary for long text without punctuation', () => {
    const a = new SentenceAnnouncer({ minIntervalMs: 0, maxChars: 20 });
    const said = a.update('alpha beta gamma delta epsilon zeta', 0);
    expect(said).toBe('alpha beta gamma');
  });

  it('never reads code character by character', () => {
    const a = new SentenceAnnouncer({ minIntervalMs: 0 });
    const full = 'Here is code.\n```ts\nconst x = 1;\nconst y = 2;\n```\nThat is all.';
    const out: string[] = [];
    for (let i = 1; i <= full.length; i++) {
      const s = a.update(full.slice(0, i), i * 50);
      if (s) out.push(s);
    }
    const end = a.finish(full);
    if (end) out.push(end);
    expect(out.join(' ')).toBe('Here is code. Code block, 2 lines. That is all.');
    expect(out.join(' ')).not.toContain('const');
  });

  it('reset starts over', () => {
    const a = new SentenceAnnouncer({ minIntervalMs: 0 });
    a.update('Hi there. ', 0);
    a.reset();
    expect(a.update('New one. ', 1)).toBe('New one.');
  });
});
