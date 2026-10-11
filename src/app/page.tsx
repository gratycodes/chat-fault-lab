import { Lab } from '@/components/Lab';
import { SCENARIOS } from '@/lib/scenarios';

// Server component: the intro and scenario data render as static HTML; only
// the interactive lab ships JavaScript.
export default function Home() {
  const live = process.env.NEXT_PUBLIC_TRANSPORT !== 'browser';
  const scenarios = live ? SCENARIOS : SCENARIOS.filter((s) => s.id !== 'live');
  return (
    <>
      <h1>Break your streaming chat on purpose</h1>
      <p className="intro">
        Pick a failure, send a message, and watch what the interface does. Every scenario is a deterministic,
        OpenAI-compatible SSE stream. The inspector shows the raw events and exactly what a screen reader is told.
      </p>
      <Lab scenarios={scenarios} />
    </>
  );
}
