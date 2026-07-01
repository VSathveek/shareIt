import type { Manifest } from '../src/protocol/manifest';
import type { IncomingMessage, Sink, Source, TransferChannel } from '../src/transfer/channel';

/** In-memory ordered channel pair; control is JSON round-tripped to mimic real serialization. */
export class Loopback implements TransferChannel {
  peer!: Loopback;
  private cb: ((m: IncomingMessage) => void) | null = null;
  private tamperNextData = false;
  private live = true;

  tamperOnce(): void {
    this.tamperNextData = true;
  }
  /** Simulate a dropped connection: stop delivering to the peer. */
  disconnect(): void {
    this.live = false;
  }
  sendControl(msg: unknown): void {
    if (!this.live) return;
    const json = JSON.stringify(msg);
    queueMicrotask(() => this.peer.cb?.({ kind: 'control', msg: JSON.parse(json) }));
  }
  sendData(data: Uint8Array): Promise<void> {
    if (!this.live) return Promise.resolve();
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

export function pair(): [Loopback, Loopback] {
  const a = new Loopback();
  const b = new Loopback();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

export function makeSource(data: Uint8Array): Source {
  return { size: data.length, slice: (s, e) => Promise.resolve(data.subarray(s, e)) };
}

export class BufferSink implements Sink {
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

export function manifestFor(size: number, chunkSize = 64, blockSize = 256): Manifest {
  return {
    transferId: 't1',
    files: [{ path: 'f.bin', size, lastModified: 0 }],
    chunkSize,
    blockSize,
  };
}

export function patternBytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) data[i] = (i * 7) & 0xff;
  return data;
}

/** Resolves after the microtask queue drains, so loopback deliveries settle. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
