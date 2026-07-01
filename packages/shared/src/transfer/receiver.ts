import type { Manifest } from '../protocol/manifest';
import type { TransferProgress } from '../types/transfer-state';
import type { IncomingMessage, Sink, TransferChannel } from './channel';
import type { ResumeStore } from './resume-store';
import { sha256Hex } from './integrity';

export interface ReceiverOptions {
  channel: TransferChannel;
  sink: Sink;
  /** When provided, durable offsets persist across sessions so transfers can resume. */
  resumeStore?: ResumeStore;
  now?: () => number;
}

interface ReceiverEvents {
  progress: (p: TransferProgress) => void;
  done: () => void;
  error: (err: Error) => void;
}

/**
 * Reassembles a file from interleaved data frames + block markers, verifies each block's hash
 * before writing it to the sink, persists + acks the durable offset, and completes when the
 * durable offset reaches the file size.
 *
 * On `manifest` it loads any persisted offset and replies with `resume`, telling the sender
 * where to continue. Messages run on a serial promise chain so async verification/persistence
 * never races the next message.
 */
export class TransferReceiver {
  private readonly channel: TransferChannel;
  private readonly sink: Sink;
  private readonly resumeStore: ResumeStore | undefined;
  private readonly now: () => number;

  private manifest: Manifest | null = null;
  private total = 0;
  private startedAt = 0;
  private baseline = 0;
  private durableOffset = 0;
  private blockParts: Uint8Array[] = [];
  private blockLength = 0;
  private chain: Promise<void> = Promise.resolve();
  private failed = false;

  private readonly listeners: { [K in keyof ReceiverEvents]: Set<ReceiverEvents[K]> } = {
    progress: new Set(),
    done: new Set(),
    error: new Set(),
  };

  constructor(opts: ReceiverOptions) {
    this.channel = opts.channel;
    this.sink = opts.sink;
    this.resumeStore = opts.resumeStore;
    this.now = opts.now ?? (() => Date.now());
    this.channel.onMessage((m) => {
      this.chain = this.chain.then(() => this.process(m));
    });
  }

  on<K extends keyof ReceiverEvents>(event: K, cb: ReceiverEvents[K]): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  private async process(m: IncomingMessage): Promise<void> {
    if (this.failed) return;

    if (m.kind === 'data') {
      this.blockParts.push(m.data);
      this.blockLength += m.data.length;
      return;
    }

    const msg = m.msg;
    switch (msg.t) {
      case 'manifest':
        await this.onManifest(msg.manifest);
        return;
      case 'block':
        await this.commitBlock(msg.index, msg.byteLength, msg.hash);
        return;
      case 'complete':
        await this.finish();
        return;
      case 'cancel':
        await this.sink.abort?.();
        this.fail(new Error('cancelled by sender'));
        return;
      default:
        return;
    }
  }

  private async onManifest(manifest: Manifest): Promise<void> {
    this.manifest = manifest;
    this.total = manifest.files.reduce((sum, f) => sum + f.size, 0);
    const record = await this.resumeStore?.load(manifest.transferId);
    this.durableOffset = record?.durableOffset ?? 0;
    this.baseline = this.durableOffset;
    this.startedAt = this.now();
    this.channel.sendControl({ t: 'resume', durableOffset: this.durableOffset });
  }

  private async commitBlock(index: number, byteLength: number, hash: string): Promise<void> {
    const block = concat(this.blockParts, this.blockLength);
    this.blockParts = [];
    this.blockLength = 0;

    if (block.length !== byteLength) {
      return this.fail(new Error(`block ${index} length mismatch`));
    }
    if ((await sha256Hex(block)) !== hash) {
      return this.fail(new Error(`block ${index} integrity check failed`));
    }

    await this.sink.write(block);
    this.durableOffset += block.length;
    if (this.manifest) {
      await this.resumeStore?.save({
        transferId: this.manifest.transferId,
        durableOffset: this.durableOffset,
      });
    }
    this.channel.sendControl({ t: 'ack', durableOffset: this.durableOffset });
    this.emitProgress();
  }

  private async finish(): Promise<void> {
    if (this.durableOffset !== this.total) {
      return this.fail(
        new Error(`incomplete transfer: ${this.durableOffset}/${this.total} bytes`),
      );
    }
    await this.sink.close();
    if (this.manifest) await this.resumeStore?.clear(this.manifest.transferId);
    this.emit('done');
  }

  private fail(err: Error): void {
    if (this.failed) return;
    this.failed = true;
    this.emit('error', err);
  }

  private emitProgress(): void {
    const elapsed = (this.now() - this.startedAt) / 1000;
    const bytesPerSecond = elapsed > 0 ? (this.durableOffset - this.baseline) / elapsed : 0;
    const etaSeconds = bytesPerSecond > 0 ? (this.total - this.durableOffset) / bytesPerSecond : 0;
    this.emit('progress', {
      transferId: this.manifest?.transferId ?? '',
      bytesTransferred: this.durableOffset,
      totalBytes: this.total,
      bytesPerSecond,
      etaSeconds,
    });
  }

  private emit<K extends keyof ReceiverEvents>(
    event: K,
    ...args: Parameters<ReceiverEvents[K]>
  ): void {
    for (const cb of this.listeners[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}

function concat(parts: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
