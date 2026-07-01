/**
 * Wire contract for the signaling channel and the in-band control stream.
 *
 * This union is shared verbatim by the browser client and the signaling server so both
 * ends validate against the same shape. File data travels as raw binary frames interleaved
 * with these; everything here is small JSON control traffic.
 */

import type { Manifest } from './manifest';

/** ICE server entry handed to the browser to configure RTCPeerConnection. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Signaling-plane messages (peer discovery + SDP/ICE relay). */
export type SignalingMessage =
  | { t: 'create' }
  | { t: 'created'; code: string; iceServers: IceServer[] }
  | { t: 'join'; code: string }
  | { t: 'peer-joined' }
  | { t: 'peer-left' }
  | { t: 'signal'; data: SdpSignal | IceSignal }
  | { t: 'error'; reason: string };

/** Opaque SDP payload relayed between peers; the server never inspects it. */
export interface SdpSignal {
  kind: 'sdp';
  sdp: unknown;
}

/** Opaque ICE candidate payload relayed between peers. */
export interface IceSignal {
  kind: 'ice';
  candidate: unknown;
}

/**
 * In-band control-plane messages (JSON strings over the DataChannel, once connected).
 * Data itself travels as raw binary frames interleaved with these; because the channel is
 * reliable + ordered, a `block` marker is guaranteed to arrive after all of its data frames,
 * so no per-frame header is needed (Phase 8).
 */
export type TransferControlMessage =
  | { t: 'manifest'; manifest: Manifest }
  | { t: 'block'; index: number; byteLength: number; hash: string }
  | { t: 'ack'; durableOffset: number }
  | { t: 'complete'; merkleRoot: string }
  | { t: 'cancel' };

export type ControlMessage = SignalingMessage | TransferControlMessage;
