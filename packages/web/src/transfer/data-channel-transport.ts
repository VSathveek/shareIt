import {
  BackpressuredWriter,
  type ChannelLike,
  type IncomingMessage,
  type TransferChannel,
  type TransferControlMessage,
} from '@shareit/shared';

/**
 * Adapts an open RTCDataChannel to the engine's `TransferChannel`: control messages are JSON
 * strings, data is raw binary sent through the backpressured writer. Messages that arrive
 * before a subscriber attaches are buffered so nothing is dropped during setup.
 */
export class DataChannelTransport implements TransferChannel {
  private readonly writer: BackpressuredWriter;
  private cb: ((m: IncomingMessage) => void) | null = null;
  private readonly buffered: IncomingMessage[] = [];

  constructor(private readonly channel: RTCDataChannel, highWaterMark?: number) {
    channel.binaryType = 'arraybuffer';
    // RTCDataChannel structurally satisfies ChannelLike; the DOM event-handler signatures
    // differ nominally, so cast at this single boundary.
    this.writer = new BackpressuredWriter(channel as unknown as ChannelLike, highWaterMark);
    channel.onmessage = (ev: MessageEvent) => this.deliver(ev.data);
  }

  sendControl(msg: TransferControlMessage): void {
    this.channel.send(JSON.stringify(msg));
  }

  sendData(data: Uint8Array): Promise<void> {
    return this.writer.write(data);
  }

  onMessage(cb: (m: IncomingMessage) => void): void {
    this.cb = cb;
    for (const m of this.buffered) cb(m);
    this.buffered.length = 0;
  }

  private deliver(data: unknown): void {
    let message: IncomingMessage;
    if (typeof data === 'string') {
      message = { kind: 'control', msg: JSON.parse(data) as TransferControlMessage };
    } else if (data instanceof ArrayBuffer) {
      message = { kind: 'data', data: new Uint8Array(data) };
    } else {
      return;
    }
    if (this.cb) this.cb(message);
    else this.buffered.push(message);
  }
}
