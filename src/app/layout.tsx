import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'chat-fault-lab: break your streaming AI chat on purpose',
  description:
    'Reproduce stalls, dropped connections, 429s, malformed frames, split UTF-8 and streamed tool calls, and see how an accessible Next.js chat handles them.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link className="brand" href="/">
            chat-fault-lab
          </Link>
          <nav aria-label="Site">
            <ul>
              <li>
                <Link href="/">Lab</Link>
              </li>
              <li>
                <Link href="/checklist/">Checklist</Link>
              </li>
              <li>
                <a href="https://github.com/gratycodes/chat-fault-lab">Source</a>
              </li>
            </ul>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
