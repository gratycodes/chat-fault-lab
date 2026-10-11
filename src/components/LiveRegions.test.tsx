// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { LiveRegions } from './LiveRegions';

describe('LiveRegions', () => {
  it('renders both regions even before anything is announced', () => {
    render(<LiveRegions announcements={[]} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('routes the latest announcement of each politeness to its region', () => {
    render(
      <LiveRegions
        announcements={[
          { id: 1, text: 'Assistant is responding.', politeness: 'polite' },
          { id: 2, text: 'Error: boom', politeness: 'assertive' },
          { id: 3, text: 'First sentence.', politeness: 'polite' },
        ]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('First sentence.');
    expect(screen.getByRole('alert')).toHaveTextContent('Error: boom');
  });
});
