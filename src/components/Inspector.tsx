'use client';

import { memo } from 'react';
import type { ChatSnapshot } from '@/lib/chat-controller';

function ms(a?: number, b?: number) {
  return a !== undefined && b !== undefined ? `${Math.max(0, Math.round(b - a))} ms` : '—';
}

export const Inspector = memo(function Inspector({ snap }: { snap: ChatSnapshot }) {
  const m = snap.metrics;
  const spoken = snap.announcements;
  const t0 = snap.log[0]?.at ?? 0;
  return (
    <aside className="inspector" aria-label="Inspector">
      <section className="panel" aria-labelledby="metrics-h">
        <h2 id="metrics-h">This turn</h2>
        <dl data-testid="metrics">
          <dt>Time to first token</dt>
          <dd data-testid="ttft">{ms(m.requestAt, m.firstTokenAt)}</dd>
          <dt>Total</dt>
          <dd>{ms(m.requestAt, m.endAt)}</dd>
          <dt>Content frames</dt>
          <dd data-testid="frames">{m.contentFrames}</dd>
          <dt>Renders</dt>
          <dd data-testid="commits">{m.commits}</dd>
          <dt>Announcements</dt>
          <dd data-testid="announcements">{m.announcements}</dd>
          <dt>Malformed frames</dt>
          <dd data-testid="malformed">{m.malformed}</dd>
          <dt>Retries</dt>
          <dd>{m.retries}</dd>
        </dl>
        {m.contentFrames > 0 && (
          <p className="compare">
            A naive <code>aria-live</code> transcript would have changed <strong>{m.contentFrames}</strong> times. This one
            made <strong>{m.announcements}</strong> announcements.
          </p>
        )}
      </section>
      <section className="panel" aria-labelledby="spoken-h">
        <h2 id="spoken-h">What the screen reader is told</h2>
        {spoken.length === 0 ? (
          <p className="empty">Nothing yet.</p>
        ) : (
          <ol className="scroll-list" data-testid="spoken" tabIndex={0} aria-label="Announcements, oldest first">
            {spoken.map((a) => (
              <li key={a.id}>
                {a.politeness === 'assertive' && <strong>[alert] </strong>}
                {a.text}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="panel" aria-labelledby="log-h">
        <h2 id="log-h">Stream events</h2>
        {snap.log.length === 0 ? (
          <p className="empty">Send a message to see events.</p>
        ) : (
          <ol className="scroll-list log" data-testid="log" tabIndex={0} aria-label="Stream events, oldest first">
            {snap.log
              .filter((l) => l.kind !== 'announce')
              .map((l) => (
                <li key={l.id} data-kind={l.kind}>
                  <span className={`k k-${l.kind}`}>{l.kind}</span> +{Math.round(l.at - t0)}ms {l.detail}
                </li>
              ))}
          </ol>
        )}
      </section>
    </aside>
  );
});
