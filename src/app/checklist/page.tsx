import type { Metadata } from 'next';
import { CHECKLIST } from '@/lib/checklist';

export const metadata: Metadata = { title: 'Checklist · chat-fault-lab' };

export default function ChecklistPage() {
  return (
    <>
      <h1>Streaming chat checklist</h1>
      <p className="intro">
        Each row is a failure that keeps showing up in real chat UIs, what this app does about it, and the
        automated test that proves it. Copy the tests into your own app and point them at your selectors.
      </p>
      <table>
        <caption className="sr-only">Failure modes, the handling in this app, and the test that covers each</caption>
        <thead>
          <tr>
            <th scope="col">Failure</th>
            <th scope="col">What this app does</th>
            <th scope="col">Test</th>
          </tr>
        </thead>
        <tbody>
          {CHECKLIST.map((row) => (
            <tr key={row.failure}>
              <th scope="row">{row.failure}</th>
              <td>{row.handling}</td>
              <td>
                <code>{row.test}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
