import { describe, expect, it } from 'vitest';
import type { TransferControlMessage } from '../src/protocol/control-messages';
import type { IncomingMessage } from '../src/transfer/channel';
import { TransferReceiver } from '../src/transfer/receiver';
import { TransferSender } from '../src/transfer/sender';
import { InMemoryResumeStore } from '../src/transfer/resume-store';
import { BufferSink, flush, makeSource, manifestFor, pair, patternBytes } from './helpers';

describe('InMemoryResumeStore', () => {
  it('saves, loads, and clears records', async () => {
    const store = new InMemoryResumeStore();
    expect(await store.load('t1')).toBeNull();
    await store.save({ transferId: 't1', durableOffset: 256 });
    expect(await store.load('t1')).toEqual({ transferId: 't1', durableOffset: 256 });
    await store.clear('t1');
    expect(await store.load('t1')).toBeNull();
  });
});

describe('resume protocol', () => {
  it('receiver replies to the manifest with the persisted offset', async () => {
    const store = new InMemoryResumeStore();
    await store.save({ transferId: 't1', durableOffset: 512 });

    const [sa, sb] = pair();
    const outbound: TransferControlMessage[] = [];
    sa.onMessage((m: IncomingMessage) => {
      if (m.kind === 'control') outbound.push(m.msg);
    });
    new TransferReceiver({ channel: sb, sink: new BufferSink(), resumeStore: store });

    sb.peer = sa; // ensure receiver's replies reach our listener
    sa.sendControl({ t: 'manifest', manifest: manifestFor(1000) });
    await flush();

    expect(outbound).toContainEqual({ t: 'resume', durableOffset: 512 });
  });

  it('sender waits for the resume point and streams only the remainder', async () => {
    const data = patternBytes(1000);
    const [sa, sb] = pair();
    let dataBytes = 0;
    let firstByte = -1;
    sb.onMessage((m: IncomingMessage) => {
      if (m.kind === 'data') {
        if (firstByte < 0) firstByte = m.data[0]!;
        dataBytes += m.data.length;
      }
    });

    const sender = new TransferSender({
      channel: sa,
      source: makeSource(data),
      manifest: manifestFor(1000),
    });
    const started = sender.start();
    await flush();
    sb.sendControl({ t: 'resume', durableOffset: 512 });
    await started;
    await flush();

    expect(dataBytes).toBe(1000 - 512); // only the tail streamed
    expect(firstByte).toBe(data[512]); // started at the resume offset
  });

  it('resumes across a dropped connection and assembles the full file', async () => {
    const data = patternBytes(1000);
    const store = new InMemoryResumeStore();
    const sink = new BufferSink(); // persists across sessions (append)

    // Session 1: transfer, then drop the connection after the first block commits.
    const [a1, b1] = pair();
    const r1 = new TransferReceiver({ channel: b1, sink, resumeStore: store });
    const s1 = new TransferSender({
      channel: a1,
      source: makeSource(data),
      manifest: manifestFor(1000),
    });
    const cut = new Promise<void>((resolve) => {
      const off = r1.on('progress', (p) => {
        if (p.bytesTransferred >= 256) {
          a1.disconnect();
          b1.disconnect();
          s1.cancel();
          off();
          resolve();
        }
      });
    });
    void s1.start();
    await cut;
    await flush();

    const saved = await store.load('t1');
    expect(saved?.durableOffset).toBeGreaterThanOrEqual(256);
    expect(sink.bytes().length).toBe(saved?.durableOffset);

    // Session 2: fresh connection, same store + sink → completes the file.
    const [a2, b2] = pair();
    const r2 = new TransferReceiver({ channel: b2, sink, resumeStore: store });
    const done = new Promise<void>((resolve, reject) => {
      r2.on('done', resolve);
      r2.on('error', reject);
    });
    const s2 = new TransferSender({
      channel: a2,
      source: makeSource(data),
      manifest: manifestFor(1000),
    });
    await s2.start();
    await done;

    expect(sink.bytes()).toEqual(data);
    expect(await store.load('t1')).toBeNull(); // cleared on completion
  });
});
