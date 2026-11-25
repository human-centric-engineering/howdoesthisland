/**
 * A one-reader queue of events from a rewrite's call to the response that
 * streams it (t-81).
 *
 * The call runs on its own, under `keepRunningAfterResponse`, so a reader
 * that goes away (the browser closed the stream) never stops it: the draft
 * is still saved and charged. Pushing to a channel whose reader has gone
 * keeps nothing, so a call that outlives its reader holds no events in
 * memory. The reader is gone once it stops reading, or once `signal` (its
 * request's) aborts, which covers a response that never began to read.
 */
export class EventChannel<T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;
  private readerGone = false;

  constructor(signal?: AbortSignal) {
    if (signal?.aborted) this.leave();
    else signal?.addEventListener('abort', () => this.leave(), { once: true });
  }

  /** The reader has gone: drop what is kept, and keep nothing more. */
  private leave(): void {
    this.readerGone = true;
    this.queue.length = 0;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  /** Hand `event` to the reader, or keep it until the reader asks. */
  push(event: T): void {
    if (this.closed || this.readerGone) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: event, done: false });
      return;
    }
    this.queue.push(event);
  }

  /** No more events: the reader finishes once it has the ones kept. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const next = this.queue.shift();
        if (next !== undefined) return Promise.resolve({ value: next, done: false });
        if (this.closed || this.readerGone) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiting = resolve;
        });
      },
      // The reader stopped early (`break`, or the response was cancelled).
      return: () => {
        this.leave();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
