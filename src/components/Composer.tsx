'use client';

import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';

interface Props {
  busy: boolean;
  canRetry: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: () => void;
  defaultValue?: string;
}

export function Composer({ busy, canRetry, onSend, onStop, onRetry, defaultValue = '' }: Props) {
  const [text, setText] = useState(defaultValue);
  const id = useId();

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    onSend(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && busy) {
      e.preventDefault();
      onStop();
    }
  };

  return (
    <form className="composer" onSubmit={submit} aria-label="Send a message">
      <label htmlFor={id}>Message</label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-describedby={`${id}-hint`}
        rows={2}
      />
      <div className="buttons">
        <button type="submit" className="primary" disabled={busy || !text.trim()}>
          Send
        </button>
        <button type="button" onClick={onStop} disabled={!busy} aria-keyshortcuts="Escape">
          Stop
        </button>
        {canRetry && (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
      <p className="hint" id={`${id}-hint`}>
        Enter sends, Shift+Enter adds a line, Escape stops a reply.
      </p>
    </form>
  );
}
