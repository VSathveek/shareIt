import type { IceServer, SignalingMessage } from '@shareit/shared';
import { isValidCodeFormat } from '../pairing/code';
import type { RateLimiter } from '../security/rate-limiter';
import type { Peer, SessionStore } from './session-store';

export interface HubLimiters {
  create?: RateLimiter;
  join?: RateLimiter;
}

export interface HubMetrics {
  created: number;
  joined: number;
  relayed: number;
  rejected: number;
}

/**
 * Transport-agnostic signaling logic. Given a `Peer` (an id + a `send`) and a raw text
 * message, it drives pairing and relays SDP/ICE between the two peers of a session. The
 * WebSocket layer (route.ts) is a thin adapter over this, which is what makes it testable
 * without a live socket.
 */
export class SignalingHub {
  private readonly metrics: HubMetrics = { created: 0, joined: 0, relayed: 0, rejected: 0 };

  constructor(
    private readonly store: SessionStore,
    private readonly iceServers: () => IceServer[],
    private readonly limiters: HubLimiters = {},
  ) {}

  /** Snapshot of cumulative counters for the /metrics endpoint. */
  getMetrics(): HubMetrics {
    return { ...this.metrics };
  }

  onMessage(peer: Peer, raw: string): void {
    const msg = this.parse(raw);
    if (!msg) {
      this.metrics.rejected += 1;
      peer.send({ t: 'error', reason: 'invalid message' });
      return;
    }

    switch (msg.t) {
      case 'create': {
        if (this.limiters.create && !this.limiters.create.tryAcquire(peer.key)) {
          this.metrics.rejected += 1;
          peer.send({ t: 'error', reason: 'rate limited' });
          return;
        }
        const session = this.store.create(peer);
        this.metrics.created += 1;
        peer.send({ t: 'created', code: session.code, iceServers: this.iceServers() });
        return;
      }
      case 'join': {
        // Rate-limit every join attempt (including wrong codes) to cap brute force.
        if (this.limiters.join && !this.limiters.join.tryAcquire(peer.key)) {
          this.metrics.rejected += 1;
          peer.send({ t: 'error', reason: 'rate limited' });
          return;
        }
        if (!isValidCodeFormat(msg.code)) {
          this.metrics.rejected += 1;
          peer.send({ t: 'error', reason: 'invalid code' });
          return;
        }
        const result = this.store.join(msg.code, peer);
        if (!result.ok) {
          this.metrics.rejected += 1;
          peer.send({ t: 'error', reason: result.reason });
          return;
        }
        this.metrics.joined += 1;
        // Joiner gets its ICE config; creator learns a peer arrived and starts the offer.
        peer.send({ t: 'created', code: result.session.code, iceServers: this.iceServers() });
        result.session.creator.send({ t: 'peer-joined' });
        return;
      }
      case 'signal': {
        const other = this.store.counterpart(peer.id);
        if (other) {
          this.metrics.relayed += 1;
          other.send({ t: 'signal', data: msg.data });
        }
        return;
      }
      default: {
        // 'created' / 'peer-joined' / 'peer-left' / 'error' are server→client only.
        this.metrics.rejected += 1;
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
