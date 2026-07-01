import { describe, expect, it } from 'vitest';
import type { Manifest } from '../src/protocol/manifest';
import type { IncomingMessage, Sink, Source, TransferChannel } from '../src/transfer/channel';
import { TransferReceiver } from '../src/transfer/receiver';
import { TransferSender } from '../src/transfer/sender';

/** In-memory ordered channel pair; control is JSON round-tripped to mimic real serialization. */
class Loopback implements TransferChannel {
  peer!: Loopback;
  private cb: ((m: IncomingMessage) => void) | null = null;
  private tamperNextData = false;

  tamperOnce(): void {
    this.tamperNextData = true;
  }
  sendControl(msg: unknown): void {
    const json = JSON.stringify(msg);
    queueMicrotask(() => this.peer.cb?.({ kind: 'control', msg: JSON.parse(json) }));
  }
  sendData(data: Uint8Array): Promise<void> {
    const copy = data.slice();
    if (this.tamperNextData && copy.length > 0) {
      copy[0] = (copy[0]! + 1) & 0xff;
      this.tamperNextData = false;
    }
    queueMicrotask(() => this.peer.cb?.({ kind: 'data', data: copy }));
    return Promise.resolve();
  }
  onMessage(cb: (m: IncomingMessage) => void): void {
    this.cb = cb;
  }
}

function pair(): [Loopback, Loopback] {
  const a = new Loopback();
  const b = new Loopback();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

function makeSource(data: Uint8Array): Source {
  return { size: data.length, slice: (s, e) => Promise.resolve(data.subarray(s, e)) };
}

class BufferSink implements Sink {
  parts: Uint8Array[] = [];
  closed = false;
  aborted = false;
  write(chunk: Uint8Array): Promise<void> {
    this.parts.push(chunk.slice());
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  abort(): Promise<void> {
    this.aborted = true;
    return Promise.resolve();
  }
  bytes(): Uint8Array {
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function manifestFor(size: number): Manifest {
  return {
    transferId: 't1',
    files: [{ path: 'f.bin', size, lastModified: 0 }],
    chunkSize: 64,
    blockSize: 256,
  };
}

describe('transfer round-trip', () => {
  it('delivers a multi-block file byte-for-byte and verifies integrity', async () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 7) & 0xff;

    const [sa, sb] = pair();
    const sink = new BufferSink();
    const receiver = new TransferReceiver({ channel: sb, sink });
    const done = new Promise<void>((resolve, reject) => {
      receiver.on('done', resolve);
      receiver.on('error', reject);
    });

    const sender = new TransferSender({ channel: sa, source: makeSource(data), manifest: manifestFor(1000) });
    await sender.start();
    await done;

    expect(sink.closed).toBe(true);
    expect(sink.bytes()).toEqual(data);
  });

  it('reports progress that reaches the total', async () => {
    const data = new Uint8Array(500).fill(9);
    const [sa, sb] = pair();
    const sink = new BufferSink();
    let last = 0;
    const receiver = new TransferReceiver({ channel: sb, sink });
    receiver.on('progress', (p) => {
      last = p.bytesTransferred;
    });
    const receiverDone = new Promise<void>((resolve, reject) => {
      receiver.on('done', resolve);
      receiver.on('error', reject);
    });
    const sender = new TransferSender({ channel: sa, source: makeSource(data), manifest: manifestFor(500) });
    await sender.start();
    await receiverDone;
    expect(last).toBe(500);
  });

  it('rejects a tampered block via the hash check', async () => {
    const data = new Uint8Array(300).fill(3);
    const [sa, sb] = pair();
    sa.tamperOnce(); // corrupt the first data frame in flight
    const sink = new BufferSink();
    const receiver = new TransferReceiver({ channel: sb, sink });
    const errored = new Promise<Error>((resolve) => receiver.on('error', resolve));

    const sender = new TransferSender({ channel: sa, source: makeSource(data), manifest: manifestFor(300) });
    await sender.start();
    const err = await errored;
    expect(err.message).toMatch(/integrity check failed/);
    expect(sink.closed).toBe(false);
  });
});
