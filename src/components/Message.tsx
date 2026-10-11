import { memo } from 'react';
import type { UiMessage } from '@/lib/chat-controller';
import { tryParseArguments } from '@/lib/openai';
import { MessageBody } from './MessageBody';

const STATE_LABEL: Partial<Record<UiMessage['state'], string>> = {
  stopped: 'Stopped',
  interrupted: 'Interrupted',
  error: 'Failed',
};

/**
 * One transcript entry. Memoised on the message object: the controller only
 * replaces the message that changed, so earlier messages never re-render while
 * a reply streams.
 */
export const Message = memo(function Message({ message }: { message: UiMessage }) {
  const streaming = message.state === 'streaming';
  const label = STATE_LABEL[message.state];
  if (message.role === 'tool') {
    return (
      <li className="msg tool" data-role="tool">
        <p className="who">Tool result · {message.toolName}</p>
        <div className="tool-call">{message.content}</div>
      </li>
    );
  }
  return (
    <li className={`msg ${message.role}`} data-role={message.role} data-state={message.state} aria-busy={streaming || undefined}>
      <p className="who">
        {message.role === 'user' ? 'You' : 'Assistant'}
        {label && <span className={`badge ${message.state}`}>{label}</span>}
      </p>
      {message.toolCalls?.map((tc, i) => {
        const parsed = tryParseArguments(tc.arguments);
        return (
          <div className="tool-call" key={tc.id || i} data-testid="tool-call">
            <span>Calling </span>
            <strong>{tc.name || '…'}</strong>
            <span>({tc.arguments})</span>
            <span> {parsed ? '✓ arguments complete' : streaming ? '… receiving arguments' : '✗ arguments incomplete'}</span>
          </div>
        );
      })}
      {(message.content || !message.toolCalls?.length) && <MessageBody text={message.content} streaming={streaming} />}
      {message.error && <p className="msg-error">{message.error}</p>}
    </li>
  );
});
