import { memo } from 'react';
import { splitBlocks } from '@/lib/blocks';

export const MessageBody = memo(function MessageBody({ text, streaming }: { text: string; streaming: boolean }) {
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.map((b, i) => {
        const isLast = i === blocks.length - 1;
        if (b.kind === 'code') {
          return (
            <pre key={i} data-open={b.open} aria-label={b.lang ? `${b.lang} code` : 'code'} tabIndex={0}>
              <code>{b.code}</code>
              {streaming && isLast && <span className="caret" aria-hidden="true" />}
            </pre>
          );
        }
        return (
          <p key={i}>
            {b.text}
            {streaming && isLast && <span className="caret" aria-hidden="true" />}
          </p>
        );
      })}
      {blocks.length === 0 && streaming && (
        <p>
          <span className="caret" aria-hidden="true" />
          <span className="sr-only">Waiting for text</span>
        </p>
      )}
    </>
  );
});
