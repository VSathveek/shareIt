/**
 * Wire contract for the signaling channel and the in-band control stream.
 *
 * This union is shared verbatim by the browser client and the signaling server so both
 * ends validate against the same shape. Data-carrying frames are binary (see framing.ts);
 * everything here is small JSON control traffic.
 */

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

/** In-band control-plane messages (over the DataChannel, once connected). */
export type TransferControlMessage =
  | { t: 'manifest'; transferId: string }
  | { t: 'resume'; transferId: string; durableOffset: number }
  | { t: 'ack'; transferId: string; durableOffset: number }
  | { t: 'complete'; transferId: string; merkleRoot: string }
  | { t: 'cancel'; transferId: string };

export type ControlMessage = SignalingMessage | TransferControlMessage;
