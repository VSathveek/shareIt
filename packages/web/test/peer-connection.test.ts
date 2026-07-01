import { describe, expect, it } from 'vitest';
import {
  PeerConnection,
  type OutboundSignal,
  type Role,
} from '../src/connection/peer-connection';

type ChannelState = 'connecting' | 'open' | 'closing' | 'closed';

class MockDataChannel {
  binaryType: 'blob' | 'arraybuffer' = 'blob';
  readyState: ChannelState = 'connecting';
  onopen: (() => void) | null = null;
  sent: unknown[] = [];
  constructor(readonly label: string) {}
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 'closed';
  }
  open(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
}

class MockPeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((ev: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null =
    null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: MockDataChannel }) => void) | null = null;

  channels: MockDataChannel[] = [];
  added: RTCIceCandidateInit[] = [];
  offerOptions: RTCOfferOptions[] = [];

  createDataChannel(label: string): MockDataChannel {
    const c = new MockDataChannel(label);
    this.channels.push(c);
    return c;
  }
  async createOffer(opts: RTCOfferOptions = {}): Promise<RTCSessionDescriptionInit> {
    this.offerOptions.push(opts);
    return { type: 'offer', sdp: `offer-${this.offerOptions.length}` };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'answer-1' };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = d;
  }
  async addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    this.added.push(c);
  }
  close(): void {
    this.connectionState = 'closed';
  }

  // test drivers
  emitIce(candidate: RTCIceCandidateInit | null): void {
    this.onicecandidate?.({ candidate: candidate ? { toJSON: () => candidate } : null });
  }
  setConnState(s: RTCPeerConnectionState): void {
    this.connectionState = s;
    this.onconnectionstatechange?.();
  }
  emitDataChannel(channel: MockDataChannel): void {
    this.ondatachannel?.({ channel });
  }
}

function makePeer(role: Role) {
  const mock = new MockPeerConnection();
  const signals: OutboundSignal[] = [];
  const states: string[] = [];
  const channels: MockDataChannel[] = [];
  const pc = new PeerConnection({
    role,
    iceServers: [{ urls: 'stun:x' }],
    rtcFactory: () => mock as unknown as RTCPeerConnection,
  });
  pc.on('signal', (s) => signals.push(s));
  pc.on('state', (s) => states.push(s));
  pc.on('datachannel', (c) => channels.push(c as unknown as MockDataChannel));
  return { mock, pc, signals, states, channels };
}

describe('PeerConnection', () => {
  it('offerer creates a channel and emits an offer', async () => {
    const { mock, pc, signals } = makePeer('offerer');
    await pc.start();

    expect(mock.channels).toHaveLength(1);
    expect(mock.localDescription).toEqual({ type: 'offer', sdp: 'offer-1' });
    expect(signals).toContainEqual({ kind: 'sdp', sdp: { type: 'offer', sdp: 'offer-1' } });
  });

  it('offerer applies the answer then adds ICE candidates', async () => {
    const { mock, pc } = makePeer('offerer');
    await pc.start();
    await pc.handleSignal({ kind: 'sdp', sdp: { type: 'answer', sdp: 'a' } });
    expect(mock.remoteDescription).toEqual({ type: 'answer', sdp: 'a' });

    await pc.handleSignal({ kind: 'ice', candidate: { candidate: 'c1' } });
    expect(mock.added).toContainEqual({ candidate: 'c1' });
  });

  it('answerer buffers ICE until the offer arrives, then answers', async () => {
    const { mock, pc, signals } = makePeer('answerer');
    await pc.start();

    await pc.handleSignal({ kind: 'ice', candidate: { candidate: 'early' } });
    expect(mock.added).toHaveLength(0); // buffered

    await pc.handleSignal({ kind: 'sdp', sdp: { type: 'offer', sdp: 'off' } });
    expect(mock.remoteDescription).toEqual({ type: 'offer', sdp: 'off' });
    expect(mock.added).toContainEqual({ candidate: 'early' }); // flushed
    expect(signals).toContainEqual({ kind: 'sdp', sdp: { type: 'answer', sdp: 'answer-1' } });
  });

  it('trickles locally-gathered ICE candidates outward', async () => {
    const { mock, pc, signals } = makePeer('offerer');
    await pc.start();
    mock.emitIce({ candidate: 'host-1' });
    mock.emitIce(null); // gathering complete → no signal
    expect(signals).toContainEqual({ kind: 'ice', candidate: { candidate: 'host-1' } });
    expect(signals.filter((s) => s.kind === 'ice')).toHaveLength(1);
  });

  it('resolves ready() when the DataChannel opens (offerer)', async () => {
    const { mock, pc, channels } = makePeer('offerer');
    await pc.start();
    mock.channels[0]?.open();

    expect(channels).toHaveLength(1);
    await expect(pc.ready()).resolves.toBe(mock.channels[0] as unknown as RTCDataChannel);
  });

  it('adopts the remote DataChannel (answerer) as binary', () => {
    const { mock, channels } = makePeer('answerer');
    const remote = new MockDataChannel('shareit-data');
    mock.emitDataChannel(remote);
    remote.open();

    expect(channels[0]).toBe(remote);
    expect(remote.binaryType).toBe('arraybuffer');
  });

  it('maps RTCPeerConnection states to ConnectionState', async () => {
    const { mock, pc, states } = makePeer('offerer');
    await pc.start();
    mock.setConnState('connected');
    mock.setConnState('failed');
    expect(states).toContain('signaling');
    expect(states).toContain('connected');
    expect(states).toContain('failed');
  });

  it('offerer restarts ICE with a fresh offer', async () => {
    const { mock, pc, signals } = makePeer('offerer');
    await pc.start();
    await pc.restartIce();

    expect(mock.offerOptions.at(-1)).toEqual({ iceRestart: true });
    expect(signals.at(-1)).toEqual({ kind: 'sdp', sdp: { type: 'offer', sdp: 'offer-2' } });
    expect(pc.connectionState).toBe('reconnecting');
  });
});
