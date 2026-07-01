import type {
  ConnectionState,
  IceServer,
  Manifest,
  ReceiverOptions,
  ResumeStore,
  SenderOptions,
  Sink,
  TransferChannel,
  TransferProgress,
} from '@shareit/shared';
import { TransferReceiver, TransferSender } from '@shareit/shared';
import { DataChannelTransport } from '../transfer/data-channel-transport';
import { FileSource } from '../transfer/sources/file-source';
import { createManifest } from '../transfer/manifest';
import { PeerConnection, type OutboundSignal, type Role } from './peer-connection';
import { SignalingClient } from './signaling-client';

type Off = () => void;

/** Narrow port over SignalingClient so the controller is testable with a fake. */
export interface SignalingPort {
  connect(): void;
  create(): void;
  join(code: string): void;
  sendSignal(data: unknown): void;
  on(event: 'created', cb: (p: { code: string; iceServers: IceServer[] }) => void): Off;
  on(event: 'peer-joined', cb: () => void): Off;
  on(event: 'peer-left', cb: () => void): Off;
  on(event: 'signal', cb: (data: unknown) => void): Off;
  on(event: 'error', cb: (reason: string) => void): Off;
}

/** Narrow port over PeerConnection. */
export interface PeerPort {
  on(event: 'signal', cb: (d: OutboundSignal) => void): Off;
  on(event: 'state', cb: (s: ConnectionState) => void): Off;
  on(event: 'error', cb: (e: Error) => void): Off;
  start(): Promise<void>;
  handleSignal(d: OutboundSignal): Promise<void>;
  ready(): Promise<RTCDataChannel>;
  authString(): Promise<string | null>;
  close(): void;
}

export interface SessionDeps {
  signalingUrl: string;
  createSignaling: (url: string) => SignalingPort;
  createPeer: (role: Role, iceServers: IceServer[]) => PeerPort;
  createTransport: (channel: RTCDataChannel) => TransferChannel;
  createSender: (opts: SenderOptions) => TransferSender;
  createReceiver: (opts: ReceiverOptions) => TransferReceiver;
}

export interface ReceiveOptions {
  sink: Sink;
  resumeStore?: ResumeStore;
}

interface SessionEvents {
  code: (code: string) => void;
  state: (s: ConnectionState) => void;
  progress: (p: TransferProgress) => void;
  manifest: (m: Manifest) => void;
  sas: (code: string | null) => void;
  done: () => void;
  error: (err: Error) => void;
}

const defaultDeps = (signalingUrl: string): SessionDeps => ({
  signalingUrl,
  createSignaling: (url) => new SignalingClient(url) as unknown as SignalingPort,
  createPeer: (role, iceServers) =>
    new PeerConnection({ role, iceServers }) as unknown as PeerPort,
  createTransport: (channel) => new DataChannelTransport(channel),
  createSender: (opts) => new TransferSender(opts),
  createReceiver: (opts) => new TransferReceiver(opts),
});

/**
 * Ties the four layers into one flow: signaling → peer connection → transport → engine.
 * The creator (offerer) sends a file; the joiner (answerer) receives it. Every collaborator is
 * injected (defaults are the real ones) so the wiring is unit-testable without a browser.
 */
export class TransferSession {
  private readonly deps: SessionDeps;
  private signaling: SignalingPort | null = null;
  private peer: PeerPort | null = null;
  private readonly listeners: { [K in keyof SessionEvents]: Set<SessionEvents[K]> } = {
    code: new Set(),
    state: new Set(),
    progress: new Set(),
    manifest: new Set(),
    sas: new Set(),
    done: new Set(),
    error: new Set(),
  };

  constructor(deps?: Partial<SessionDeps> & { signalingUrl: string }) {
    this.deps = { ...defaultDeps(deps?.signalingUrl ?? ''), ...deps };
  }

  on<K extends keyof SessionEvents>(event: K, cb: SessionEvents[K]): Off {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  /** Sender flow: create a pairing code, wait for a peer, then stream the file. */
  send(file: File): void {
    const signaling = this.deps.createSignaling(this.deps.signalingUrl);
    this.signaling = signaling;
    let iceServers: IceServer[] = [];

    signaling.on('created', (p) => {
      iceServers = p.iceServers;
      this.emit('code', p.code);
    });
    signaling.on('peer-joined', () => void this.runPeer('offerer', iceServers, (channel) => this.startSend(file, channel)));
    signaling.on('signal', (d) => void this.peer?.handleSignal(d as OutboundSignal));
    signaling.on('peer-left', () => this.emit('error', new Error('peer left')));
    signaling.on('error', (reason) => this.emit('error', new Error(reason)));

    signaling.connect();
    signaling.create();
  }

  /** Receiver flow: join a code, then reassemble the file into the provided sink. */
  receive(code: string, options: ReceiveOptions): void {
    const signaling = this.deps.createSignaling(this.deps.signalingUrl);
    this.signaling = signaling;

    signaling.on('created', (p) =>
      void this.runPeer('answerer', p.iceServers, (channel) => this.startReceive(channel, options)),
    );
    signaling.on('signal', (d) => void this.peer?.handleSignal(d as OutboundSignal));
    signaling.on('peer-left', () => this.emit('error', new Error('peer left')));
    signaling.on('error', (reason) => this.emit('error', new Error(reason)));

    signaling.connect();
    signaling.join(code);
  }

  close(): void {
    this.peer?.close();
  }

  private async runPeer(
    role: Role,
    iceServers: IceServer[],
    onChannel: (channel: RTCDataChannel) => Promise<void>,
  ): Promise<void> {
    try {
      const peer = this.deps.createPeer(role, iceServers);
      this.peer = peer;
      peer.on('signal', (s) => this.signaling?.sendSignal(s));
      peer.on('state', (s) => this.emit('state', s));
      peer.on('error', (e) => this.emit('error', e));

      await peer.start();
      const channel = await peer.ready();
      this.emit('sas', await peer.authString());
      await onChannel(channel);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async startSend(file: File, channel: RTCDataChannel): Promise<void> {
    const transport = this.deps.createTransport(channel);
    const manifest = await createManifest(file);
    this.emit('manifest', manifest);

    const sender = this.deps.createSender({
      channel: transport,
      source: new FileSource(file),
      manifest,
    });
    sender.on('progress', (p) => this.emit('progress', p));
    sender.on('done', () => this.emit('done'));
    sender.on('error', (e) => this.emit('error', e));
    await sender.start();
  }

  private startReceive(channel: RTCDataChannel, options: ReceiveOptions): Promise<void> {
    const transport = this.deps.createTransport(channel);
    const receiver = this.deps.createReceiver({
      channel: transport,
      sink: options.sink,
      resumeStore: options.resumeStore,
      onManifest: (m) => this.emit('manifest', m),
    });
    receiver.on('progress', (p) => this.emit('progress', p));
    receiver.on('done', () => this.emit('done'));
    receiver.on('error', (e) => this.emit('error', e));
    return Promise.resolve();
  }

  private emit<K extends keyof SessionEvents>(
    event: K,
    ...args: Parameters<SessionEvents[K]>
  ): void {
    for (const cb of this.listeners[event]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}

export { defaultDeps };
