import { describe, expect, it } from 'vitest';
import { TransferReceiver } from '../src/transfer/receiver';
import { TransferSender } from '../src/transfer/sender';
import { BufferSink, flush, makeSource, manifestFor, pair, patternBytes } from './helpers';

async function transfer(size: number, chunkSize = 64, blockSize = 256): Promise<Uint8Array> {
  const data = patternBytes(size);
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
    manifest: manifestFor(size, chunkSize, blockSize),
  });
  await sender.start();
  await done;
  expect(sink.closed).toBe(true);
  return sink.bytes();
}

describe('transfer edge cases', () => {
  it('handles an empty file', async () => {
    expect(await transfer(0)).toEqual(new Uint8Array(0));
  });

  it('handles a single byte', async () => {
    expect(await transfer(1)).toEqual(patternBytes(1));
  });

  it('handles a size that is an exact block-boundary multiple', async () => {
    expect(await transfer(512)).toEqual(patternBytes(512)); // exactly 2 blocks
  });

  it('handles a partial final block and partial final chunk', async () => {
    expect(await transfer(613, 64, 256)).toEqual(patternBytes(613));
  });

  it('handles a chunk size that does not divide the block size', async () => {
    expect(await transfer(1000, 60, 256)).toEqual(patternBytes(1000));
  });
});

describe('cancel and pause', () => {
  it('cancelling mid-transfer aborts the receiver sink', async () => {
    const data = patternBytes(2000);
    const [sa, sb] = pair();
    const sink = new BufferSink();
    const receiver = new TransferReceiver({ channel: sb, sink });

    let cancelled = false;
    receiver.on('progress', () => {
      if (!cancelled) {
        cancelled = true;
        sender.cancel();
      }
    });
    const recvErr = new Promise<Error>((resolve) => receiver.on('error', resolve));

    const sender = new TransferSender({
      channel: sa,
      source: makeSource(data),
      manifest: manifestFor(2000),
    });
    await sender.start();
    const err = await recvErr;
    await flush();

    expect(err.message).toMatch(/cancelled by sender/);
    expect(sink.aborted).toBe(true);
    expect(sink.closed).toBe(false);
  });

  it('pausing then resuming still completes the transfer', async () => {
    const data = patternBytes(800);
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
      manifest: manifestFor(800),
    });

    sender.pause();
    const started = sender.start();
    await flush();
    sender.resume();
    await started;
    await done;

    expect(sink.bytes()).toEqual(data);
  });
});
