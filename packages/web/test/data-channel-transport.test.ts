import type { IncomingMessage } from '@shareit/shared';
import { describe, expect, it } from 'vitest';
import { DataChannelTransport } from '../src/transfer/data-channel-transport';

class FakeDataChannel {
  binaryType: 'blob' | 'arraybuffer' = 'blob';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  onbufferedamountlow: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  send(data: unknown): void {
    this.sent.push(data);
  }
}

function setup() {
  const dc = new FakeDataChannel();
  const transport = new DataChannelTransport(dc as unknown as RTCDataChannel);
  return { dc, transport };
}

describe('DataChannelTransport', () => {
  it('sends control as JSON and data as binary', async () => {
    const { dc, transport } = setup();
    transport.sendControl({ t: 'ack', durableOffset: 42 });
    await transport.sendData(new Uint8Array([1, 2, 3]));

    expect(dc.sent[0]).toBe(JSON.stringify({ t: 'ack', durableOffset: 42 }));
    expect(dc.sent[1]).toBeInstanceOf(Uint8Array);
    expect(dc.binaryType).toBe('arraybuffer');
  });

  it('routes incoming strings to control and ArrayBuffers to data', () => {
    const { dc, transport } = setup();
    const received: IncomingMessage[] = [];
    transport.onMessage((m) => received.push(m));

    dc.onmessage?.({ data: JSON.stringify({ t: 'complete', merkleRoot: 'abc' }) });
    dc.onmessage?.({ data: new Uint8Array([9, 9]).buffer });

    expect(received[0]).toEqual({ kind: 'control', msg: { t: 'complete', merkleRoot: 'abc' } });
    expect(received[1]).toEqual({ kind: 'data', data: new Uint8Array([9, 9]) });
  });

  it('buffers messages that arrive before a subscriber attaches', () => {
    const { dc, transport } = setup();
    dc.onmessage?.({ data: JSON.stringify({ t: 'ack', durableOffset: 1 }) });

    const received: IncomingMessage[] = [];
    transport.onMessage((m) => received.push(m));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ kind: 'control', msg: { t: 'ack', durableOffset: 1 } });
  });
});
