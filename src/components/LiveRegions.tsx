'use client';

import type { Announcement } from '@/lib/chat-controller';

/**
 * Two always-mounted, visually hidden live regions. They exist before the
 * first announcement (regions inserted on the fly are often ignored), and the
 * streaming transcript is never inside them.
 */
export function LiveRegions({ announcements }: { announcements: Announcement[] }) {
  const polite = findLast(announcements, 'polite');
  const assertive = findLast(announcements, 'assertive');
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-polite">
        {polite && <span key={polite.id}>{polite.text}</span>}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-testid="live-assertive">
        {assertive && <span key={assertive.id}>{assertive.text}</span>}
      </div>
    </>
  );
}

function findLast(list: Announcement[], p: Announcement['politeness']) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.politeness === p) return list[i];
  return undefined;
}
