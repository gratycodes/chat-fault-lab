// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SCENARIOS } from '@/lib/scenarios';
import type { Transport } from '@/lib/transport';
import { inBrowserTransport } from '@/lib/transport';
import { Lab } from './Lab';

// Run the real mock backend in-process, 50x faster than realistic.
const fast: Transport = (req, signal) => inBrowserTransport({ ...req, timeScale: 0.02 }, signal);
const scenarios = SCENARIOS.filter((s) => s.id !== 'live');

describe('Lab', () => {
  it('streams a reply end to end and reports it to the screen reader once per sentence', async () => {
    render(<Lab scenarios={scenarios} transport={fast} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveAttribute('data-status', 'done'), { timeout: 5000 });
    const frames = Number(screen.getByTestId('frames').textContent);
    const said = Number(screen.getByTestId('announcements').textContent);
    expect(frames).toBeGreaterThan(40);
    expect(said).toBeLessThan(8);
    expect(screen.getByRole('status')).toHaveTextContent(/End of reply\.$/);
  });

  it('runs the tool-call scenario', async () => {
    render(<Lab scenarios={scenarios} transport={fast} />);
    await userEvent.click(screen.getByRole('radio', { name: /Streamed tool call/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveAttribute('data-status', 'done'), { timeout: 5000 });
    const transcript = screen.getByTestId('transcript');
    expect(within(transcript).getByText(/10,944 INR/)).toBeInTheDocument();
  });

  it('locks scenario choice while busy and offers Retry after a drop', async () => {
    render(<Lab scenarios={scenarios} transport={fast} />);
    await userEvent.click(screen.getByRole('radio', { name: /Dropped connection/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('radio', { name: /Steady stream/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveAttribute('data-status', 'interrupted'), { timeout: 5000 });
    expect(screen.getByRole('alert')).toHaveTextContent(/partial reply is kept/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
