/**
 * Framework-agnostic chat controller.
 *
 * Owns one conversation: sends requests through a Transport, parses the SSE
 * stream, survives the failures in the lab (stalls, drops, 429s, error frames,
 * malformed frames, split UTF-8, streamed tool calls), and exposes immutable
 * snapshots for React's useSyncExternalStore.
 *
 * Rendering is batched: frames update an internal draft and a single commit is
 * scheduled per animation frame, so a 200-chunks-per-second provider does not
 * cause 200 React renders per second.
 */
import { SentenceAnnouncer } from './announcer';
import type { WireMessage } from './mock-backend';
import { applyChunk, emptyDraft, parseFrame, retryDelayMs, tryParseArguments, type Draft, type ToolCall } from './openai';
import type { ScenarioId } from './scenarios';
import { createSseParser } from './sse';
import type { ToolRunner } from './tools';
import type { Transport } from './transport';

export type TurnStatus = 'idle' | 'waiting' | 'streaming' | 'running-tool' | 'retrying' | 'done' | 'stopped' | 'interrupted' | 'error';

export type MessageState = 'streaming' | 'complete' | 'stopped' | 'interrupted' | 'error';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  state: MessageState;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  error?: string;
}

export type LogKind = 'request' | 'response' | 'frame' | 'comment' | 'malformed' | 'stall' | 'retry' | 'tool' | 'end' | 'error' | 'abort' | 'announce';

export interface LogEntry {
  id: number;
  at: number;
  kind: LogKind;
  detail: string;
}

export interface Announcement {
  id: number;
  text: string;
  politeness: 'polite' | 'assertive';
}

export interface Metrics {
  requestAt?: number;
  firstTokenAt?: number;
  endAt?: number;
  /** Content-bearing frames: how often a naive aria-live node would have changed. */
  contentFrames: number;
  /** Times the transcript was actually re-rendered. */
  commits: number;
  announcements: number;
  malformed: number;
  retries: number;
}

export interface Notice {
  kind: 'waiting' | 'stalled' | 'retry' | 'tool';
  text: string;
  /** For `retry`: epoch ms when the retry fires. */
  until?: number;
}

export interface ChatSnapshot {
  messages: UiMessage[];
  status: TurnStatus;
  notice: Notice | null;
  error: string | null;
  log: LogEntry[];
  announcements: Announcement[];
  metrics: Metrics;
}

export interface ChatControllerOptions {
  transport: Transport;
  runTool: ToolRunner;
  scenario?: ScenarioId;
  /** Scales the controller's timers and is forwarded to the mock backend. */
  timeScale?: number;
  stallNoticeMs?: number;
  idleTimeoutMs?: number;
  maxRetries?: number;
  maxToolSteps?: number;
  announcer?: SentenceAnnouncer;
  /** Defaults to requestAnimationFrame, or a microtask outside the browser. */
  schedule?: (fn: () => void) => void;
  now?: () => number;
}

const LOG_LIMIT = 250;
const ANNOUNCE_LIMIT = 50;
const MAX_RETRY_WAIT_MS = 30_000;

class StopError extends Error {}

const emptyMetrics = (): Metrics => ({ contentFrames: 0, commits: 0, announcements: 0, malformed: 0, retries: 0 });

export const isBusy = (s: TurnStatus) => s === 'waiting' || s === 'streaming' || s === 'running-tool' || s === 'retrying';

export class ChatController {
  private snap: ChatSnapshot = { messages: [], status: 'idle', notice: null, error: null, log: [], announcements: [], metrics: emptyMetrics() };
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private seq = 0;
  private logSeq = 0;
  private opts: Required<Omit<ChatControllerOptions, 'announcer' | 'schedule' | 'now'>>;
  private announcer: SentenceAnnouncer;
  private schedule: (fn: () => void) => void;
  private now: () => number;
  private pendingDraft: { id: string; draft: Draft } | null = null;
  private commitQueued = false;
  /** True once the current request has produced content. */
  private streamingStarted = false;

  constructor(options: ChatControllerOptions) {
    this.opts = {
      scenario: 'steady',
      timeScale: 1,
      stallNoticeMs: 2000,
      idleTimeoutMs: 8000,
      maxRetries: 1,
      maxToolSteps: 3,
      ...options,
    };
    this.announcer = options.announcer ?? new SentenceAnnouncer();
    this.now = options.now ?? (() => Date.now());
    this.schedule =
      options.schedule ??
      (typeof requestAnimationFrame === 'function' ? (fn) => void requestAnimationFrame(() => fn()) : (fn) => queueMicrotask(fn));
  }

