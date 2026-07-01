import type { TransferControlMessage } from '../protocol/control-messages';

/** Reads bytes from a file/blob-like source at arbitrary offsets (resume-friendly). */
export interface Source {
  readonly size: number;
  slice(start: number, end: number): Promise<Uint8Array>;
}

/** Writes received bytes to their destination (disk stream, memory buffer, …). */
export interface Sink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export type IncomingMessage =
  | { kind: 'control'; msg: TransferControlMessage }
  | { kind: 'data'; data: Uint8Array };

/**
 * The transport seam the engine talks to. Control messages go as JSON; data goes as raw
 * binary with backpressure. A concrete implementation wraps an RTCDataChannel (web); tests use
 * an in-memory loopback.
 */
export interface TransferChannel {
  sendControl(msg: TransferControlMessage): void;
  sendData(data: Uint8Array): Promise<void>;
  onMessage(cb: (m: IncomingMessage) => void): void;
}
