import { describe, expect, it } from 'vitest';
import { TransferReceiver } from '../src/transfer/receiver';
import { TransferSender } from '../src/transfer/sender';
import { BufferSink, makeSource, manifestFor, pair, patternBytes } from './helpers';

describe('transfer round-trip', () => {
  it('delivers a multi-block file byte-for-byte and verifies integrity', async () => {
    const data = patternBytes(1000);
    const [sa, sb] = pair();
    const sink = new BufferSink();
    const receiver = new TransferReceiver({ channel: sb, sink });
    const done = new Promise<void>((resolve, reject) => {
      receiver.on('done', resolve);
      receiver.on('error', reject);
    });

    const sender = new TransferSender({
      channel: sa,
      source: makeSource(data),
      manifest: manifestFor(1000),
    });
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
    const sender = new TransferSender({
      channel: sa,
      source: makeSource(data),
      manifest: manifestFor(500),
    });
    await sender.start();
    await receiverDone;
    expect(last).toBe(500);
  });

  it('resolves a sink factory (with the manifest) before data flows', async () => {
    const data = patternBytes(400);
    const [sa, sb] = pair();
    const sink = new BufferSink();
    let factoryName: string | undefined;

    const receiver = new TransferReceiver({
      channel: sb,
      sink: (manifest) => {
        factoryName = manifest.files[0]?.path;
        return sink;
      },
    });
    const done = new Promise<void>((resolve, reject) => {
      receiver.on('done', resolve);
      receiver.on('error', reject);
    });
    const sender = new TransferSender({
      channel: sa,
      source: makeSource(data),
      manifest: manifestFor(400),
    });
    await sender.start();
    await done;

    expect(factoryName).toBe('f.bin'); // factory saw the real filename
    expect(sink.bytes()).toEqual(data);
  });

  it('rejects a tampered block via the hash check', async () => {
    const data = new Uint8Array(300).fill(3);
    const [sa, sb] = pair();
    sa.tamperOnce();
    const sink = new BufferSink();
    const receiver = new TransferReceiver({ channel: sb, sink });
    const errored = new Promise<Error>((resolve) => receiver.on('error', resolve));

    const sender = new TransferSender({
      channel: sa,
      source: makeSource(data),
      manifest: manifestFor(300),
    });
    await sender.start();
    const err = await errored;
    expect(err.message).toMatch(/integrity check failed/);
    expect(sink.closed).toBe(false);
  });
});