  // ---- store API -----------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): ChatSnapshot => this.snap;

  private set(patch: Partial<ChatSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  setScenario(id: ScenarioId) {
    this.opts.scenario = id;
  }

  setTimeScale(scale: number) {
    this.opts.timeScale = scale;
  }

  get scenario(): ScenarioId {
    return this.opts.scenario;
  }

  // ---- helpers -------------------------------------------------------------

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private log(kind: LogKind, detail: string) {
    this.logSeq += 1;
    const entry: LogEntry = { id: this.logSeq, at: this.now(), kind, detail };
    const log = this.snap.log.length >= LOG_LIMIT ? [...this.snap.log.slice(-LOG_LIMIT + 1), entry] : [...this.snap.log, entry];
    this.set({ log });
  }

  private announce(text: string, politeness: 'polite' | 'assertive' = 'polite') {
    this.log('announce', `${politeness}: ${text}`);
    const a: Announcement = { id: this.logSeq, text, politeness };
    const announcements = [...this.snap.announcements.slice(-ANNOUNCE_LIMIT + 1), a];
    this.set({ announcements, metrics: { ...this.snap.metrics, announcements: this.snap.metrics.announcements + 1 } });
  }

  private updateMessage(id: string, patch: Partial<UiMessage>) {
    this.set({ messages: this.snap.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }

  private scaled(ms: number) {
    return ms * this.opts.timeScale;
  }

  /** Queue a render of the streaming draft; at most one per frame. */
  private queueCommit(id: string, draft: Draft) {
    this.pendingDraft = { id, draft };
    if (this.commitQueued) return;
    this.commitQueued = true;
    this.schedule(() => this.commitNow());
  }

  private commitNow() {
    this.commitQueued = false;
    const p = this.pendingDraft;
    if (!p) return;
    this.pendingDraft = null;
    this.updateMessage(p.id, { content: p.draft.content, toolCalls: p.draft.toolCalls.length ? p.draft.toolCalls : undefined });
    this.set({ metrics: { ...this.snap.metrics, commits: this.snap.metrics.commits + 1 } });
    const said = this.announcer.update(p.draft.content, this.now());
    if (said) this.announce(said);
  }

  private wire(): WireMessage[] {
    const out: WireMessage[] = [];
    for (const m of this.snap.messages) {
      if (m.role === 'user') out.push({ role: 'user', content: m.content });
      else if (m.role === 'tool') out.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId });
      else if (m.toolCalls?.length && m.state === 'complete') {
        out.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.arguments } })),
        });
      } else if (m.content) out.push({ role: 'assistant', content: m.content });
    }
    return out;
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new StopError());
      const t = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new StopError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // ---- public actions ------------------------------------------------------

  async send(text: string): Promise<void> {
    const content = text.trim();
    if (!content || isBusy(this.snap.status)) return;
    this.set({
      messages: [...this.snap.messages, { id: this.nextId('u'), role: 'user', content, state: 'complete' }],
    });
    await this.run();
  }

  /** Drop the failed or stopped reply after the last user message and ask again. */
  async retry(): Promise<void> {
    if (isBusy(this.snap.status)) return;
    const msgs = this.snap.messages;
    let lastUser = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.role === 'user') {
        lastUser = i;
        break;
      }
    }
    if (lastUser === -1) return;
    this.set({ messages: msgs.slice(0, lastUser + 1) });
    await this.run();
  }

  stop(): void {
    if (this.abort && !this.abort.signal.aborted) this.abort.abort(new StopError('stopped by user'));
  }

  clear(): void {
    this.stop();
    this.set({ messages: [], status: 'idle', notice: null, error: null, log: [], announcements: [], metrics: emptyMetrics() });
  }

  // ---- the turn ------------------------------------------------------------

  private async run(): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    this.announcer.reset();
    this.set({
      status: 'waiting',
      notice: { kind: 'waiting', text: 'Waiting for the first token…' },
      error: null,
      metrics: { ...emptyMetrics(), requestAt: this.now() },
    });
    this.announce('Assistant is responding.');

    let assistantId: string | null = null;
    try {
      for (let step = 0; step <= this.opts.maxToolSteps; step++) {
        const res = await this.request(abort.signal);
        assistantId = this.nextId('a');
        this.set({ messages: [...this.snap.messages, { id: assistantId, role: 'assistant', content: '', state: 'streaming' }] });
        const outcome = await this.readStream(res, assistantId, abort.signal);
        if (outcome.kind === 'tool_calls') {
          await this.runTools(outcome.calls, abort.signal);
          assistantId = null;
          this.announcer.reset();
          continue;
        }
        if (outcome.kind === 'complete') {
          this.updateMessage(assistantId, { state: 'complete' });
          const rest = this.announcer.finish(outcome.content);
          this.set({ status: 'done', notice: null, metrics: { ...this.snap.metrics, endAt: this.now() } });
          this.log('end', 'finished normally');
          this.announce(rest ? `${rest} End of reply.` : 'End of reply.');
          return;
        }
        if (outcome.kind === 'interrupted') {
          const msg = 'The connection closed before the reply finished. The partial reply is kept.';
          this.updateMessage(assistantId, { state: 'interrupted', error: msg });
          this.set({ status: 'interrupted', notice: null, error: msg, metrics: { ...this.snap.metrics, endAt: this.now() } });
          this.log('end', outcome.reason);
          this.announce(msg, 'assertive');
          return;
        }
        // provider error
        this.updateMessage(assistantId, { state: 'error', error: outcome.message });
        this.set({ status: 'error', notice: null, error: outcome.message, metrics: { ...this.snap.metrics, endAt: this.now() } });
        this.log('error', outcome.message);
        this.announce(`Error: ${outcome.message}`, 'assertive');
        return;
      }
      throw new Error(`Gave up after ${this.opts.maxToolSteps} tool steps.`);
    } catch (err) {
      if (this.pendingDraft) this.commitNow();
      if (err instanceof StopError || abort.signal.aborted) {
        if (assistantId) this.updateMessage(assistantId, { state: 'stopped' });
        this.set({ status: 'stopped', notice: null, metrics: { ...this.snap.metrics, endAt: this.now() } });
        this.log('abort', 'stopped by user');
        this.announce('Stopped. The partial reply is kept.');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (assistantId) this.updateMessage(assistantId, { state: 'error', error: message });
      this.set({ status: 'error', notice: null, error: message, metrics: { ...this.snap.metrics, endAt: this.now() } });
      this.log('error', message);
      this.announce(`Error: ${message}`, 'assertive');
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  private async request(signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      this.log('request', `POST scenario=${this.opts.scenario} attempt=${attempt}`);
      let res: Response;
      try {
        res = await this.opts.transport({ messages: this.wire(), scenario: this.opts.scenario, attempt, timeScale: this.opts.timeScale }, signal);
      } catch (err) {
        if (signal.aborted) throw new StopError();
        throw new Error(`Network error: ${(err as Error).message}`);
      }
      this.log('response', `${res.status} ${res.headers.get('content-type') ?? ''}`.trim());
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status === 503;
      let message = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        if (j.error?.message) message = j.error.message;
      } catch {
        /* not JSON */
      }
      if (!retryable || attempt >= this.opts.maxRetries) throw new Error(message);
      const wait = Math.min(MAX_RETRY_WAIT_MS, retryDelayMs(res.headers, 1000));
      const until = this.now() + wait;
      this.set({
        status: 'retrying',
        notice: { kind: 'retry', text: `Rate limited. Retrying in ${Math.ceil(wait / 1000)}s.`, until },
        metrics: { ...this.snap.metrics, retries: this.snap.metrics.retries + 1 },
      });
      this.log('retry', `${res.status}; server asked to wait ${wait} ms`);
      this.announce(`Rate limited. Retrying in ${Math.ceil(wait / 1000)} seconds.`);
      await this.sleep(wait, signal);
      this.set({ status: 'waiting', notice: { kind: 'waiting', text: 'Waiting for the first token…' } });
    }
  }

  private async readStream(
    res: Response,
    id: string,
    signal: AbortSignal,
  ): Promise<
    | { kind: 'complete'; content: string }
    | { kind: 'tool_calls'; calls: ToolCall[] }
    | { kind: 'interrupted'; reason: string }
    | { kind: 'provider-error'; message: string }
  > {
    if (!res.body) return { kind: 'interrupted', reason: 'response had no body' };
    const reader = res.body.getReader();
    this.streamingStarted = false;
    const parser = createSseParser();
    let draft = emptyDraft();
    let sawDone = false;
    let commentsSeen = 0;
    const onAbort = () => void reader.cancel('stopped by user').catch(() => {});
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      for (;;) {
        const r = await this.readWithWatchdog(reader, signal);
        if (r === 'timeout') {
          if (this.pendingDraft) this.commitNow();
          return { kind: 'interrupted', reason: `no data for ${Math.round(this.scaled(this.opts.idleTimeoutMs))} ms; gave up` };
        }
        if (r.done) break;
        for (const ev of parser.push(r.value)) {
          const frame = parseFrame(ev.data);
          if (frame.kind === 'done') {
            sawDone = true;
            this.log('frame', '[DONE]');
          } else if (frame.kind === 'malformed') {
            this.set({ metrics: { ...this.snap.metrics, malformed: this.snap.metrics.malformed + 1 } });
            this.log('malformed', `skipped frame (${frame.reason}): ${frame.raw.slice(0, 80)}`);
          } else if (frame.kind === 'error') {
            if (this.pendingDraft) this.commitNow();
            return { kind: 'provider-error', message: frame.message };
          } else {
            const before = draft;
            draft = applyChunk(draft, frame.chunk);
            if (draft.content !== before.content || draft.toolCalls !== before.toolCalls) {
              if (!this.streamingStarted) {
                this.streamingStarted = true;
                this.set({ status: 'streaming', notice: null, metrics: { ...this.snap.metrics, firstTokenAt: this.snap.metrics.firstTokenAt ?? this.now() } });
              } else if (this.snap.notice?.kind === 'stalled') {
                this.set({ notice: null });
                this.log('stall', 'data resumed');
              }
              this.set({ metrics: { ...this.snap.metrics, contentFrames: this.snap.metrics.contentFrames + 1 } });
              this.queueCommit(id, draft);
            }
            if (draft.finishReason && draft.finishReason !== before.finishReason) this.log('frame', `finish_reason=${draft.finishReason}`);
          }
        }
        if (parser.comments > commentsSeen) {
          commentsSeen = parser.comments;
          this.log('comment', 'keep-alive comment');
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw new StopError();
    if (this.pendingDraft) this.commitNow();
    const { truncated } = parser.end();
    if (truncated) this.log('malformed', 'stream ended in the middle of a frame');

    if (draft.finishReason === 'tool_calls' && draft.toolCalls.length > 0) {
      this.updateMessage(id, { state: 'complete', toolCalls: draft.toolCalls });
      return { kind: 'tool_calls', calls: draft.toolCalls };
    }
    if (draft.finishReason || sawDone) {
      return { kind: 'complete', content: draft.content };
    }
    return { kind: 'interrupted', reason: 'stream ended with no finish_reason and no [DONE]' };
  }

  private async readWithWatchdog(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
  ): Promise<ReadableStreamReadResult<Uint8Array> | 'timeout'> {
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const started = this.streamingStarted;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<'timeout'>((resolve) => {
          if (started) {
            noticeTimer = setTimeout(() => {
              if (signal.aborted) return;
              const secs = Math.round(this.scaled(this.opts.stallNoticeMs) / 100) / 10;
              this.set({ notice: { kind: 'stalled', text: `No data for ${secs}s. Still waiting…` } });
              this.log('stall', `no data for ${secs}s`);
              this.announce('The reply has paused. Still waiting.');
            }, this.scaled(this.opts.stallNoticeMs));
          }
          // Before the first token the server may legitimately think for a while; allow 3x.
          idleTimer = setTimeout(() => {
            void reader.cancel('idle timeout').catch(() => {});
            resolve('timeout');
          }, this.scaled(this.opts.idleTimeoutMs) * (started ? 1 : 3));
        }),
      ]);
    } finally {
      clearTimeout(noticeTimer);
      clearTimeout(idleTimer);
    }
  }

  private async runTools(calls: ToolCall[], signal: AbortSignal) {
    this.set({ status: 'running-tool', notice: { kind: 'tool', text: `Running ${calls.map((c) => c.name).join(', ')}…` } });
    for (const call of calls) {
      if (signal.aborted) throw new StopError();
      const args = tryParseArguments(call.arguments);
      let content: string;
      if (!args) {
        content = JSON.stringify({ error: 'arguments were not valid JSON' });
        this.log('tool', `${call.name}: invalid arguments ${call.arguments.slice(0, 80)}`);
      } else {
        try {
          const result = await this.opts.runTool(call.name, args);
          content = JSON.stringify(result);
          this.log('tool', `${call.name}(${call.arguments}) → ${content}`);
        } catch (err) {
          content = JSON.stringify({ error: (err as Error).message });
          this.log('tool', `${call.name} failed: ${(err as Error).message}`);
        }
      }
      this.set({
        messages: [...this.snap.messages, { id: this.nextId('t'), role: 'tool', content, state: 'complete', toolCallId: call.id, toolName: call.name }],
      });
    }
    this.announce(`Ran ${calls.map((c) => c.name.replace(/_/g, ' ')).join(', ')}.`);
    this.set({ status: 'waiting', notice: { kind: 'waiting', text: 'Waiting for the answer…' } });
  }
}
