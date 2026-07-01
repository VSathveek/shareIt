import { describe, expect, it } from 'vitest';
import { BackpressuredWriter, type ChannelLike } from '../src/transport/backpressure';

class FakeChannel implements ChannelLike {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  onbufferedamountlow: (() => void) | null = null;
  sent: Uint8Array[] = [];
  send(data: Uint8Array): void {
    this.sent.push(data);
    this.bufferedAmount += data.length;
  }
  drain(): void {
    this.bufferedAmount = 0;
    this.onbufferedamountlow?.();
  }
}

describe('BackpressuredWriter', () => {
  it('resolves immediately while under the high-water mark', async () => {
    const ch = new FakeChannel();
    const writer = new BackpressuredWriter(ch, 100, 10);
    await writer.write(new Uint8Array(50));
    expect(ch.sent).toHaveLength(1);
  });

  it('blocks once over the high-water mark until the channel drains', async () => {
    const ch = new FakeChannel();
    const writer = new BackpressuredWriter(ch, 100, 10);
    let resolved = false;
    const p = writer.write(new Uint8Array(200)).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false); // parked on backpressure

    ch.drain();
    await p;
    expect(resolved).toBe(true);
  });
});
