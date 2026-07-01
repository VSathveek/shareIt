import type { IceServer, SignalingMessage } from '@shareit/shared';
import { isValidCodeFormat } from '../pairing/code';
import type { Peer, SessionStore } from './session-store';

/**
 * Transport-agnostic signaling logic. Given a `Peer` (an id + a `send`) and a raw text
 * message, it drives pairing and relays SDP/ICE between the two peers of a session. The
 * WebSocket layer (route.ts) is a thin adapter over this, which is what makes it testable
 * without a live socket.
 */
export class SignalingHub {
  constructor(
    private readonly store: SessionStore,
    private readonly iceServers: () => IceServer[],
  ) {}

  onMessage(peer: Peer, raw: string): void {
    const msg = this.parse(raw);
    if (!msg) {
      peer.send({ t: 'error', reason: 'invalid message' });
      return;
    }

    switch (msg.t) {
      case 'create': {
        const session = this.store.create(peer);
        peer.send({ t: 'created', code: session.code, iceServers: this.iceServers() });
        return;
      }
      case 'join': {
        if (!isValidCodeFormat(msg.code)) {
          peer.send({ t: 'error', reason: 'invalid code' });
          return;
        }
        const result = this.store.join(msg.code, peer);
        if (!result.ok) {
          peer.send({ t: 'error', reason: result.reason });
          return;
        }
        // Joiner gets its ICE config; creator learns a peer arrived and starts the offer.
        peer.send({ t: 'created', code: result.session.code, iceServers: this.iceServers() });
        result.session.creator.send({ t: 'peer-joined' });
        return;
      }
      case 'signal': {
        const other = this.store.counterpart(peer.id);
        other?.send({ t: 'signal', data: msg.data });
        return;
      }
      default: {
        // 'created' / 'peer-joined' / 'peer-left' / 'error' are server→client only.
        peer.send({ t: 'error', reason: 'unsupported message' });
      }
    }
  }

  onClose(peerId: string): void {
    const session = this.store.removeByPeer(peerId);
    if (!session) return;
    const other = session.creator.id === peerId ? session.joiner : session.creator;
    other?.send({ t: 'peer-left' });
  }

  private parse(raw: string): SignalingMessage | null {
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && typeof (value as { t?: unknown }).t === 'string') {
        return value as SignalingMessage;
      }
    } catch {
      // fall through
    }
    return null;
  }
}
