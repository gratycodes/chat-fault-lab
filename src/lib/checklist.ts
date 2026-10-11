export interface ChecklistRow {
  failure: string;
  handling: string;
  test: string;
}

export const CHECKLIST: ChecklistRow[] = [
  {
    failure: 'Screen reader announces every token',
    handling: 'Streaming text is not in a live region. Whole sentences go to a separate polite region, at most one announcement per 1.2 s. Code blocks are summarised.',
    test: 'e2e/a11y.spec.ts › no token flood',
  },
  {
    failure: 'Auto-scroll yanks the reader back to the bottom',
    handling: 'Follow mode detaches on any upward user gesture and only re-attaches when the user returns to the bottom or presses “Jump to latest”.',
    test: 'e2e/scroll.spec.ts',
  },
  {
    failure: 'Dropped stream shown as a finished answer',
    handling: 'A stream with no finish_reason and no [DONE] is marked interrupted. The partial text is kept and Retry is offered.',
    test: 'e2e/faults.spec.ts › disconnect',
  },
  {
    failure: 'Hung stream spins forever',
    handling: 'An idle watchdog shows “still waiting” after 2 s and gives up after 8 s, cancelling the body.',
    test: 'e2e/faults.spec.ts › stall, hang',
  },
  {
    failure: '429 retried immediately or not at all',
    handling: 'Honours retry-after-ms / retry-after, shows a countdown, retries once.',
    test: 'e2e/faults.spec.ts › rate limit',
  },
  {
    failure: 'Error frame mid-stream loses the partial reply',
    handling: 'Partial text stays, the message is marked failed, the error is announced assertively.',
    test: 'e2e/faults.spec.ts › server error',
  },
  {
    failure: 'One bad frame kills the whole reply',
    handling: 'Malformed JSON frames are skipped and logged; the reply finishes.',
    test: 'src/lib/chat-controller.test.ts',
  },
  {
    failure: 'Split multi-byte characters render as �',
    handling: 'Bytes are decoded with a streaming TextDecoder before SSE parsing.',
    test: 'e2e/faults.spec.ts › utf-8',
  },
  {
    failure: 'Tool-call arguments parsed before they finish',
    handling: 'Fragments are joined by index; the tool runs only after finish_reason=tool_calls and the JSON parses.',
    test: 'e2e/faults.spec.ts › tool call',
  },
  {
    failure: 'Stop button hides the UI but the request keeps running',
    handling: 'Stop aborts the fetch and cancels the body; the route handler passes request.signal upstream.',
    test: 'src/lib/chat-controller.test.ts › stop',
  },
  {
    failure: 'Re-rendering on every token',
    handling: 'Frames update a draft; one commit per animation frame. The inspector shows frames vs commits.',
    test: 'e2e/perf.spec.ts',
  },
  {
    failure: 'Open code fence flashes raw backticks',
    handling: 'An unclosed fence renders as an open code block until it closes.',
    test: 'src/lib/blocks.test.ts',
  },
];
