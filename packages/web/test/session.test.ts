import type { TransferChannel } from '@shareit/shared';
import { describe, expect, it, vi } from 'vitest';
import type { OutboundSignal, Role } from '../src/connection/peer-connection';
import { TransferSession, type PeerPort, type SignalingPort } from '../src/connection/session';

/** Fake signaling that records handlers so the test can drive server events. */
class FakeSignaling {
  handlers: Record<string, (arg?: unknown) => void> = {};
  connected = false;
  created = false;
  joined: string | null = null;
  sent: unknown[] = [];

  connect(): void {
    this.connected = true;
  }
  create(): void {
    this.created = true;
  }
  join(code: string): void {
    this.joined = code;
  }
  sendSignal(data: unknown): void {
    this.sent.push(data);
  }
  on(event: string, cb: (arg?: unknown) => void): () => void {
    this.handlers[event] = cb;
    return () => delete this.handlers[event];
  }
  fire(event: string, arg?: unknown): void {
    this.handlers[event]?.(arg);
  }
}

class FakePeer {
  handlers: Record<string, (arg?: unknown) => void> = {};
  started = false;
  handled: OutboundSignal[] = [];
  constructor(
    readonly role: Role,
    private readonly channel: RTCDataChannel,
  ) {}
  on(event: string, cb: (arg?: unknown) => void): () => void {
    this.handlers[event] = cb;
    return () => delete this.handlers[event];
  }
  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }
  handleSignal(d: OutboundSignal): Promise<void> {
    this.handled.push(d);
    return Promise.resolve();
  }
  ready(): Promise<RTCDataChannel> {
    return Promise.resolve(this.channel);
  }
  authString(): Promise<string | null> {
    return Promise.resolve('123456');
  }
  close(): void {}
  emit(event: string, arg?: unknown): void {
    this.handlers[event]?.(arg);
  }
}

const fakeChannel = {} as RTCDataChannel;
const fakeTransport: TransferChannel = {
  sendControl: () => undefined,
  sendData: () => Promise.resolve(),
  onMessage: () => undefined,
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('TransferSession wiring', () => {
  it('sender: emits the code, starts the offerer on peer-joined, and forwards signals', async () => {
    const signaling = new FakeSignaling();
    let peer: FakePeer | null = null;
    const senderStart = vi.fn(() => Promise.resolve());

    const session = new TransferSession({
      signalingUrl: 'ws://x',
      createSignaling: () => signaling as unknown as SignalingPort,
      createPeer: (role) => (peer = new FakePeer(role, fakeChannel)) as unknown as PeerPort,
      createTransport: () => fakeTransport,
      createSender: () => ({ on: () => () => undefined, start: senderStart }) as never,
      createReceiver: () => ({ on: () => () => undefined }) as never,
    });

    const codeSeen = vi.fn();
    session.on('code', codeSeen);
    session.send(new File(['hello'], 'hello.txt'));

    expect(signaling.connected).toBe(true);
    expect(signaling.created).toBe(true);

    signaling.fire('created', { code: 'ABCDEF', iceServers: [] });
    expect(codeSeen).toHaveBeenCalledWith('ABCDEF');

    signaling.fire('peer-joined');
    // Wait for the async handshake (incl. real createManifest hashing) to reach sender.start().
    for (let i = 0; i < 20 && senderStart.mock.calls.length === 0; i += 1) await tick();

    expect(peer).not.toBeNull();
    expect(peer!.role).toBe('offerer');
    expect(peer!.started).toBe(true);
    expect(senderStart).toHaveBeenCalledOnce();

    // Peer's outbound signal is forwarded to signaling; inbound signal reaches the peer.
    peer!.emit('signal', { kind: 'ice', candidate: { candidate: 'c' } });
    expect(signaling.sent.at(-1)).toEqual({ kind: 'ice', candidate: { candidate: 'c' } });
    signaling.fire('signal', { kind: 'sdp', sdp: { type: 'answer', sdp: 'a' } });
    await tick();
    expect(peer!.handled.at(-1)).toEqual({ kind: 'sdp', sdp: { type: 'answer', sdp: 'a' } });
  });

  it('receiver: joins with the code and starts the answerer on created', async () => {
    const signaling = new FakeSignaling();
    let peer: FakePeer | null = null;

    const session = new TransferSession({
      signalingUrl: 'ws://x',
      createSignaling: () => signaling as unknown as SignalingPort,
      createPeer: (role) => (peer = new FakePeer(role, fakeChannel)) as unknown as PeerPort,
      createTransport: () => fakeTransport,
      createSender: () => ({ on: () => () => undefined, start: () => Promise.resolve() }) as never,
      createReceiver: () => ({ on: () => () => undefined }) as never,
    });

    session.receive('ABCDEF', { sink: { write: () => Promise.resolve(), close: () => Promise.resolve() } });
    expect(signaling.joined).toBe('ABCDEF');

    signaling.fire('created', { code: 'ABCDEF', iceServers: [] });
    for (let i = 0; i < 20 && !peer; i += 1) await tick();

    expect(peer!.role).toBe('answerer');
    expect(peer!.started).toBe(true);
  });
});
