/** Fault scenarios shown in the lab. Pure data so server components can render it. */

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** What the mock backend does. */
  fault: string;
  /** What a robust chat UI should do about it. */
  expected: string;
}

export type ScenarioId =
  | 'steady'
  | 'slow-start'
  | 'stall'
  | 'hang'
  | 'disconnect'
  | 'rate-limit'
  | 'server-error'
  | 'malformed'
  | 'utf8-split'
  | 'tool-call'
  | 'long-code'
  | 'live';

export const SCENARIOS: Scenario[] = [
  {
    id: 'steady',
    title: 'Steady stream',
    fault: 'One word per chunk at a steady pace.',
    expected: 'Screen readers hear whole sentences, not single words. Scrolling up is not undone by new tokens.',
  },
  {
    id: 'slow-start',
    title: 'Slow first token',
    fault: 'Three seconds of silence before the first byte.',
    expected: 'Show and announce that a reply is on its way. Keep Stop available.',
  },
  {
    id: 'stall',
    title: 'Mid-stream stall',
    fault: 'Streams half the reply, sends nothing for five seconds, then finishes.',
    expected: 'Say the stream is waiting, without failing it. Recover when data resumes.',
  },
  {
    id: 'hang',
    title: 'Hung stream',
    fault: 'Streams half the reply and then never sends another byte.',
    expected: 'Give up after an idle timeout, keep the partial reply, offer Retry.',
  },
  {
    id: 'disconnect',
    title: 'Dropped connection',
    fault: 'Closes the connection at 40% with no finish_reason and no [DONE].',
    expected: 'Treat a stream that ends without a terminal event as interrupted, not complete.',
  },
  {
    id: 'rate-limit',
    title: 'Rate limited',
    fault: 'First attempt returns 429 with retry-after-ms.',
    expected: 'Wait the time the server asked for, show a countdown, retry once.',
  },
  {
    id: 'server-error',
    title: 'Error mid-stream',
    fault: 'Sends two sentences, then an error frame, then closes.',
    expected: 'Keep the partial text, mark it failed, announce the error assertively.',
  },
  {
    id: 'malformed',
    title: 'Malformed frame',
    fault: 'Inserts a truncated JSON frame in the middle of the stream.',
    expected: 'Skip the bad frame, log it, finish the reply.',
  },
  {
    id: 'utf8-split',
    title: 'Split UTF-8',
    fault: 'Cuts the byte stream every 5 bytes, splitting ₹, Devanagari and emoji.',
    expected: 'Render every character intact. No replacement characters.',
  },
  {
    id: 'tool-call',
    title: 'Streamed tool call',
    fault: 'Streams a tool call whose JSON arguments arrive two characters at a time.',
    expected: 'Show the call as it forms, run it once the arguments parse, then stream the answer.',
  },
  {
    id: 'long-code',
    title: 'Long code block',
    fault: 'Streams a 60-line code block with an unclosed fence until the end.',
    expected: 'Render the open fence as code while streaming. No layout shift, no scroll hijack.',
  },
  {
    id: 'live',
    title: 'Live provider',
    fault: 'Proxies to a real OpenAI-compatible API. Needs OPENAI_API_KEY on the server.',
    expected: 'Same UI, real model. Not available on the static demo.',
  },
];

export const MOCK_SCENARIOS = SCENARIOS.filter((s) => s.id !== 'live');

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === 'string' && SCENARIOS.some((s) => s.id === v);
}
