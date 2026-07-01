import type { IceServer, SignalingMessage } from '@shareit/shared';

/** Minimal surface of a WebSocket, so tests can inject a fake. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface SignalingEvents {
  created: (payload: { code: string; iceServers: IceServer[] }) => void;
  'peer-joined': () => void;
  'peer-left': () => void;
  signal: (data: unknown) => void;
  error: (reason: string) => void;
  state: (state: SignalingState) => void;
}

export type SignalingState = 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface SignalingClientOptions {
  socketFactory?: SocketFactory;
  /** Reconnect backoff schedule in ms; caps at the last entry. */
  backoffMs?: number[];
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
}

const OPEN = 1;

/**
 * Browser-side signaling transport. Owns the WebSocket to the signaling server, buffers
 * outgoing messages until the socket is open, reconnects with backoff, and surfaces typed
 * events. Framework-agnostic (no React) so it is reusable and unit-testable.
 */
export class SignalingClient {
  private socket: SocketLike | null = null;
  private readonly outbox: SignalingMessage[] = [];
  private readonly listeners: { [K in keyof SignalingEvents]: Set<SignalingEvents[K]> } = {
    created: new Set(),
    'peer-joined': new Set(),
    'peer-left': new Set(),
    signal: new Set(),
    error: new Set(),
    state: new Set(),
  };
  private readonly factory: SocketFactory;
  private readonly backoff: number[];
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private attempt = 0;
  private closedByUser = false;

  constructor(
    private readonly url: string,
    opts: SignalingClientOptions = {},
  ) {
    this.factory = opts.socketFactory ?? ((u) => new WebSocket(u) as unknown as SocketLike);
    this.backoff = opts.backoffMs ?? [500, 1000, 2000, 5000, 10000];
    this.schedule = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  }

  connect(): void {
    this.closedByUser = false;
    this.emit('state', this.attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = this.factory(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.emit('state', 'open');
      this.flush();
    };
    socket.onmessage = (ev) => this.handle(ev.data);
    socket.onerror = () => this.emit('error', 'socket error');
    socket.onclose = () => {
      this.emit('state', 'closed');
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  create(): void {
    this.enqueue({ t: 'create' });
  }

  join(code: string): void {
    this.enqueue({ t: 'join', code });
  }

  sendSignal(data: unknown): void {
    this.enqueue({ t: 'signal', data: data as never });
  }

  on<K extends keyof SignalingEvents>(event: K, cb: SignalingEvents[K]): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close();
    this.socket = null;
  }

  private enqueue(msg: SignalingMessage): void {
    this.outbox.push(msg);
    this.flush();
  }

  private flush(): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    while (this.outbox.length > 0) {
      const msg = this.outbox.shift() as SignalingMessage;
      this.socket.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 5000;
    this.attempt += 1;
    this.schedule(() => {
      if (!this.closedByUser) this.connect();
    }, delay);
  }

  private handle(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: SignalingMessage;
    try {
      msg = JSON.parse(raw) as SignalingMessage;
    } catch {
      return;
    }

    switch (msg.t) {
      case 'created':
        this.emit('created', { code: msg.code, iceServers: msg.iceServers });
        break;
      case 'peer-joined':
        this.emit('peer-joined');
        break;
      case 'peer-left':
        this.emit('peer-left');
        break;
      case 'signal':
        this.emit('signal', msg.data);
        break;
      case 'error':
        this.emit('error', msg.reason);
        break;
      default:
        break;
    }
  }

  private emit<K extends keyof SignalingEvents>(
    event: K,
    ...args: Parameters<SignalingEvents[K]>
  ): void {
    for (const cb of this.listeners[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}
