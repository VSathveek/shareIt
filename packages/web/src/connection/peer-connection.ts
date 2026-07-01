import {
  deriveShortAuthString,
  parseDtlsFingerprint,
  type ConnectionState,
  type IceServer,
} from '@shareit/shared';

export type Role = 'offerer' | 'answerer';

/** Opaque signal payloads exchanged via the signaling channel (server never inspects these). */
export type OutboundSignal =
  | { kind: 'sdp'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export interface PeerConnectionEvents {
  /** Emit outward via SignalingClient.sendSignal. */
  signal: (data: OutboundSignal) => void;
  state: (state: ConnectionState) => void;
  /** Fires once the DataChannel is open and ready for bytes. */
  datachannel: (channel: RTCDataChannel) => void;
  error: (err: Error) => void;
}

export interface PeerConnectionOptions {
  role: Role;
  iceServers: IceServer[];
  rtcFactory?: (config: RTCConfiguration) => RTCPeerConnection;
  dataChannelLabel?: string;
}

const DATA_CHANNEL_LABEL = 'shareit-data';

function mapState(s: RTCPeerConnectionState): ConnectionState {
  switch (s) {
    case 'new':
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'disconnected':
      return 'disconnected';
    case 'failed':
      return 'failed';
    case 'closed':
      return 'closed';
  }
}

/**
 * Owns one RTCPeerConnection + its DataChannel over the full lifecycle (Phase 2, §3).
 *
 * Roles: the *offerer* (the pairing creator) creates the DataChannel and the initial offer;
 * the *answerer* waits for the offer and replies. ICE is trickled both ways. Incoming ICE
 * candidates that arrive before the remote description is set are buffered and flushed after,
 * which is the common source of flaky connects if not handled.
 *
 * The RTCPeerConnection is injected so the logic is unit-testable without a browser.
 */
export class PeerConnection {
  private readonly pc: RTCPeerConnection;
  private readonly role: Role;
  private readonly label: string;
  private channel: RTCDataChannel | null = null;
  private remoteDescriptionSet = false;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private state: ConnectionState = 'idle';
  private localFingerprint: string | null = null;
  private remoteFingerprint: string | null = null;
  private resolveReady!: (channel: RTCDataChannel) => void;
  private readonly readyPromise: Promise<RTCDataChannel>;

  private readonly listeners: { [K in keyof PeerConnectionEvents]: Set<PeerConnectionEvents[K]> } =
    {
      signal: new Set(),
      state: new Set(),
      datachannel: new Set(),
      error: new Set(),
    };

  constructor(opts: PeerConnectionOptions) {
    this.role = opts.role;
    this.label = opts.dataChannelLabel ?? DATA_CHANNEL_LABEL;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    const factory = opts.rtcFactory ?? ((config) => new RTCPeerConnection(config));
    this.pc = factory({ iceServers: opts.iceServers as RTCIceServer[] });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.emit('signal', { kind: 'ice', candidate: ev.candidate.toJSON() });
      }
    };
    this.pc.onconnectionstatechange = () => this.setState(mapState(this.pc.connectionState));

    if (this.role === 'answerer') {
      this.pc.ondatachannel = (ev) => this.adoptChannel(ev.channel);
    }
  }

  on<K extends keyof PeerConnectionEvents>(event: K, cb: PeerConnectionEvents[K]): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  /** Resolves when the DataChannel is open. */
  ready(): Promise<RTCDataChannel> {
    return this.readyPromise;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  /** Offerer: create channel + offer. Answerer: wait for the incoming offer. */
  async start(): Promise<void> {
    this.setState('signaling');
    if (this.role !== 'offerer') return;

    const channel = this.pc.createDataChannel(this.label, { ordered: true });
    this.adoptChannel(channel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.localFingerprint = parseDtlsFingerprint(offer.sdp ?? '');
    this.emit('signal', { kind: 'sdp', sdp: offer });
  }

  /**
   * Short verification code derived from both peers' DTLS fingerprints. Users compare it
   * out-of-band to detect a MITM by the signaling server. Null until both descriptions are set.
   */
  async authString(): Promise<string | null> {
    if (!this.localFingerprint || !this.remoteFingerprint) return null;
    return deriveShortAuthString(this.localFingerprint, this.remoteFingerprint);
  }

  /** Handle an inbound signal (SDP or ICE) received via signaling. */
  async handleSignal(data: OutboundSignal): Promise<void> {
    try {
      if (data.kind === 'sdp') {
        await this.pc.setRemoteDescription(data.sdp);
        this.remoteDescriptionSet = true;
        this.remoteFingerprint = parseDtlsFingerprint(data.sdp.sdp ?? '');
        await this.flushCandidates();
        if (data.sdp.type === 'offer') {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.localFingerprint = parseDtlsFingerprint(answer.sdp ?? '');
          this.emit('signal', { kind: 'sdp', sdp: answer });
        }
      } else {
        if (this.remoteDescriptionSet) {
          await this.pc.addIceCandidate(data.candidate);
        } else {
          this.pendingCandidates.push(data.candidate);
        }
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Renegotiate ICE after a network change (Phase 2 failure recovery). Offerer-driven. */
  async restartIce(): Promise<void> {
    this.setState('reconnecting');
    if (this.role !== 'offerer') return;
    const offer = await this.pc.createOffer({ iceRestart: true });
    await this.pc.setLocalDescription(offer);
    this.emit('signal', { kind: 'sdp', sdp: offer });
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
    this.setState('closed');
  }

  private adoptChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    this.channel = channel;
    const onOpen = () => {
      this.emit('datachannel', channel);
      this.resolveReady(channel);
    };
    if (channel.readyState === 'open') onOpen();
    else channel.onopen = onOpen;
  }

  private async flushCandidates(): Promise<void> {
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift() as RTCIceCandidateInit;
      await this.pc.addIceCandidate(candidate);
    }
  }

  private setState(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.emit('state', state);
  }

  private emit<K extends keyof PeerConnectionEvents>(
    event: K,
    ...args: Parameters<PeerConnectionEvents[K]>
  ): void {
    for (const cb of this.listeners[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}
