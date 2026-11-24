/**
 * A stand-in for the browser's `EventSource`, for the review progress tests
 * (t-78). Each `new EventSource(url)` is recorded in `FakeEventSource.opened`,
 * and a test drives it: `emit()` sends a named event as the server frames it
 * (`lib/api/sse.ts`: the `type` is the event name, the whole object the
 * data), `fail()` the browser's own error, with the state it leaves.
 *
 * Install with `vi.stubGlobal('EventSource', FakeEventSource)`.
 */
type Listener = (event: Event) => void;

export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.opened.push(this);
  }

  /** The most recent stream opened. */
  static latest(): FakeEventSource {
    const last = FakeEventSource.opened.at(-1);
    if (!last) throw new Error('No EventSource was opened');
    return last;
  }

  static reset(): void {
    FakeEventSource.opened = [];
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  get closed(): boolean {
    return this.readyState === FakeEventSource.CLOSED;
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.dispatch('open', new Event('open'));
  }

  /** A server frame: `event: <type>`, `data: <the payload as JSON>`. */
  emit(payload: { type: string } & Record<string, unknown>): void {
    this.dispatch(payload.type, new MessageEvent(payload.type, { data: JSON.stringify(payload) }));
  }

  /** A frame whose data is not JSON. */
  emitRaw(type: string, data: string): void {
    this.dispatch(type, new MessageEvent(type, { data }));
  }

  /** The browser's own error: still trying (`CONNECTING`) or given up (`CLOSED`). */
  fail(state: 'connecting' | 'closed'): void {
    this.readyState = state === 'closed' ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.dispatch('error', new Event('error'));
  }
}
