/**
 * How the chat reaches a backend. Both transports return a standard Response
 * with an SSE body, so the controller cannot tell them apart.
 */
import { mockCompletion, type WireMessage } from './mock-backend';
import type { ScenarioId } from './scenarios';

export interface TransportRequest {
  messages: WireMessage[];
  scenario: ScenarioId;
  attempt: number;
  timeScale: number;
}

export type Transport = (req: TransportRequest, signal: AbortSignal) => Promise<Response>;

/** POSTs to the Next.js route handler. Used by `next start` / `next dev`. */
export function fetchTransport(endpoint = '/api/chat'): Transport {
  return (req, signal) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
}

/**
 * Runs the mock backend inside the page. Used by the static GitHub Pages
 * export, which has no server. Same bytes, same timing, no network.
 */
export const inBrowserTransport: Transport = async (req, signal) => {
  signal.throwIfAborted();
  if (req.scenario === 'live') {
    return Response.json(
      { error: { message: 'Live mode needs the Next.js server and OPENAI_API_KEY. The static demo only has mock scenarios.', type: 'not_configured' } },
      { status: 501 },
    );
  }
  return mockCompletion({ messages: req.messages, scenario: req.scenario, attempt: req.attempt }, { timeScale: req.timeScale, signal });
};
