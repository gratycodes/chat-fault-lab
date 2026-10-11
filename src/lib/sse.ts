/**
 * Incremental Server-Sent Events parser.
 *
 * Network chunks do not line up with SSE frames: a frame can arrive in many
 * pieces, several frames can arrive in one piece, and a multi-byte UTF-8
 * character can be split between two pieces. This parser takes raw bytes,
 * decodes them with a streaming TextDecoder and emits whole events only.
 *
 * Follows the WHATWG "event stream interpretation" rules for the fields that
 * chat APIs use: data, event, id, comments, and CRLF / LF / CR line endings.
 */

export interface SseEvent {
  /** Value of the `event:` field, if any. */
  event?: string;
  /** All `data:` lines of the frame joined with "\n". */
  data: string;
  /** Value of the last `id:` field seen. */
  id?: string;
}

export interface SseParser {
  /** Feed raw bytes. Returns the events completed by these bytes. */
  push(bytes: Uint8Array): SseEvent[];
  /** Feed already-decoded text. Returns the events completed by this text. */
  pushText(text: string): SseEvent[];
  /**
   * Call when the byte stream ends. Returns `{ truncated: true }` if a frame
   * was started but never terminated by a blank line. Per the spec that frame
   * is discarded, but callers usually want to know it happened.
   */
  end(): { truncated: boolean };
  /** Comment lines (`: keep-alive`) seen so far. Useful for stall detection. */
  readonly comments: number;
}

export function createSseParser(): SseParser {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let data: string[] = [];
  let eventName: string | undefined;
  let lastId: string | undefined;
  let sawField = false;
  let comments = 0;

  function processLine(line: string, out: SseEvent[]) {
    if (line === '') {
      if (data.length > 0) {
        out.push({ event: eventName, data: data.join('\n'), id: lastId });
      }
      data = [];
      eventName = undefined;
      sawField = false;
      return;
    }
    if (line.startsWith(':')) {
      comments += 1;
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    sawField = true;
    switch (field) {
      case 'data':
        data.push(value);
        break;
      case 'event':
        eventName = value;
        break;
      case 'id':
        if (!value.includes('\u0000')) lastId = value;
        break;
      default:
        // `retry` and unknown fields are ignored.
        break;
    }
  }

  function drain(): SseEvent[] {
    const out: SseEvent[] = [];
    let start = 0;
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === '\n' || ch === '\r') {
        // A trailing CR might be the first half of a CRLF split across chunks.
        if (ch === '\r' && i === buffer.length - 1) break;
        processLine(buffer.slice(start, i), out);
        if (ch === '\r' && buffer[i + 1] === '\n') i += 1;
        start = i + 1;
      }
    }
    buffer = buffer.slice(start);
    return out;
  }

  return {
    push(bytes) {
      buffer += decoder.decode(bytes, { stream: true });
      return drain();
    },
    pushText(text) {
      buffer += text;
      return drain();
    },
    end() {
      buffer += decoder.decode();
      const pendingLine = buffer.length > 0 && buffer !== '\r';
      if (buffer === '\r') {
        processLine('', []);
        buffer = '';
      }
      const truncated = pendingLine || data.length > 0 || sawField;
      buffer = '';
      data = [];
      sawField = false;
      return { truncated };
    },
    get comments() {
      return comments;
    },
  };
}

/** Encode one SSE frame. */
export function encodeSseFrame(data: string, event?: string): string {
  const lines = data.split('\n').map((l) => `data: ${l}`);
  return `${event ? `event: ${event}\n` : ''}${lines.join('\n')}\n\n`;
}
