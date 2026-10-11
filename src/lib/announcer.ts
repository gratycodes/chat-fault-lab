/**
 * Decides what a screen reader should be told while a reply streams.
 *
 * Pointing aria-live at the node that receives tokens makes screen readers
 * announce every partial update. Instead the visible text streams silently and
 * this class releases whole sentences to a separate live region, at most once
 * per `minIntervalMs`. Code blocks are summarised ("Code block, 12 lines.")
 * rather than read character by character, and an open fence is held back
 * until it closes.
 */

const FENCE = /^ {0,3}(```|~~~)/;

/**
 * Turn markdown-ish text into what should be spoken. Prefix-stable: as long as
 * `text` only grows at the end, the result only grows at the end.
 */
export function toSpeakable(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      if (!inFence) {
        inFence = true;
        fenceLines = 0;
      } else {
        inFence = false;
        out.push(`Code block, ${fenceLines} ${fenceLines === 1 ? 'line' : 'lines'}.`);
      }
      continue;
    }
    if (inFence) {
      fenceLines += 1;
      continue;
    }
    // A fence marker that has not finished arriving ("`" or "``") is held back.
    if (i === lines.length - 1 && /^ {0,3}`{1,2}$/.test(line)) break;
    out.push(line);
  }
  // Lines inside a still-open fence were skipped above, so this holds the code back.
  return out.join('\n');
}

export interface AnnouncerOptions {
  /** Minimum gap between announcements. Default 1200 ms. */
  minIntervalMs?: number;
  /** Speak at a word boundary if this many characters pile up with no sentence end. */
  maxChars?: number;
}

// Sentence end: . ! ? … optionally followed by closing quotes/brackets, then whitespace.
const BOUNDARY = /[.!?…]["'”’)\]]*\s+|\n{2,}/g;

export class SentenceAnnouncer {
  private spoken = 0;
  private lastAt = Number.NEGATIVE_INFINITY;
  private readonly minIntervalMs: number;
  private readonly maxChars: number;

  constructor(opts: AnnouncerOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 1200;
    this.maxChars = opts.maxChars ?? 320;
  }

  /** Call with the full text so far. Returns text to announce now, or null. */
  update(fullText: string, now: number): string | null {
    const speakable = toSpeakable(fullText);
    const rest = speakable.slice(this.spoken);
    if (!rest.trim()) return null;
    if (now - this.lastAt < this.minIntervalMs) return null;

    let cut = -1;
    for (const m of rest.matchAll(BOUNDARY)) cut = m.index! + m[0].length;
    if (cut === -1 && rest.length > this.maxChars) {
      const space = rest.lastIndexOf(' ', this.maxChars);
      cut = space > 0 ? space + 1 : this.maxChars;
    }
    if (cut === -1) return null;
    const text = clean(rest.slice(0, cut));
    this.spoken += cut;
    if (!text) return null;
    this.lastAt = now;
    return text;
  }

  /** Call when the stream ends. Returns anything not yet spoken. */
  finish(fullText: string): string | null {
    const speakable = toSpeakable(fullText);
    const text = clean(speakable.slice(this.spoken));
    this.spoken = speakable.length;
    return text || null;
  }

  reset(): void {
    this.spoken = 0;
    this.lastAt = Number.NEGATIVE_INFINITY;
  }
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
