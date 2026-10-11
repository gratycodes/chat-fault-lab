'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChatController, isBusy } from '@/lib/chat-controller';
import type { Scenario, ScenarioId } from '@/lib/scenarios';
import { runDemoTool } from '@/lib/tools';
import { fetchTransport, inBrowserTransport, type Transport } from '@/lib/transport';
import { Composer } from './Composer';
import { Inspector } from './Inspector';
import { LiveRegions } from './LiveRegions';
import { Message } from './Message';
import { StatusBar } from './StatusBar';
import { useFollow } from './useFollow';

const PROMPTS: Partial<Record<ScenarioId, string>> = {
  'tool-call': 'Convert 120 EUR to INR',
  'long-code': 'Write a retry helper with backoff',
};

const SPEEDS = { realistic: 1, fast: 0.25 } as const;
type Speed = keyof typeof SPEEDS;

const noopSubscribe = () => () => {};

export function Lab({ scenarios, transport }: { scenarios: Scenario[]; transport?: Transport }) {
  const [controller] = useState(
    () =>
      new ChatController({
        transport: transport ?? (process.env.NEXT_PUBLIC_TRANSPORT === 'browser' ? inBrowserTransport : fetchTransport('/api/chat')),
        runTool: runDemoTool,
      }),
  );
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // Deep links for demos and tests: ?scenario=disconnect&speed=fast. Read via
  // useSyncExternalStore so the server render and hydration agree.
  const search = useSyncExternalStore(noopSubscribe, () => window.location.search, () => '');
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const [pickedScenario, setScenario] = useState<ScenarioId | null>(null);
  const [pickedSpeed, setSpeed] = useState<Speed | null>(null);
  const qs = query.get('scenario');
  const qsp = query.get('speed');
  const scenario: ScenarioId = pickedScenario ?? (scenarios.find((x) => x.id === qs)?.id ?? 'steady');
  const speed: Speed = pickedSpeed ?? (qsp === 'fast' ? 'fast' : 'realistic');
  const { scrollRef, contentRef, following, jumpToLatest, pin } = useFollow<HTMLDivElement, HTMLOListElement>();

  useEffect(() => controller.setScenario(scenario), [controller, scenario]);
  useEffect(() => controller.setTimeScale(SPEEDS[speed]), [controller, speed]);
  useEffect(() => () => controller.stop(), [controller]);

  const busy = isBusy(snap.status);
  const current = useMemo(() => scenarios.find((s) => s.id === scenario), [scenarios, scenario]);
  const canRetry = !busy && (snap.status === 'interrupted' || snap.status === 'error' || snap.status === 'stopped');

  return (
    <div className="lab">
      <section className="panel" aria-labelledby="scenarios-h">
        <h2 id="scenarios-h" className="sr-only">
          Scenario
        </h2>
        <fieldset disabled={busy}>
          <legend>Failure to inject</legend>
          <div className="scenario-list">
            {scenarios.map((s) => (
              <label key={s.id} className="scenario-option">
                <input type="radio" name="scenario" value={s.id} checked={scenario === s.id} onChange={() => setScenario(s.id)} />
                <span>
                  <span className="title">{s.title}</span>
                  <span className="fault">{s.fault}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {current && (
          <p className="scenario-expect">
            <strong>Expected: </strong>
            {current.expected}
          </p>
        )}
        <div className="controls">
          <label>
            Timing{' '}
            <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)} disabled={busy}>
              <option value="realistic">Realistic</option>
              <option value="fast">4× faster</option>
            </select>
          </label>
          <button type="button" onClick={() => controller.clear()} disabled={busy}>
            Clear
          </button>
        </div>
      </section>

      <section className="chat" aria-labelledby="chat-h">
        <h2 id="chat-h" className="sr-only">
          Conversation
        </h2>
        <div ref={scrollRef} className="transcript" tabIndex={0} aria-label="Conversation transcript" data-testid="transcript">
          <ol ref={contentRef}>
            {snap.messages.length === 0 && <li className="empty">No messages yet. Pick a failure and send something.</li>}
            {snap.messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
          </ol>
          {!following && snap.messages.length > 0 && (
            <button type="button" className="jump" onClick={jumpToLatest}>
              Jump to latest ↓
            </button>
          )}
        </div>
        <StatusBar status={snap.status} notice={snap.notice} error={snap.error} />
        <Composer
          key={scenario}
          busy={busy}
          canRetry={canRetry}
          defaultValue={PROMPTS[scenario] ?? 'Explain what you are testing.'}
          onSend={(t) => {
            pin();
            void controller.send(t);
          }}
          onStop={() => controller.stop()}
          onRetry={() => {
            pin();
            void controller.retry();
          }}
        />
      </section>

      <Inspector snap={snap} />
      <LiveRegions announcements={snap.announcements} />
    </div>
  );
}
