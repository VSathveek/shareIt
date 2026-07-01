/**
 * The minimal slice of RTCDataChannel needed to send with backpressure. Kept as an interface
 * so the writer is testable with a fake and the shared package stays DOM-free.
 */
export interface ChannelLike {
  send(data: Uint8Array): void;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  onbufferedamountlow: (() => void) | null;
}

/**
 * Bounds in-flight memory regardless of file size (Phase 2, §4): after a send pushes the
 * channel's buffered amount past the high-water mark, `write` returns a promise that only
 * resolves once the channel drains below the low-water mark. This is what makes 1TB transfers
 * possible without buffering the file.
 */
export class BackpressuredWriter {
  private waiter: Promise<void> | null = null;
  private release: (() => void) | null = null;

  constructor(
    private readonly channel: ChannelLike,
    private readonly highWaterMark = 16 * 1024 * 1024,
    lowWaterMark = 1 * 1024 * 1024,
  ) {
    this.channel.bufferedAmountLowThreshold = lowWaterMark;
    this.channel.onbufferedamountlow = () => {
      this.release?.();
      this.waiter = null;
      this.release = null;
    };
  }

  async write(data: Uint8Array): Promise<void> {
    this.channel.send(data);
    if (this.channel.bufferedAmount > this.highWaterMark) {
      this.waiter ??= new Promise<void>((resolve) => {
        this.release = resolve;
      });
      await this.waiter;
    }
  }
}
