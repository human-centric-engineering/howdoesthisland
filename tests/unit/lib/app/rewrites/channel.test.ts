/**
 * Tests: the event channel between a rewrite's call and its stream (t-81).
 *
 * @see lib/app/rewrites/channel.ts
 */
import { describe, expect, it } from 'vitest';
import { EventChannel } from '@/lib/app/rewrites/channel';

async function all<T>(channel: EventChannel<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of channel) out.push(event);
  return out;
}

describe('EventChannel', () => {
  it('hands the reader what was pushed before it asked, in order, then ends once closed', async () => {
    const channel = new EventChannel<number>();
    channel.push(1);
    channel.push(2);
    channel.close();
    expect(await all(channel)).toEqual([1, 2]);
  });

  it('wakes a reader that is waiting, and ends it on close', async () => {
    const channel = new EventChannel<string>();
    const read = all(channel);
    await Promise.resolve();
    channel.push('a');
    await Promise.resolve();
    channel.push('b');
    channel.close();
    expect(await read).toEqual(['a', 'b']);
  });

  it('ignores what is pushed after close', async () => {
    const channel = new EventChannel<number>();
    channel.push(1);
    channel.close();
    channel.push(2);
    expect(await all(channel)).toEqual([1]);
  });

  it('keeps nothing once its reader has gone, and pushing then does not throw', async () => {
    const channel = new EventChannel<number>();
    channel.push(1);
    channel.push(2);
    for await (const event of channel) {
      expect(event).toBe(1);
      break;
    }
    expect(() => channel.push(3)).not.toThrow();
    // A second reader finds nothing: what was queued was dropped.
    const iterator = channel[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
