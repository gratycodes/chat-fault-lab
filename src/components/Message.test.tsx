// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Message } from './Message';

const wrap = (ui: React.ReactNode) => render(<ol>{ui}</ol>);

describe('Message', () => {
  it('marks a streaming reply busy and shows a caret hidden from AT', () => {
    const { container } = wrap(<Message message={{ id: 'a', role: 'assistant', content: 'Hello', state: 'streaming' }} />);
    const li = container.querySelector('li')!;
    expect(li).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.caret')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is never itself a live region', () => {
    const { container } = wrap(<Message message={{ id: 'a', role: 'assistant', content: 'Hi', state: 'streaming' }} />);
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('labels interrupted replies and shows the reason', () => {
    wrap(<Message message={{ id: 'a', role: 'assistant', content: 'Half', state: 'interrupted', error: 'Connection closed.' }} />);
    expect(screen.getByText('Interrupted')).toBeInTheDocument();
    expect(screen.getByText('Connection closed.')).toBeInTheDocument();
  });

  it('renders an open code fence as code, not backticks', () => {
    const { container } = wrap(<Message message={{ id: 'a', role: 'assistant', content: 'See:\n```ts\nconst a = 1;', state: 'streaming' }} />);
    expect(container.querySelector('pre')).toHaveAttribute('data-open', 'true');
    expect(container.textContent).not.toContain('```');
  });

  it('renders model output as text, never as HTML', () => {
    const { container } = wrap(<Message message={{ id: 'a', role: 'assistant', content: '<img src=x onerror="alert(1)">', state: 'complete' }} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows tool-call progress while arguments stream', () => {
    const { rerender } = wrap(
      <Message message={{ id: 'a', role: 'assistant', content: '', state: 'streaming', toolCalls: [{ id: 'c', name: 'convert_currency', arguments: '{"amo' }] }} />,
    );
    expect(screen.getByTestId('tool-call')).toHaveTextContent('receiving arguments');
    rerender(
      <ol>
        <Message message={{ id: 'a', role: 'assistant', content: '', state: 'complete', toolCalls: [{ id: 'c', name: 'convert_currency', arguments: '{"amount":1}' }] }} />
      </ol>,
    );
    expect(screen.getByTestId('tool-call')).toHaveTextContent('arguments complete');
  });
});
