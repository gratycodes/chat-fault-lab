// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';

function setup(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const onRetry = vi.fn();
  render(<Composer busy={false} canRetry={false} onSend={onSend} onStop={onStop} onRetry={onRetry} {...props} />);
  return { onSend, onStop, onRetry, box: screen.getByLabelText('Message') };
}

describe('Composer', () => {
  it('Enter sends, Shift+Enter adds a newline', async () => {
    const { onSend, box } = setup();
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two{Enter}');
    expect(onSend).toHaveBeenCalledWith('line one\nline two');
  });

  it('does not send empty text', async () => {
    const { onSend, box } = setup();
    await userEvent.type(box, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('Escape stops while busy and Send is disabled', async () => {
    const { onStop, box } = setup({ busy: true, defaultValue: 'x' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    box.focus();
    await userEvent.keyboard('{Escape}');
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('offers Retry only when allowed', async () => {
    const { onRetry } = setup({ canRetry: true });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('describes its keyboard shortcuts', () => {
    const { box } = setup();
    expect(box).toHaveAccessibleDescription(/Escape stops a reply/);
  });
});
