import type { Manifest } from '../protocol/manifest';
import type { TransferProgress } from '../types/transfer-state';
import type { Source, TransferChannel } from './channel';
import { merkleRoot, sha256Hex } from './integrity';

export class TransferCancelledError extends Error {
  constructor() {
    super('transfer cancelled');
    this.name = 'TransferCancelledError';
  }
}

export interface SenderOptions {
  manifest: Manifest;
  source: Source;
  channel: TransferChannel;
  now?: () => number;
}

interface SenderEvents {
  progress: (p: TransferProgress) => void;
  done: () => void;
  error: (err: Error) => void;
}

/**
 * Streams one file to the peer: manifest → per-block { data frames, block marker } → complete.
 * Reads a block, hashes it, sends its chunks with backpressure, then the block marker. Pause
 * and cancel are cooperative — checked at each chunk boundary.
 */
export class TransferSender {
  private readonly manifest: Manifest;
  private readonly source: Source;
  private readonly channel: TransferChannel;
  private readonly now: () => number;

  private paused = false;
  private cancelled = false;
  private resumeWaiters: Array<() => void> = [];
  private readonly listeners: { [K in keyof SenderEvents]: Set<SenderEvents[K]> } = {
    progress: new Set(),
    done: new Set(),
    error: new Set(),
  };

  constructor(opts: SenderOptions) {
    this.manifest = opts.manifest;
    this.source = opts.source;
    this.channel = opts.channel;
    this.now = opts.now ?? (() => Date.now());
  }

  on<K extends keyof SenderEvents>(event: K, cb: SenderEvents[K]): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const w of waiters) w();
  }

  cancel(): void {
    this.cancelled = true;
    this.resume();
  }

  async start(): Promise<void> {
    try {
      await this.run();
      this.emit('done');
    } catch (err) {
      if (err instanceof TransferCancelledError) {
        this.channel.sendControl({ t: 'cancel' });
      }
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async run(): Promise<void> {
    const file = this.manifest.files[0];
    if (!file) throw new Error('manifest has no files');

    const { chunkSize, blockSize } = this.manifest;
    const total = file.size;
    const blockHashes: string[] = [];
    const startedAt = this.now();
    let sent = 0;

    this.channel.sendControl({ t: 'manifest', manifest: this.manifest });

    for (let index = 0, start = 0; start < total; index += 1, start += blockSize) {
      const end = Math.min(start + blockSize, total);
      const block = await this.source.slice(start, end);
      const hash = await sha256Hex(block);
      blockHashes.push(hash);

      for (let offset = 0; offset < block.length; offset += chunkSize) {
        await this.waitIfPaused();
        if (this.cancelled) throw new TransferCancelledError();

        const chunk = block.subarray(offset, Math.min(offset + chunkSize, block.length));
        await this.channel.sendData(chunk);
        sent += chunk.length;
        this.emitProgress(sent, total, startedAt);
      }

      this.channel.sendControl({ t: 'block', index, byteLength: block.length, hash });
    }

    const root = await merkleRoot(blockHashes);
    this.channel.sendControl({ t: 'complete', merkleRoot: root });
  }

  private waitIfPaused(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
  }

  private emitProgress(transferred: number, total: number, startedAt: number): void {
    const elapsed = (this.now() - startedAt) / 1000;
    const bytesPerSecond = elapsed > 0 ? transferred / elapsed : 0;
    const etaSeconds = bytesPerSecond > 0 ? (total - transferred) / bytesPerSecond : 0;
    this.emit('progress', {
      transferId: this.manifest.transferId,
      bytesTransferred: transferred,
      totalBytes: total,
      bytesPerSecond,
      etaSeconds,
    });
  }

  private emit<K extends keyof SenderEvents>(
    event: K,
    ...args: Parameters<SenderEvents[K]>
  ): void {
    for (const cb of this.listeners[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}
