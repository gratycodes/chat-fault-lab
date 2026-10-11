/**
 * Typed handling of OpenAI-compatible `chat.completion.chunk` streams.
 *
 * `parseFrame` turns one SSE `data:` payload into a tagged result and never
 * throws. `applyChunk` folds chunks into an assistant draft. Tool calls arrive
 * as fragments keyed by `index`: the id and name usually come first and the
 * JSON arguments are spread over many later chunks.
 */

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export interface ChatChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: { role?: string; content?: string | null; tool_calls?: ToolCallDelta[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

export type Frame =
  | { kind: 'done' }
  | { kind: 'chunk'; chunk: ChatChunk }
  | { kind: 'error'; message: string; type?: string }
  | { kind: 'malformed'; raw: string; reason: string };

export function parseFrame(data: string): Frame {
  const trimmed = data.trim();
  if (trimmed === '[DONE]') return { kind: 'done' };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (err) {
    return { kind: 'malformed', raw: data.slice(0, 200), reason: (err as Error).message };
  }
  if (typeof value !== 'object' || value === null) {
    return { kind: 'malformed', raw: data.slice(0, 200), reason: 'not an object' };
  }
  const obj = value as Record<string, unknown>;
  if (obj.error && typeof obj.error === 'object') {
    const e = obj.error as Record<string, unknown>;
    return {
      kind: 'error',
      message: typeof e.message === 'string' ? e.message : 'Unknown provider error',
      type: typeof e.type === 'string' ? e.type : undefined,
    };
  }
  if (obj.choices !== undefined && !Array.isArray(obj.choices)) {
    return { kind: 'malformed', raw: data.slice(0, 200), reason: 'choices is not an array' };
  }
  return { kind: 'chunk', chunk: obj as ChatChunk };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Draft {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage?: ChatChunk['usage'];
}

export const emptyDraft = (): Draft => ({ content: '', toolCalls: [], finishReason: null });

/** Pure fold. Returns a new draft; never mutates the input. */
export function applyChunk(draft: Draft, chunk: ChatChunk): Draft {
  let next = draft;
  const choice = chunk.choices?.find((c) => c.index === 0) ?? chunk.choices?.[0];
  if (choice) {
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      next = { ...next, content: next.content + delta.content };
    }
    if (delta.tool_calls?.length) {
      const calls = next.toolCalls.slice();
      for (const tc of delta.tool_calls) {
        const existing = calls[tc.index];
        const merged: ToolCall = existing
          ? { ...existing }
          : { id: '', name: '', arguments: '' };
        if (tc.id) merged.id = tc.id;
        if (tc.function?.name) merged.name += tc.function.name;
        if (tc.function?.arguments) merged.arguments += tc.function.arguments;
        calls[tc.index] = merged;
      }
      next = { ...next, toolCalls: calls };
    }
    if (choice.finish_reason) next = { ...next, finishReason: choice.finish_reason };
  }
  if (chunk.usage) next = { ...next, usage: chunk.usage };
  return next;
}

/** Parse tool-call arguments. Partial JSON (mid-stream) returns `undefined`. */
export function tryParseArguments(args: string): Record<string, unknown> | undefined {
  if (!args) return undefined;
  try {
    const v = JSON.parse(args);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Read a retry delay from a 429/503 response, preferring `retry-after-ms`. */
export function retryDelayMs(headers: Headers, fallbackMs: number): number {
  const ms = Number(headers.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const raw = headers.get('retry-after');
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return fallbackMs;
}
