'use client';

import { useEffect, useState } from 'react';
import type { ChatSnapshot } from '@/lib/chat-controller';

const STATUS_TEXT: Record<ChatSnapshot['status'], string> = {
  idle: 'Ready',
  waiting: 'Waiting',
  streaming: 'Streaming',
  'running-tool': 'Running tool',
  retrying: 'Retrying',
  done: 'Done',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
  error: 'Error',
};

/** Visible status. Not a live region: announcements go through LiveRegions. */
export function StatusBar({ status, notice, error }: Pick<ChatSnapshot, 'status' | 'notice' | 'error'>) {
  const countdown = useCountdown(notice?.kind === 'retry' ? notice.until : undefined);
  return (
    <div className="statusbar" data-testid="status" data-status={status}>
      <span>
        Status: <strong>{STATUS_TEXT[status]}</strong>
      </span>
      {notice && (
        <span className="notice" data-testid="notice" data-kind={notice.kind}>
          {notice.kind === 'retry' && countdown !== undefined ? `Rate limited. Retrying in ${countdown}s.` : notice.text}
        </span>
      )}
      {error && !notice && <span className="err">{error}</span>}
    </div>
  );
}

function useCountdown(until: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return undefined;
  return Math.max(0, Math.ceil((until - now) / 1000));
}
